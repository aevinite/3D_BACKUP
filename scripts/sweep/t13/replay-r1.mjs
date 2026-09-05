// scripts/sweep/t13/replay-r1.mjs — re-runs the sweep-#6/#7 ledger rows P05501–P06000 that are
// about files THIS terminal owns: app/owner/page.tsx, app/owner/layout.tsx,
// app/owner/marketing/page.tsx, app/owner/online/page.tsx and the two /api/owner routes that feed
// the dashboard (overview, analytics).
//
// Rows about /owner/activity/** or components/owner/OwnerShell.tsx are NOT here and are NOT
// touched: sweep #8 re-cut the territories and those belong to another terminal. Two terminals
// editing one row is how three ledger collisions happened.
//
// A row's TITLE is often the original fault ("…but the same answer is still printed in a red
// card"); its ✅ means the FIXED state holds. So each check below asserts the fixed behaviour,
// and says which it is when the two could be confused.
import { chk, skip, code, src, styles, report, setOnly, count } from "./lib.mjs";

const PAGE = "app/owner/page.tsx";
const LAYOUT = "app/owner/layout.tsx";
const MKT = "app/owner/marketing/page.tsx";
const ONL = "app/owner/online/page.tsx";
const OVERVIEW = "app/api/owner/overview/route.ts";
const ANALYTICS = "app/api/owner/analytics/route.ts";

const p = code(PAGE);          // comments stripped — assert on the program, not the essay
const praw = src(PAGE);
const css = styles(PAGE);

const argOnly = process.argv.find((a) => a.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

// ── ranges, labels and the clock ─────────────────────────────────────────────────────────────
const RANGE_KEYS = ["today", "yesterday", "week", "7d", "month", "30d", "lastmonth", "all"];
const mapKeys = (name) => {
  const m = new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(p)
        || new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`).exec(p);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/(?:^|[{,\s])["']?([A-Za-z0-9_]+)["']?\s*:/g)].map((x) => x[1]);
};
chk("P05501", "RANGES and RANGE_LABEL cover exactly the same 8 keys", () => {
  // SCOPED to the RANGES declaration. Unscoped, this also matched the table's sort state
  // (`useState<{ k: "rank" | … }>({ k: "revenue", … })`) and reported "rank" and "revenue" as
  // ranges — a detector fault, found re-running this row in sweep #8.
  const decl = /const RANGES: \{ k: Range; label: string \}\[\] = \[([\s\S]*?)\n\];/.exec(p);
  if (!decl) return "the RANGES declaration not found";
  const inRanges = [...decl[1].matchAll(/\{\s*k:\s*"([a-z0-9]+)"/g)].map((m) => m[1]);
  const lbl = mapKeys("RANGE_LABEL");
  const a = [...new Set(inRanges)].sort().join(","), b = [...new Set(lbl)].sort().join(",");
  return a === b && a === [...RANGE_KEYS].sort().join(",") ? true : `RANGES=[${a}] RANGE_LABEL=[${b}]`;
});
chk("P05502", "PREV_LABEL has an entry for all 8 ranges", () => {
  const k = mapKeys("PREV_LABEL").sort().join(",");
  return k === [...RANGE_KEYS].sort().join(",") ? true : `PREV_LABEL keys = ${k}`;
});
chk("P05503", "every value written to globalRange comes from RANGES", () => {
  const writes = [...p.matchAll(/setGlobalRange\(([^)]*)\)/g)].map((m) => m[1].trim());
  // two writers only: the validated localStorage restore, and pickRange's own argument
  const ok = writes.length === 2 && writes.includes("saved") && writes.includes("k");
  return ok ? true : `setGlobalRange writers = ${JSON.stringify(writes)}`;
});
chk("P05504", "the restored range is validated against RANGES before use", () =>
  /RANGES\.some\(\(r\)\s*=>\s*r\.k\s*===\s*saved\)/.test(p) ? true : "no RANGES.some guard on the restore");
chk("P05505", "a corrupt lfh-owner-range falls back to the default rather than throwing", () => {
  const m = /const saved = localStorage\.getItem\(RANGE_LS_KEY\)[\s\S]{0,240}?\} catch/.exec(p);
  return m ? true : "the localStorage restore is not inside a try/catch";
});
chk("P05506", "pickRange writes BOTH state and localStorage", () => {
  const m = /const pickRange = useCallback\(\(k: Range\) => \{([\s\S]*?)\}, \[\]\)/.exec(p);
  if (!m) return "pickRange not found";
  return /setGlobalRange\(k\)/.test(m[1]) && /localStorage\.setItem\(RANGE_LS_KEY, k\)/.test(m[1])
    ? true : "pickRange does not do both";
});
chk("P05507", "rangeSpanText('week') is Monday-first", () =>
  /const dow = \(ist\.getUTCDay\(\) \+ 6\) % 7/.test(p) ? true : "week start is not Monday-shifted");
chk("P05508", "rangeSpanText('lastmonth') names the previous month even in January", () =>
  // new Date(y, m-1, 15) rolls the YEAR back on its own for m=0 — that is the point of using the
  // Date constructor rather than subtracting from a month index
  /new Date\(now\.getFullYear\(\), now\.getMonth\(\) - 1, 15\)/.test(p) ? true : "lastmonth label does not roll the year");
chk("P05509", "rangeSpanText never returns an empty string for any of the 8 keys", () => {
  const body = /function rangeSpanText\(k: Range\): string \{([\s\S]*?)\n\}/.exec(p);
  if (!body) return "rangeSpanText not found";
  // every branch returns a template with text in it, and there is a final unconditional return
  return /return `Everything up to \$\{f\(now\)\}`;/.test(body[1]) ? true : "no unconditional fallback return";
});
chk("P05510", "istWall treats a zone-less timestamp as UTC", () =>
  /const zoneless = \/T\/\.test\(ts\) && !\/\[Z\+\]\|\[\+-\]\\d\\d\:\?\\d\\d\$\/\.test\(ts\)/.test(p)
    && /timeZone: zoneless \? "UTC" : IST/.test(p) ? true : "the zone-less branch is gone");
chk("P05511", "istWall12 upper-cases am/pm", () =>
  /replace\(\/\\b\(am\|pm\)\\b\/g, \(m\) => m\.toUpperCase\(\)\)/.test(p) ? true : "no am/pm upper-casing");
chk("P05512", "hour12(0) is '12 AM' and hour12(12) is '12 PM'", () => {
  const m = /const hour12 = \(h: number\) => `([^`]*)`/.exec(p);
  if (!m) return "hour12 not found";
  const f = new Function("h", "return `" + m[1].replace(/\$\{/g, "${") + "`");
  return f(0) === "12 AM" && f(12) === "12 PM" && f(13) === "1 PM" && f(23) === "11 PM"
    ? true : `hour12 gives ${f(0)} / ${f(12)} / ${f(13)}`;
});
chk("P05513", "tsLabel uses an hour label for today/yesterday and a date for wider ranges", () => {
  const m = /function tsLabel\(iso: string, range: Range\): string \{([\s\S]*?)\n\}/.exec(p);
  if (!m) return "tsLabel not found";
  return /range === "today" \|\| range === "yesterday"/.test(m[1]) && /toLocaleTimeString/.test(m[1]) && /toLocaleDateString/.test(m[1])
    ? true : "tsLabel no longer branches on the range";
});
chk("P05514", "istKey uses hourCycle h23 so hour 00 is '00'", () =>
  /hourCycle: "h23"/.test(p) ? true : "istKey is not pinned to h23");
chk("P05515", "keyLabel pins the parse to +05:30", () =>
  /new Date\(`\$\{m\[1\]\}T\$\{m\[2\] \?\? "00"\}:00:00\+05:30`\)/.test(p) ? true : "keyLabel does not pin the offset");
chk("P05516", "keyLabel returns the raw key rather than 'Invalid Date'", () => {
  const m = /function keyLabel\(key: string\): string \{([\s\S]*?)\n\}/.exec(p);
  if (!m) return "keyLabel not found";
  return /if \(!m\) return key;/.test(m[1]) && /if \(Number\.isNaN\(d\.getTime\(\)\)\) return key;/.test(m[1])
    ? true : "one of the two raw-key fallbacks is gone";
});
chk("P05517", "expectedBuckets('today') starts at the 05:00-IST business-day start", () =>
  /Date\.parse\(businessDayStartIso\(now\)\)/.test(p) ? true : "the business-day start is not used");
chk("P05518", "expectedBuckets('today') stops at the current hour", () =>
  /const endMs = range === "yesterday" \? startMs \+ DAY_MS - 1 : now\.getTime\(\)/.test(p)
    ? true : "the today window no longer ends at now");
chk("P05519", "expectedBuckets('yesterday') covers a whole day", () =>
  /startMs \+ DAY_MS - 1/.test(p) ? true : "yesterday's end is not a whole day");
chk("P05520", "expectedBuckets returns [] for week/month/lastmonth/all and every caller has a sorted fallback", () => {
  const m = /function expectedBuckets\(range: Range\)[\s\S]*?\n\}/.exec(p);
  if (!m) return "expectedBuckets not found";
  const branches = /range === "today" \|\| range === "yesterday"/.test(m[0]) && /range === "7d" \|\| range === "30d"/.test(m[0]);
  if (!branches) return "the two populated branches changed shape";
  // four callers, and each must sort when exp is empty
  const callers = [...p.matchAll(/expectedBuckets\((?:globalRange|range)\)/g)].length;
  const sortedFallbacks = count(p, /\.sort\(\(a, b\) => \(a\[0\] < b\[0\] \? -1 : 1\)\)/g)
                        + count(p, /Array\.from\(by\.keys\(\)\)\.sort\(\)/g);
  return callers >= 4 && sortedFallbacks >= 4 ? true : `${callers} callers, ${sortedFallbacks} sorted fallbacks`;
});
chk("P05521", "sparkOf sorts its fallback keys", () => {
  const m = /const sparkOf = useCallback\(([\s\S]*?)\}, \[kpiOf\]\);/.exec(p);
  if (!m) return "sparkOf not found";
  return /\.sort\(\(a, b\) => \(a\[0\] < b\[0\] \? -1 : 1\)\)/.test(m[1]) ? true : "sparkOf's fallback is unsorted";
});
chk("P05522", "sparkOf returns undefined for fewer than 2 points", () =>
  /return pts\.length >= 2 \? pts : undefined;/.test(p) ? true : "the 2-point floor is gone");
chk("P05523", "restTrend sorts the no-expected-sequence fallback", () => {
  const m = /const restTrend = useMemo\(([\s\S]*?)\}, \[pl, globalRange\]\);/.exec(p);
  if (!m) return "restTrend not found";
  return /\.sort\(\(a, b\) => \(String\(a\.bucket\) < String\(b\.bucket\) \? -1 : 1\)\)/.test(m[1])
    ? true : "restTrend's fallback is unsorted";
});
chk("P05524", "groupTrend labels fallback buckets like a human date, never the raw key", () => {
  const m = /const groupTrend = useMemo\(([\s\S]*?)\}, \[pl, globalRange\]\);/.exec(p);
  if (!m) return "groupTrend not found";
  return /Array\.from\(by\.keys\(\)\)\.sort\(\)\.map\(\(k\) => \(\{ key: k, label: keyLabel\(k\) \}\)\)/.test(m[1])
    ? true : "groupTrend's fallback does not go through keyLabel";
});
chk("P05525", "drawerTrend has a fallback so a row tapped on 'This month' still draws", () => {
  const m = /const drawerTrend = useMemo\(([\s\S]*?)\}, \[drawerRid, pl, globalRange\]\);/.exec(p);
  if (!m) return "drawerTrend not found";
  return /exp\.length\s*\n?\s*\? exp\s*\n?\s*: Array\.from\(by\.keys\(\)\)\.sort\(\)\.map\(\(k\) => \(\{ key: k, label: keyLabel\(k\) \}\)\)/.test(m[1])
    ? true : "drawerTrend has no human-labelled fallback";
});
chk("P05526", "the per-restaurant table spark sorts its fallback", () => {
  const m = /for \(const \[rid, m\] of byRest\) sparks\.set\(rid, exp\.length([\s\S]*?)\);/.exec(p);
  if (!m) return "the table spark loop not found";
  return /\.sort\(\(a, b\) => \(a\[0\] < b\[0\] \? -1 : 1\)\)/.test(m[1]) ? true : "the table spark fallback is unsorted";
});
chk("P05527", "groupTrend.stacked is true only for 2–3 restaurants", () =>
  /const stacked = p\.restaurantRevenue\.length >= 2 && p\.restaurantRevenue\.length <= 3;/.test(p)
    ? true : "the 2–3 stacked tier changed");
chk("P05528", "2–3 restaurants use green shades, 4+ use portfolioColor(id)", () =>
  /color: stacked \? GREEN_SHADES\[i % GREEN_SHADES\.length\] : portfolioColor\(r\.id\),/.test(p)
    ? true : "the tier colour rule changed");
chk("P05529", "GREEN_SHADES is indexed modulo its length", () =>
  count(p, /GREEN_SHADES\[[^\]]*% GREEN_SHADES\.length\]/g) >= 2 ? true : "a GREEN_SHADES index is not wrapped");
chk("P05530", "monthCompare excludes TODAY from the current-month line", () =>
  /cur: d < todayDom \? \(curBy\.get\(d\)\?\.rev \?\? 0\) : null,/.test(p) ? true : "today is no longer excluded");
chk("P05531", "monthCompare derives day-of-month in IST", () =>
  /const dom = \(bucket: string\) => new Date\(Date\.parse\(bucket\) \+ 5\.5 \* 3600_000\)\.getUTCDate\(\);/.test(p)
    ? true : "day-of-month is not IST-shifted");
chk("P05532", "monthCompare.maxDay covers last month's longer month", () =>
  /const maxDay = Math\.max\(todayDom, \.\.\.\(hasPrev \? \[\.\.\.prevBy\.keys\(\)\] : \[0\]\)\);/.test(p)
    ? true : "maxDay no longer spans the previous month");
chk("P05533", "monthCompare sends prev: null (not 0) when there is no last-month data", () =>
  /prev: hasPrev \? \(prevBy\.get\(d\) \?\? 0\) : null,/.test(p) ? true : "an absent previous month would plot as flat zero");
chk("P05534", "monthName(-1) wraps to December", () => {
  const m = /const monthName = \(mi: number\) => new Date\(Date\.UTC\(2000, ([^,]*), 1\)\)/.exec(p);
  if (!m) return "monthName not found";
  const f = new Function("mi", `return ${m[1]}`);
  return f(-1) === 11 && f(0) === 0 && f(12) === 0 ? true : `monthName index maths gives ${f(-1)} for -1`;
});
chk("P05535", "the month-vs-month card is locked to its own month payload", () =>
  /const monthCompare = useMemo\(\(\) => \{\s*const p = pl\("month"\);/.test(p)
    ? true : "monthCompare no longer reads the pinned month payload");
chk("P05536", "the month payload is fetched on load AND on the tick AND on manual Refresh", () => {
  const load = /if \(!cache\[`\$\{scopeKey\}\|month`\]\) fetchPayload\(scopeKey, "month", \{ qs: "range=month" \}\);/.test(p);
  const tick = /const tick = useCallback\(\(\) => \{[\s\S]*?fetchPayload\(scopeKey, "month", \{ qs: "range=month" \}\);/.test(p);
  const man  = /jobs\.push\(fetchPayload\(scopeKey, "month", \{ qs: "range=month", refresh: true \}\)\);/.test(p);
  return load && tick && man ? true : `load=${load} tick=${tick} refresh=${man}`;
});
chk("P05537", "errText pulls the human parts out of a thrown plain object", () => {
  const m = /function errText\(e: unknown\): string \{([\s\S]*?)\n\}/.exec(p);
  if (!m) return "errText not found";
  return /\[o\.message, o\.error, o\.details, o\.code\]/.test(m[1]) ? true : "the four human fields are gone";
});
chk("P05538", "errText truncates a JSON fallback", () =>
  /JSON\.stringify\(e\)\.slice\(0, 200\)/.test(p) ? true : "the JSON fallback is no longer truncated");
skip("P05539", "timeAgo clamps a future timestamp to 0", "timeAgo lives in components/admin/shared — outside this terminal's files; another lane owns it");
chk("P05540", "fetchPayload de-dupes concurrent requests for the same (scope, range)", () => {
  const m = /const fetchPayload = useCallback\(async \(sk: string, range: string, opts[\s\S]*?\n  \}, \[scp\]\);/.exec(p);
  if (!m) return "fetchPayload not found";
  return /if \(inflight\.current\.has\(key\)\) return;\s*inflight\.current\.add\(key\);/.test(m[0])
    ? true : "the inflight guard is gone";
});
chk("P05541", "fetchPayload always clears its inflight key, even when it throws", () => {
  const m = /const fetchPayload = useCallback\(async[\s\S]*?\n  \}, \[scp\]\);/.exec(p);
  return /\} finally \{\s*inflight\.current\.delete\(key\);\s*\}/.test(m[0]) ? true : "no finally-clear";
});
chk("P05542", "records=1 is asked for once per restaurant, not once per range", () => {
  const askedSync = /const recQ = rid && !\(rid in \(\(recsRef\.current\) \|\| \{\}\)\) && !recsAsked\.current\.has\(rid\) \? "&records=1" : "";\s*\n\s*if \(recQ\) recsAsked\.current\.add\(rid!\);/.test(p);
  return askedSync ? true : "the synchronous ask-time flag is gone — two payloads could both carry records=1";
});
chk("P05543", "fetchPayload sends cache: no-store", () =>
  /\/api\/owner\/analytics\?[\s\S]{0,300}?\{ cache: "no-store" \}/.test(p) ? true : "no-store is gone from the analytics fetch");
chk("P05544", "a deliberate 'Reports aren't enabled' answer does not drop the connection pill", () => {
  const m = /if \(a\.error && a\.disabled\) \{([^}]*)\}/.exec(p);
  if (!m) return "the disabled branch not found";
  return !/reportRealtime/.test(m[1]) ? true : "the disabled branch reports a connection state";
});
chk("P05545", "FIXED: a permission answer is NOT printed in the red 'Couldn't load.' card", () => {
  // `[^}]*` for the body was a detector fault: the branch opens with an OBJECT literal
  // (`{ scope: sk, msg: … }`) so the character class stopped at its closing brace and read
  // half a statement. Take the whole line.
  const m = /if \(a\.error && a\.disabled\) \{(.*)\}\n/.exec(p);
  if (!m) return "the disabled branch not found";
  const setsOff = /setOffScope\(\{ scope: sk, msg: errText\(a\.error\) \}\)/.test(m[1]);
  const clearsErr = /setErr\(null\)/.test(m[1]);
  return setsOff && clearsErr ? true : `offScope=${setsOff} setErr(null)=${clearsErr}`;
});
chk("P05546", "FIXED: a disabled answer DOES set landed, so the age line stops saying 'your last view'", () => {
  const m = /if \(a\.error && a\.disabled\) \{(.*)\}\n/.exec(p);
  if (!m) return "the disabled branch not found";
  return /setLanded\(true\)/.test(m[1]) ? true : "the disabled branch does not set landed";
});
chk("P05547", "fetchMoney stores the literal 'err' so a failed total renders as a dash, not 0", () =>
  /setMoneyCache\(\(c\) => \(\{ \.\.\.c, \[`\$\{sk\}\|\$\{range\}`\]: m\.error \? "err" : m\.totals \}\)\)/.test(p)
    ? true : "the 'err' sentinel is gone");
chk("P05548", "fetchMoney records its own cachedAt under a money: key", () =>
  /setAges\(\(a2\) => \(\{ \.\.\.a2, \[`money:\$\{sk\}\|\$\{range\}`\]: m\.cachedAt \}\)\)/.test(p)
    ? true : "the money age key is gone");
chk("P05549", "the pre-warm warms ONE extra range (the last-used one), not all seven", () => {
  const m = /const others = Array\.from\(new Set<Range>\(\[([^\]]*)\]\)\)/.exec(p);
  if (!m) return "the pre-warm list not found";
  return /saved && saved !== globalRange \? saved : "today"/.test(m[1]) ? true : `pre-warm list = ${m[1]}`;
});
chk("P05550", "the pre-warm runs once per scope per visit", () =>
  /if \(warmedScopes\.current\.has\(sk\)\) return;\s*warmedScopes\.current\.add\(sk\);/.test(p)
    ? true : "the warmedScopes guard is gone");
chk("P05551", "the pre-warm timers are cleared on unmount", () =>
  /return \(\) => \{ timers\.forEach\(clearTimeout\); \};/.test(p) ? true : "the timers are not cleared");
chk("P05552", "the pre-warm skips a range already in the cache", () =>
  /if \(!cacheRef\.current\[`\$\{sk\}\|\$\{k\}`\]\) fetchPayload\(sk, k\);/.test(p) ? true : "the cache-skip is gone");
chk("P05553", "neededRanges is the main range and nothing else", () => {
  const m = /const neededRanges = useMemo\(\(\) => (\[[^\]]*\]), \[globalRange\]\);/.exec(p);
  if (!m) return "neededRanges not found";
  return m[1].replace(/\s/g, "") === "[globalRange]" ? true : `neededRanges = ${m[1]}`;
});
chk("P05554", "the 60s auto-refresh re-fetches overview + main range + month + money", () => {
  const m = /const tick = useCallback\(\(\) => \{([\s\S]*?)\}, \[loadOverview/.exec(p);
  if (!m) return "tick not found";
  const b = m[1];
  return /loadOverview\(\)/.test(b) && /for \(const r of neededRanges\) fetchPayload\(scopeKey, r\)/.test(b)
      && /fetchPayload\(scopeKey, "month"/.test(b) && /fetchMoney\(scopeKey, globalRange\)/.test(b)
    ? true : "one of the four tick jobs is gone";
});
chk("P05555", "FIXED: the 60s auto-refresh DOES re-fetch the Recent-activity feed", () => {
  const m = /const tick = useCallback\(\(\) => \{([\s\S]*?)\}, \[loadOverview/.exec(p);
  return /if \(activeRid\) fetchActs\(activeRid\);/.test(m[1]) ? true : "the activity feed is left out of the tick again";
});
chk("P05556", "tick is held in a ref so useActiveAutoRefresh never captures a stale closure", () =>
  /const tickRef = useRef\(tick\); tickRef\.current = tick;\s*\n\s*useActiveAutoRefresh\(\(\) => tickRef\.current\(\), 60000\);/.test(p)
    ? true : "the tick ref indirection is gone");
chk("P05557", "manual Refresh forces refresh=1 on every payload it re-fetches", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(p);
  if (!m) return "manualRefresh not found";
  const forced = count(m[1], /refresh: true/g);
  return forced >= 3 ? true : `only ${forced} jobs force a recompute`;
});
chk("P05558", "manual Refresh includes the month payload", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(p);
  return /fetchPayload\(scopeKey, "month", \{ qs: "range=month", refresh: true \}\)/.test(m[1])
    ? true : "the month payload is left out of Refresh again";
});
chk("P05559", "manual Refresh includes the activity feed", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(p);
  return /if \(activeRid\) jobs\.push\(fetchActs\(activeRid\)\);/.test(m[1]) ? true : "the feed is left out of Refresh";
});
chk("P05560", "manual Refresh holds the spinner at least 400ms", () =>
  /const wait = Math\.max\(0, 400 - \(Date\.now\(\) - started\)\);/.test(p) ? true : "the 400ms floor is gone");
chk("P05561", "manual Refresh uses allSettled so one failed job cannot stick the spinner", () =>
  /Promise\.allSettled\(jobs\)\.finally\(/.test(p) ? true : "allSettled is gone");
chk("P05562", "loadOverview treats a payload carrying `error` as a failure", () => {
  const m = /const loadOverview = useCallback\(async \(\) => \{([\s\S]*?)\}, \[scp\]\);/.exec(p);
  if (!m) return "loadOverview not found";
  return /if \(\(o as unknown as \{ error\?: string \}\)\.error\) throw new Error/.test(m[1])
    ? true : "an error payload would be rendered as data";
});
chk("P05563", "the instant-paint snapshot is a render-only fallback, never written into cache", () => {
  // `snap` may only be READ in the pl()/moneyOf() fallbacks and hydrated into ov/updatedAt
  const writesCache = /setCache\([^)]*snap/.test(p);
  const readsFallback = /cache\[`\$\{scopeKey\}\|\$\{range\}`\] \?\? snap\?\.cache\?\.\[`\$\{scopeKey\}\|\$\{range\}`\]/.test(p);
  return !writesCache && readsFallback ? true : `writesCache=${writesCache} readsFallback=${readsFallback}`;
});
chk("P05564", "the snapshot is keyed by the admin ?rid pin", () =>
  /const snapKey = `dash\$\{scopePin \? `:\$\{scopePin\}` : ""\}`;/.test(p) ? true : "the snapshot key drops the pin");
chk("P05565", "the snapshot hydration uses `cur ?? s.ov` so a live answer is never overwritten", () =>
  /setOv\(\(cur\) => cur \?\? s\.ov!\)/.test(p) && /setUpdatedAt\(\(cur\) => cur \?\? s\.updatedAt!\)/.test(p)
    ? true : "the hydration would clobber a live answer");
chk("P05566", "the snapshot is only written once both ov and one payload exist", () =>
  /if \(!ov \|\| !Object\.keys\(cache\)\.length\) return;\s*\n\s*writeSnap\(/.test(p) ? true : "the write guard is gone");
chk("P05567", "scopePin is read once from the URL and rides on every analytics/money/oplog call", () => {
  const readOnce = /const \[scopePin\] = useState<string \| null>\(\(\) =>/.test(p);
  const scp = /const scp = scopePin \? `&scope=\$\{scopePin\}\$\{asSuffix\(\)\}` : "";/.test(p);
  // `[^`]*` was a detector fault: both URLs nest a template literal
  // (`${rid ? `&rid=${rid}` : ""}`), so the class stopped at the inner backtick. Take the
  // fetch call up to its closing paren instead.
  const analyticsCall = /fetch\(`\/api\/owner\/analytics\?[\s\S]*?\{ cache: "no-store" \}\)/.exec(p);
  const moneyCall = /fetch\(`\/api\/owner\/reports\?type=sales[\s\S]*?\{ cache: "no-store" \}\)/.exec(p);
  const onAnalytics = !!analyticsCall && analyticsCall[0].includes("${scp}");
  const onMoney = !!moneyCall && moneyCall[0].includes("${scp}");
  const onOplog = /owner\/oplog\?limit=6&rid=\$\{rid\}\$\{scopePin \?/.test(p);
  return readOnce && scp && onAnalytics && onMoney && onOplog
    ? true : `readOnce=${readOnce} scp=${scp} analytics=${onAnalytics} money=${onMoney} oplog=${onOplog}`;
});
chk("P05568", "withPin carries the pin into every in-page link", () => {
  const links = [...praw.matchAll(/href=\{([^}]*)\}/g)].map((m) => m[1].trim());
  const bad = links.filter((l) => !/withPin\(|detailHref\(/.test(l));
  return bad.length === 0 ? true : `links not carrying the pin: ${JSON.stringify(bad)}`;
});
chk("P05569", "?focus=all beats the saved drill", () =>
  /if \(focus === "all"\) \{ setView\(\{ level: "home" \}\); drillRestored\.current = true; \}/.test(p)
    ? true : "focus=all no longer wins over the restore");
chk("P05570", "the saved drill is only restored when it has both a level and a rid", () =>
  /if \(saved && saved\.level && saved\.rid\) setView\(saved\);/.test(p) ? true : "the two-field guard is gone");
chk("P05571", "the drill is persisted only after the initial restore", () =>
  /if \(!drillRestored\.current\) return;/.test(p) ? true : "first paint could wipe the saved drill");
chk("P05572", "going home REMOVES the saved drill", () =>
  /if \(view\.level === "home"\) sessionStorage\.removeItem\(drillKey\);/.test(p) ? true : "home stores a drill instead of clearing it");
chk("P05573", "the drill is stored per tab (sessionStorage)", () =>
  !/localStorage\.(get|set)Item\(drillKey/.test(p) && /sessionStorage\.setItem\(drillKey/.test(p)
    ? true : "the drill is not per-tab");
chk("P05574", "the crumb tail is cleared on unmount", () =>
  /return \(\) => \{ window\.dispatchEvent\(new CustomEvent\("lfh:owner-crumb", \{ detail: \{ tail: \[\] \} \}\)\); \};/.test(p)
    ? true : "the crumb cleanup is gone");
chk("P05575", "the crumb tail omits the restaurant name for a single-restaurant owner", () =>
  /if \(!single && view\.level !== "home"\) \{/.test(p) ? true : "the single-owner crumb guard is gone");
chk("P05576", "levelDepth maps home/restaurant/dish to 0/1/2 and drillScroll is sized 3", () => {
  const d = /const levelDepth = \(v: View\) => \(v\.level === "home" \? 0 : v\.level === "restaurant" \? 1 : 2\);/.test(p);
  const s = /useRef<\[number, number, number\]>\(\[0, 0, 0\]\)/.test(p);
  return d && s ? true : `levelDepth=${d} drillScroll3=${s}`;
});
chk("P05577", "drilling deeper opens at the top; going back restores the level's own scroll", () =>
  /el\.scrollTop = to > from \? 0 : drillScroll\.current\[to\];/.test(p) ? true : "the deeper/back scroll rule changed");
chk("P05578", "FIXED: the scroll port walks .adm-main THEN .adm, so it works at 360px too", () => {
  const m = /function scrollPort\(\): HTMLElement \| null \{([\s\S]*?)\n\}/.exec(p);
  if (!m) return "scrollPort not found";
  const walks = /for \(const sel of \[".adm-main", ".adm"\]\)/.test(m[1]);
  const proves = /el\.scrollHeight > el\.clientHeight \+ 2/.test(m[1]);
  return walks && proves ? true : `walks=${walks} provesItScrolls=${proves}`;
});
chk("P05579", "the drill is registered with the back-stack manager", () => {
  const r = /useBackClose\("owner-drill-restaurant", view\.level !== "home"/.test(p);
  const d = /useBackClose\("owner-drill-dish", view\.level === "dish"/.test(p);
  return r && d ? true : `restaurantLayer=${r} dishLayer=${d}`;
});
chk("P05580", "kpiOf (restaurant) reads paidOrders and falls back to orders", () =>
  /paidOrders: p\.kpis\.paidOrders \?\? p\.kpis\.orders/.test(p) ? true : "the paidOrders fallback is gone");
chk("P05581", "kpiOf (group) sums revenue and orders across restaurants", () =>
  /const revenue = p\.restaurantRevenue\.reduce\(\(a, r\) => a \+ r\.revenue, 0\);/.test(p)
    && /const orders = p\.restaurantRevenue\.reduce\(\(a, r\) => a \+ r\.orders, 0\);/.test(p)
    ? true : "the group sums changed");
chk("P05582", "kpiOf group avg divides by PAID orders", () =>
  /avg: paidOrders \? revenue \/ paidOrders : 0/.test(p) ? true : "the group average no longer divides by paid orders");
chk("P05583", "kpiOf never divides by zero", () => {
  const divs = [...p.matchAll(/avg: ([^,]*),/g)].map((m) => m[1]);
  const bad = divs.filter((d) => /\//.test(d) && !/\?/.test(d));
  return bad.length === 0 ? true : `unguarded division: ${JSON.stringify(bad)}`;
});
chk("P05584", "the multi table's Avg column is named differently from the tile", () => {
  const th = /th\("avg", "Avg \/ order"/.test(p);
  const tile = /\$\{inr\(kMain\.avg\)\} per paid order/.test(p);
  return th && tile ? true : `tableHeader=${th} tileCaption=${tile}`;
});
skip("P05585", "kpiCount is 5 normally and 7 with payroll", "RETIRED by the owner 2026-08-18 — the row is a FIXED FIVE. Re-asserted as a five-tile row by P05586 below and by the new block");
chk("P05586", "SUPERSEDED SHAPE: the tile grid is a fixed 5, stepping to 3 at 1080px and 2 at 760px", () => {
  const five = /:global\(\.ow2-stats5\) \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); \}/.test(css);
  const three = /@media \(max-width: 1080px\)[\s\S]{0,200}?repeat\(3, minmax\(0, 1fr\)\)/.test(css);
  const two = /@media \(max-width: 760px\)[\s\S]{0,260}?repeat\(2, minmax\(0, 1fr\)\)/.test(css);
  return five && three && two ? true : `five=${five} three=${three} two=${two}`;
});
chk("P05587", "a tile with no sparkline gets ow2-nospark", () =>
  /const hasSpark = !!spark && spark\.length >= 2 && !loading;/.test(p)
    && /\$\{hasSpark \? "" : " ow2-nospark"\}/.test(p) ? true : "the nospark class is gone");
chk("P05588", "the spark reserve rule is written with three classes so it beats globals.css", () =>
  /\.owx \.adm-stat\.ow2-kpi \{ padding-bottom: 44px; \}/.test(css)
    && /\.owx \.adm-stat\.ow2-kpi\.ow2-nospark \{ padding-bottom: 14px; \}/.test(css)
    ? true : "the three-class spark reserve is gone");
chk("P05589", "the 'Today so far' tile is the only one with a live pill", () => {
  const pills = [...praw.matchAll(/pill=\{([^}]*)\}/g)].map((m) => m[1]);
  return pills.length === 1 && /● live/.test(pills[0]) ? true : `pill props = ${JSON.stringify(pills)}`;
});
chk("P05590", "'Today so far' reads the overview payload, not analytics", () =>
  /const todayRev = activeRid \? \(todayRow\?\.revenueToday \?\? 0\) : \(ov\?\.totals\.revenueToday \?\? 0\);/.test(p)
    ? true : "the today figure no longer comes from the overview");
skip("P05591", "'Lost to cancellations' renders a dash when the money total failed", "RETIRED with the tile (owner, 2026-08-18): a cancellation is a record, not money lost. The Revenue popup carries the sentence instead — asserted by the round-2 rows");
skip("P05592", "'Lost to cancellations' says 'none — great' rather than a bare 0", "RETIRED with the same tile");
skip("P05593", "the 'After staff pay' tile subtracts what left and says so", "RETIRED — it is the On hand tile, and the subtraction is shown line by line in its popup");
skip("P05594", "the staff-pay tiles are absent without the payroll module", "RETIRED — Expenses and On hand are always drawn; staffPay null makes staffOut 0");
skip("P05595", "every KPI tile is a link into the matching report", "RETIRED (owner, 2026-08-18) — every tile is a BUTTON that opens a popup; the report link is the popup's last line");
chk("P05596", "SUPERSEDED SHAPE: with Reports off, no tile opens and the popup footer is a plain sentence", () => {
  const noOpen = count(p, /onOpen=\{offNote \? undefined :/g) === 5;
  const footer = /\) : <span className="full off">Reports are switched off for this restaurant<\/span>\}/.test(p);
  return noOpen && footer ? true : `fiveGuardedTiles=${noOpen} deadLinkReplaced=${footer}`;
});
chk("P05597", "the hero shortcut row hides Reports / Team / Feedback per entitlement", () => {
  const r = /ov\.entitlements\?\.reports !== false && <Link href=\{withPin\("\/owner\/reports"\)\}/.test(p);
  const s = /ov\.entitlements\?\.staff !== false && <Link href=\{withPin\("\/owner\/staff"\)\}/.test(p);
  const i = /ov\.entitlements\?\.issues !== false && <Link href=\{withPin\("\/owner\/issues"\)\}/.test(p);
  return r && s && i ? true : `reports=${r} staff=${s} issues=${i}`;
});
chk("P05598", "the hero's middle shortcut is labelled 'Team', like the sidebar and the page", () =>
  /fa-users-gear" aria-hidden="true" \/> Team<\/Link>/.test(p) ? true : "the middle shortcut is not labelled Team");
chk("P05599", "the Recent-activity 'See all' link is gated on an entitlement that exists", () => {
  // the CARD's own gate is `logs`; the link no longer carries a second, non-existent `activity` key
  const cardGate = /ov\?\.entitlements\?\.logs !== false && !actsOff && \(/.test(p);
  const noGhostKey = !/entitlements\?\.activity/.test(p);
  return cardGate && noGhostKey ? true : `cardGate=${cardGate} noActivityKey=${noGhostKey}`;
});
chk("P05600", "the Recent-activity card renders nothing at all when the log is switched off", () =>
  /ov\?\.entitlements\?\.logs !== false && !actsOff/.test(p) ? true : "the card is not fully withheld");
chk("P05601", "fetchActs asks for 6 rows only", () =>
  /owner\/oplog\?limit=6&rid=/.test(p) ? true : "the oplog limit is not 6");
chk("P05602", "fetchActs tells an empty list, a refusal and a FAILED read apart", () => {
  const m = /const fetchActs = useCallback\(async \(rid: string\) => \{([\s\S]*?)\}, \[scopePin\]\);/.exec(p);
  if (!m) return "fetchActs not found";
  const off = /if \(j\.disabled\) \{ setActsOff\(true\); setActs\(\[\]\); setActsErr\(false\); return; \}/.test(m[1]);
  const list = /if \(Array\.isArray\(j\.actions\)\) \{ setActs\(j\.actions\); setActsErr\(false\); \}/.test(m[1]);
  const err = /else \{ setActs\(null\); setActsErr\(true\); \}/.test(m[1]) && /catch \{ setActs\(null\); setActsErr\(true\); \}/.test(m[1]);
  return off && list && err ? true : `refusal=${off} list=${list} failure=${err}`;
});
chk("P05603", "the mini feed never prints a raw action code", () =>
  /<span className="tx">\{actLabel\(a\.action\)\}/.test(p) && !/\{a\.action\}/.test(p)
    ? true : "the feed prints a.action bare");
chk("P05604", "the mini feed never prints a raw panel name", () =>
  /\{panelLabel\(a\.panel\)\}/.test(p) && !/>\{a\.panel\}</.test(p) ? true : "the feed prints a.panel bare");
chk("P05605", "the mini feed's empty state says what will fill it", () =>
  /Nothing yet — your team&rsquo;s work shows up here as it happens\./.test(p) ? true : "the empty sentence changed");
chk("P05606", "the mini feed's actor column falls back rather than rendering null", () =>
  /<span className="who" title=\{actorTitle\(a\.actor\)\}>\{actorLabel\(a\.actor\)\}<\/span>/.test(p)
    ? true : "the actor cell is not routed through the label helper");
chk("P05607", "insights caps itself at 4 lines", () =>
  /return out\.slice\(0, 4\);/.test(p) ? true : "the 4-line cap is gone");
chk("P05608", "insights names a time in 12-hour form", () =>
  /text: `Busiest at \$\{hour12\(busiest\.hour\)\}/.test(p) ? true : "the busiest-hour insight is not 12-hour");
chk("P05609", "insights suppresses a change under 3% as noise", () =>
  count(p, /Math\.abs\(pct\) >= 3/g) >= 2 ? true : "the 3% noise floor is gone from one of the two branches");
chk("P05610", "insights switches to 'N× the period before' past 300%", () =>
  count(p, /if \(pct >= 300\)/g) >= 2 ? true : "the 300% switch is gone from one of the two branches");
chk("P05611", "insights never divides by a zero previous period", () =>
  count(p, /p\.prev && p\.prev\.revenue > 0/g) >= 2 ? true : "a prev-revenue guard is missing");
chk("P05612", "the payments insight ignores the 'Not recorded' bucket", () =>
  /\.filter\(\(x\) => x\.method !== "Not recorded"\)/.test(p) ? true : "the Not-recorded bucket is no longer excluded");
chk("P05613", "the payments insight only fires past a 15% share", () =>
  /pay\.revenue \/ payTotal >= 0\.15/.test(p) ? true : "the 15% floor is gone");
chk("P05614", "the group insight never names a leader when there is only one restaurant", () =>
  /if \(top && total > 0 && p\.restaurantRevenue\.length > 1\)/.test(p) ? true : "the >1 guard is gone");
chk("P05615", "dishView tells 'still loading' from 'no sales in this range'", () => {
  const m = /const dishView = useMemo\(\(\) => \{([\s\S]*?)\}, \[view, pl, globalRange\]\);/.exec(p);
  if (!m) return "dishView not found";
  return /"loading" as const/.test(m[1]) && /\("missing" as const\)/.test(m[1]) ? true : "the two states are no longer distinct";
});
chk("P05616", "the 'no sales for this dish' state offers a way back, and it goes UP ONE LEVEL", () => {
  // Re-pinned in sweep #8 (T13 item 1). The earlier version asserted the exact old handler
  // shape — viewTo({ level: "restaurant", rid: view.rid }) — so it went red for the fix rather
  // than for a fault, which is the "a guard pinned to a code shape" trap this repo has recorded.
  // What the row is really about: there IS a way back, and it lands somewhere that exists.
  const m = /No sales for <b>\{view\.dish\}<\/b> in \{RANGE_LABEL\[globalRange\]\}\.([\s\S]*?)<\/div>/.exec(p);
  if (!m) return "the missing-dish sentence is gone";
  const hasButton = /<button className="adm-btn"[\s\S]*?onClick=\{[^}]*viewTo\(/.test(m[1]);
  // and for a ONE-restaurant owner it must go home, because "restaurant" is not a level he has:
  // landing there renders the tiles without the hero (no name, no Active pill, no shortcuts).
  const singleGoesHome = /viewTo\(single \? \{ level: "home" \} : \{ level: "restaurant", rid: view\.rid \}\)/.test(m[1]);
  const labelledForBoth = /\{single \? "Back to the dashboard" : "Back to the restaurant"\}/.test(m[1]);
  return hasButton && singleGoesHome && labelledForBoth
    ? true : `button=${hasButton} singleOwnerGoesHome=${singleGoesHome} labelMatchesDestination=${labelledForBoth}`;
});
chk("P05617", "dishView checks the loaded payload is the SAME restaurant", () =>
  /p\.restaurant\.id !== view\.rid/.test(p) ? true : "the same-restaurant guard is gone");
chk("P05618", "DishList sorts by the chosen key and never mutates the payload array", () =>
  /const dishes = \[\.\.\.payload\.dishes\]\.sort\(/.test(p) ? true : "DishList sorts the payload array in place");
chk("P05619", "DishList bars divide by Math.max(1, …)", () =>
  /const maxRev = Math\.max\(1, \.\.\.dishes\.map\(\(d\) => d\.revenue\)\);/.test(p) ? true : "the divide-by-zero guard is gone");
chk("P05620", "DishList's empty state names the range", () =>
  /No dish sales in this range\./.test(p) ? true : "the dish empty state changed");
chk("P05621", "the drawer only opens for a restaurant in the overview list", () =>
  /const r = ov\.restaurants\.find\(\(x\) => x\.id === drawerRid\);\s*\n\s*if \(!r\) return null;/.test(p)
    ? true : "the drawer does not check the restaurant exists");
chk("P05622", "the drawer closes on BACK, the backdrop, the ✕ and Escape", () => {
  const back = /useBackClose\("owner-rest-drawer", !!drawerRid, \(\) => setDrawerRid\(null\)\)/.test(p);
  const bd = /<div className="ow2-drawer-back" onClick=\{\(\) => setDrawerRid\(null\)\}/.test(p);
  const x = /<button className="x" onClick=\{\(\) => setDrawerRid\(null\)\} aria-label="Close">/.test(p);
  const esc = /if \(!drawerRid\) return;[\s\S]{0,220}?e\.key === "Escape"[\s\S]{0,40}?setDrawerRid\(null\)/.test(p);
  return back && bd && x && esc ? true : `back=${back} backdrop=${bd} x=${x} escape=${esc}`;
});
chk("P05623", "the drawer's Escape listener is removed when it closes", () =>
  /return \(\) => document\.removeEventListener\("keydown", onKey\);\s*\n\s*\}, \[drawerRid\]\);/.test(p)
    ? true : "the drawer's keydown listener is not cleaned up");
chk("P05624", "the drawer's figures come from data already loaded", () => {
  const m = /\{drawer && \(([\s\S]*?)\n      \)\}/.exec(p);
  if (!m) return "the drawer JSX not found";
  return !/fetch\(/.test(m[1]) ? true : "the drawer issues a fetch";
});
chk("P05625", "the drawer's Avg says 'all orders, paid or open'", () =>
  /<i>all orders, paid or open<\/i>/.test(p) ? true : "the drawer's avg caption changed");
chk("P05626", "'View in full detail' closes the drawer before drilling", () =>
  /const openFull = \(rid: string\) => \{ setDrawerRid\(null\); viewTo\(\{ level: "restaurant", rid \}\); \};/.test(p)
    ? true : "openFull no longer closes the drawer first");
chk("P05627", "callouts exist only for 4+ restaurants", () =>
  /if \(!p \|\| p\.scope !== "group" \|\| p\.restaurantRevenue\.length <= 3\) return null;/.test(p)
    ? true : "the 4+ tier guard changed");
chk("P05628", "the two callouts can never name the same restaurant", () =>
  /if \(best && r\.id === best\.id\) continue;/.test(p) ? true : "the same-restaurant skip is gone");
chk("P05629", "'needs attention' needs a real drop (worse than −5%)", () =>
  /if \(pct < -5 && \(!watchId \|\| pct < watchPct\)\)/.test(p) ? true : "the −5% floor is gone");
chk("P05630", "callouts momentum halves come from SORTED bucket order", () =>
  /const buckets = Array\.from\(new Set\(p\.timeseries\.map\(\(t\) => t\.bucket\)\)\)\.sort\(\);/.test(p)
    ? true : "the buckets are no longer sorted before halving");
chk("P05631", "callouts skips a restaurant whose first half was zero", () =>
  /if \(!h \|\| h\.a <= 0\) continue;/.test(p) ? true : "an infinite percentage is possible again");
chk("P05632", "tableRows ranks by revenue independently of the chosen sort", () =>
  /const rank = new Map\(\[\.\.\.base\]\.sort\(\(a, b\) => b\.revenue - a\.revenue\)\.map\(\(r, i\) => \[r\.id, i \+ 1\]\)\);/.test(p)
    ? true : "the rank is no longer computed from its own revenue sort");
chk("P05633", "tableRows search matches name AND slug", () =>
  /r\.name\.toLowerCase\(\)\.includes\(q\) \|\| r\.slug\.toLowerCase\(\)\.includes\(q\)/.test(p)
    ? true : "the slug is no longer searched");
chk("P05634", "the share denominator is Math.max(1, total)", () =>
  /const total = Math\.max\(1, Array\.from\(revById\.values\(\)\)\.reduce\(\(a, r\) => a \+ r\.revenue, 0\)\);/.test(p)
    ? true : "the share denominator lost its floor");
chk("P05635", "a reports-off restaurant stays in the table with every money cell saying so", () => {
  const stays = /reportsOff: r\.reportsOff === true,/.test(p);
  const says = /figures hidden<\/span>/.test(p);
  return stays && says ? true : `stays=${stays} says=${says}`;
});
chk("P05636", "the reports-off row renders FOUR cells, matching the header one-for-one", () => {
  const m = /\{r\.reportsOff \? \(\s*<>([\s\S]*?)<\/>\s*\) : \(/.exec(p);
  if (!m) return "the reports-off cell group not found";
  const tds = count(m[1], /<td /g);
  return tds === 4 ? true : `${tds} cells, not 4 — a colSpan would slide under the wrong heading on a phone`;
});
chk("P05637", "the reports-off explanation sits in the always-visible Revenue column", () => {
  const m = /\{r\.reportsOff \? \(\s*<>([\s\S]*?)<\/>\s*\) : \(/.exec(p);
  const cells = m[1].split("<td ").slice(1);
  // cell order: Today(hide-s) · Figures(visible) · Orders · Avg(hide-s)
  return /figures hidden/.test(cells[1]) && !/hide-s/.test(cells[1].split(">")[0])
    ? true : "the explanation is in a column the phone hides";
});
chk("P05638", "a reports-off row draws no sparkline and no share bar", () =>
  /\{!r\.reportsOff && r\.spark && r\.spark\.length >= 2 \?/.test(p)
    && /\{r\.reportsOff \? <span className="mut">—<\/span> : <><span className="hq-meter"/.test(p)
    ? true : "a hidden row still draws a chart");
chk("P05639", "the empty-table row spans all 10 columns", () => {
  const head = /<thead><tr>([\s\S]*?)<\/tr><\/thead>/.exec(p);
  const cols = count(head[1], /\{th\(/g) + count(head[1], /<th /g);
  const span = /colSpan=\{(\d+)\}/.exec(p);
  return cols === Number(span[1]) ? true : `${cols} headers vs colSpan=${span[1]}`;
});
chk("P05640", "the table tells 'no match' apart from 'still loading'", () =>
  /\{ov \? "No restaurant matches that search\." : "Loading…"\}/.test(p) ? true : "the two table empty states merged");
chk("P05641", "a table row is reachable by keyboard", () =>
  /tabIndex=\{0\} onKeyDown=\{\(e\) => \{ if \(e\.key === "Enter"\) setDrawerRid\(r\.id\); \}\}/.test(p)
    ? true : "the row is not keyboard-reachable");
chk("P05642", "th() reports aria-sort", () =>
  /aria-sort=\{tSort\.k === k \? \(tSort\.asc \? "ascending" : "descending"\) : "none"\}/.test(p)
    ? true : "aria-sort is gone");
chk("P05643", "tapping the same header twice reverses the direction", () =>
  /setTSort\(\(s\) => \(\{ k, asc: s\.k === k \? !s\.asc : false \}\)\)/.test(p) ? true : "the toggle rule changed");
chk("P05644", "the restaurant colour is one identity across dots, share bars and charts", () => {
  const tableAccent = /accent: restCount <= 3 \? GREEN_SHADES\[\(rk - 1\) % GREEN_SHADES\.length\] : portfolioColor\(r\.id\)/.test(p);
  const chart = /color: stacked \? GREEN_SHADES\[i % GREEN_SHADES\.length\] : portfolioColor\(r\.id\)/.test(p);
  return tableAccent && chart ? true : `table=${tableAccent} chart=${chart}`;
});
chk("P05645", "restScopeText says 'N of M · takings hidden for K'", () =>
  /\$\{reportedCount\} of \$\{restCount\} restaurants · takings hidden for \$\{restCount - reportedCount\}/.test(p)
    ? true : "the partial-coverage caption changed");
chk("P05646", "reportedCount counts only non-reportsOff restaurants", () =>
  /const reportedCount = \(ov\?\.restaurants \?\? \[\]\)\.filter\(\(r\) => !r\.reportsOff\)\.length;/.test(p)
    ? true : "reportedCount no longer excludes hidden restaurants");
chk("P05647", "the heatmap card says 'last 90 days only' for ranges wider than the clamp", () =>
  /HEAT_CLAMPED\[globalRange\] \? ` · last \$\{HEAT_CLAMP_DAYS\} days only` : ""/.test(p)
    ? true : "the clamp caption is gone");
chk("P05648", "the heatmap's period chip shows the CLAMPED window when they differ", () =>
  count(p, /HEAT_CLAMPED\[globalRange\] \? `Last \$\{HEAT_CLAMP_DAYS\} days` : RANGES\.find/g) >= 2
    ? true : "the chip no longer reports the clamp");
chk("P05649", "PartialStrip renders nothing when there is nothing partial", () =>
  /if \(!keys \|\| !keys\.length\) return null;/.test(p) ? true : "PartialStrip's empty guard is gone");
chk("P05650", "each PartialStrip is filtered to the key its own card is about", () => {
  const strips = [...p.matchAll(/<PartialStrip keys=\{([^}]*)\}/g)].map((m) => m[1]);
  const filtered = strips.filter((s) => /\.filter\(\(k\) => k === "/.test(s) || /recordsUnread/.test(s));
  return strips.length >= 5 && filtered.length === strips.length
    ? true : `${strips.length} strips, ${filtered.length} scoped to one key`;
});
chk("P05651", "the partial strip sits INSIDE the affected card", () =>
  count(p, /<PartialStrip/g) >= 5 && !/<PartialStrip[\s\S]{0,80}?page-level/.test(p)
    ? true : "PartialStrip has become a page banner");
chk("P05652", "…and under the card title on every card", () => {
  // Measured on the RAW file, by line. The earlier version sliced 400 characters out of the
  // comment-stripped text, where a stripped essay collapses to one space and the window lands
  // somewhere else entirely — it reported 2 of 5 strips as orphaned when all 5 sit under a title.
  const lines = src(PAGE).split("\n");
  const bad = [];
  lines.forEach((l, i) => {
    if (!/<PartialStrip/.test(l)) return;
    const above = lines.slice(Math.max(0, i - 4), i).join("\n");
    if (!/ow2-ct/.test(above)) bad.push(i + 1);
  });
  return bad.length === 0 ? true : `strips with no card title within 4 lines above: ${JSON.stringify(bad)}`;
});
chk("P05653", "the records strip names its own rolling window", () =>
  /STAR DISH · LAST 30 DAYS \(ROLLING\)/.test(p) && /REGULARS · LAST 30 DAYS \(ROLLING\)/.test(p)
    ? true : "the records strip borrows the dropdown's window again");
chk("P05654", "the records strip is absent with nothing to show — and PRESENT with the reason when unread", () =>
  /\{\(recordsUnread \|\| \(records && \(records\.bestDay \|\| records\.starDish\)\)\) && \(/.test(p)
    ? true : "the records card's render condition changed");
chk("P05655", "BIGGEST BILL says 'one sitting' when the table is unknown", () =>
  /\{records\.bigBill\.table \? `table \$\{records\.bigBill\.table\}` : "one sitting"\}/.test(p)
    ? true : "the unknown-table wording changed");
chk("P05656", "REGULARS is drawn only above zero", () =>
  /\{\(records\.regulars \?\? 0\) > 0 && \(/.test(p) ? true : "the regulars zero guard is gone");
chk("P05657", "records.fastHour prints 12-hour with upper-cased AM/PM", () =>
  /istWall12\(records\.fastHour\.at, \{ day: "numeric", month: "short", hour: "numeric", hour12: true \}\)/.test(p)
    ? true : "fastHour no longer uses istWall12");
chk("P05661", "the trend card falls back from an area chart to bars under 9 points", () =>
  /restTrend\.length >= 9\s*\n?\s*\? <AreaTrend/.test(p) ? true : "the 9-point switch is gone");
chk("P05662", "TimeBar receives numbers, never undefined", () =>
  /revenue: Number\(r\.Revenue\) \|\| 0, __orders: Number\(r\.__orders\) \|\| 0/.test(p)
    ? true : "the TimeBar mapping no longer coerces");
chk("P05663", "the 'today is still in progress' caption appears under BOTH month-compare cards", () =>
  count(p, /Today is still in progress, so it joins the line tomorrow\./g) === 2
    ? true : `the caption appears ${count(p, /Today is still in progress, so it joins the line tomorrow\./g)} times, not 2`);
chk("P05664", "gatherReport refuses before the overview has loaded", () =>
  /if \(!ov\) throw new Error\("not loaded yet"\);/.test(p) ? true : "the not-loaded guard is gone");
chk("P05665", "the export filename carries the date", () =>
  /const exportName = `aevidine-report-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}`;/.test(p)
    ? true : "the export name lost its date");
chk("P05666", "the detail link carries the admin pin and the person pin", () => {
  const m = /const detailHref = \(t: string\) => \{([\s\S]*?)\n  \};/.exec(p);
  if (!m) return "detailHref not found";
  return /q\.set\("rid", scopePin\)/.test(m[1]) && /const a = asValue\(\); if \(a\) q\.set\("as", a\);/.test(m[1])
    ? true : "one of the two pins is gone";
});
chk("P05667", "ageTitle prints an absolute IST timestamp as well as a relative age", () =>
  /return `Figures computed \$\{new Date\(at\)\.toLocaleString\("en-IN", \{ dateStyle: "medium", timeStyle: "short", timeZone: IST \}\)\} · \$\{timeAgo\(at\)\}`;/.test(p)
    ? true : "ageTitle no longer carries both");
chk("P05668", "the header age line reports the OLDEST payload on screen", () =>
  /const oldestShown = shownAges\.length\s*\n?\s*\? shownAges\.reduce\(\(a, b\) => \(Date\.parse\(a\) <= Date\.parse\(b\) \? a : b\)\)/.test(p)
    ? true : "the age line no longer takes the oldest");
chk("P05669", "the age line says 'your last view ·' until a live payload has landed", () =>
  /\{!landed && "your last view · "\}updated \{timeAgo\(oldestShown\)\}/.test(p)
    ? true : "the saved-copy prefix is gone");
chk("P05670", "shownAges includes the month payload's age", () => {
  // `[^\]]*` was a detector fault: every element is an `ages[...]` subscript, so the class
  // stopped at the first closing bracket and read one third of the array.
  const m = /const shownAges = \[([\s\S]*?)\]\n/.exec(p);
  if (!m) return "shownAges not found";
  return /ages\[`\$\{scopeKey\}\|month`\]/.test(m[1]) ? true : "the month age is not in the oldest-of set";
});
chk("P05671", "the .ow2-two grid uses minmax(0,1fr)", () =>
  /\.ow2-two \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/.test(css)
    ? true : "the two-card grid lost its zero floor");
chk("P05672", ".ow2-two > * { min-width: 0 } is present", () =>
  /\.ow2-two > \* \{ min-width: 0; \}/.test(css) ? true : "the min-width half of the cure is gone");
chk("P05673", "the KPI grid column count comes from a CSS variable", () =>
  /grid-template-columns: repeat\(var\(--ow2-cols, 5\), 1fr\)/.test(css) ? true : "the --ow2-cols variable is gone");
chk("P05674", "the phone breakpoint forces 2 KPI columns and one card per row", () =>
  /@media \(max-width: 760px\) \{[\s\S]{0,400}?repeat\(2, minmax\(0, 1fr\)\) !important;[\s\S]{0,200}?\.ow2-two, \.ow2-callouts \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css)
    ? true : "the phone step changed");
chk("P05675", "the table's th rules are written as :global(th)", () =>
  /\.hq-table :global\(th\) \{ position: sticky;/.test(css) ? true : "the th rule is scoped again and would match nothing");
chk("P05676", "the phone column-hiding is by CLASS and is :global", () =>
  /\.hq-table :global\(\.hide-m\), \.hq-table :global\(\.hide-s\) \{ display: none; \}/.test(css)
    ? true : "the phone hiding is not class-based-and-global");
skip("P05677", "the KPI card keeps overflow visible so the range popup can escape", "RETIRED — there is no per-card range dropdown left; the only one is the toolbar's `main`");
chk("P05678", "the range popup's z-index is above sibling cards", () =>
  /\.owr-pop \{ position: absolute; top: calc\(100% \+ 6px\); right: 0; z-index: 90;/.test(css)
    ? true : "the popup z-index changed");
chk("P05679", "the drawer backdrop uses ONE unprefixed backdrop-filter line", () => {
  const n = count(css, /backdrop-filter:/g), pref = count(css, /-webkit-backdrop-filter:/g);
  return pref === 0 && n >= 1 ? true : `${n} backdrop-filter, ${pref} prefixed`;
});
chk("P05680", "no CSS comment in the styled-jsx template contains a backtick", () => {
  const bad = [...styles(PAGE).matchAll(/\/\*[\s\S]*?\*\//g)].filter((m) => m[0].includes("`"));
  return bad.length === 0 ? true : `${bad.length} CSS comments contain a backtick — the build would fail`;
});
chk("P05681", "the split-banner styles are global because `highlights` is an extracted const", () =>
  /<style jsx global>\{`\s*\n\s*\.ow2-split \{/.test(praw) ? true : "the split styles are no longer global");
chk("P05682", "the top performer's revenue mixes the accent toward the text colour", () =>
  /\.ow2-split \.txt em \{ font-style: normal; font-weight: 800; color: color-mix\(in srgb, var\(--accent\) 80%, var\(--text\)\); \}/.test(css)
    ? true : "the readable-in-both-skins mix is gone");
chk("P05683", ".rv-sort button.on uses var(--accent-on, #fff)", () =>
  /\.rv-sort button\.on \{ background: var\(--accent\); color: var\(--accent-on, #fff\);/.test(css)
    ? true : "the accent-on token is gone");
chk("P05684", "the file names no restaurant's own accent colour for a chart", () => {
  // accentColor may be CARRIED in a payload type, but never handed to a chart as its colour
  const bad = [...p.matchAll(/accentColor: ([^,}\n]*)/g)].map((m) => m[1].trim())
    .filter((v) => /r\.accentColor|accent_color/.test(v));
  return bad.length === 0 ? true : `a chart is given a brand accent: ${JSON.stringify(bad)}`;
});
chk("P05685", "FALLBACK is only used for the table row's accent before the palette overwrites it", () => {
  const uses = [...p.matchAll(/FALLBACK/g)].length;
  const decl = /const FALLBACK = GREEN;/.test(p);
  const rowUse = /accent: r\.accentColor \|\| FALLBACK,/.test(p);
  return decl && rowUse && uses === 2 ? true : `FALLBACK used ${uses} times (decl=${decl}, row=${rowUse})`;
});
chk("P05686", "canonPayMethod is applied before the payments insight picks a top method", () =>
  /const payRows = \(p\.paymentMethods \?\? \[\]\)\.map\(\(x\) => \(\{ \.\.\.x, method: canonPayMethod\(x\.method\) \}\)\);/.test(p)
    ? true : "the insight reads raw method strings");
chk("P05687", "the dish leaderboard greys every dish except the one being viewed", () =>
  /accentColor: d\.title === dishView\.d\.title \? GREEN : "rgba\(128,128,128,\.35\)"/.test(p)
    ? true : "the leaderboard highlight changed");
chk("P05688", "the dish leaderboard is capped at 12 bars", () =>
  /dishView\.dishes\.slice\(0, 12\)/.test(p) ? true : "the 12-bar cap is gone");
chk("P05689", "tapping another bar in the dish view navigates to that dish", () =>
  /onSelect=\{\(title\) => viewTo\(\{ level: "dish", rid: \(view as \{ rid: string \}\)\.rid, dish: title \}\)\}/.test(p)
    ? true : "the leaderboard bar is a dead tap");
chk("P05690", "the dish view prints share and rank out of the real dish count", () =>
  /#\{dishView\.rank\}<span[^>]*> \/ \{dishView\.of\}<\/span>/.test(p)
    && /share: Math\.round\(\(d\.revenue \/ total\) \* 100\)/.test(p)
    ? true : "the dish rank/share line changed");
chk("P05691", "single is derived from the overview length", () =>
  /const single = ov\?\.restaurants\.length === 1;/.test(p) ? true : "single is no longer derived from the overview");
chk("P05692", "activeRid resolves to the only restaurant for a single-restaurant owner", () =>
  /const homeRid = single \? ov!\.restaurants\[0\]\.id : null;/.test(p)
    && /const activeRid = view\.level === "home" \? homeRid : \(view as \{ rid: string \}\)\.rid;/.test(p)
    ? true : "the single-owner activeRid resolution changed");
chk("P05693", "the hero prints the live open-table count with correct pluralisation", () =>
  /\{ov\.restaurants\[0\]\.openTables\} table\{ov\.restaurants\[0\]\.openTables === 1 \? "" : "s"\} open now/.test(p)
    ? true : "the hero table count changed");
chk("P05694", "the hero pill says Active/Off from the restaurant's own flag", () =>
  /<span className=\{`own-pill \$\{ov\.restaurants\[0\]\.active \? "on" : "off"\}`\}>\{ov\.restaurants\[0\]\.active \? "Active" : "Off"\}<\/span>/.test(p)
    ? true : "the hero pill changed");
chk("P05700", "/owner/marketing and /owner/online are server components with no client state", () => {
  const m = code(MKT), o = code(ONL);
  const clean = (t) => !/"use client"/.test(t) && !/useState|useEffect|fetch\(/.test(t);
  return clean(m) && clean(o) ? true : `marketing=${clean(m)} online=${clean(o)}`;
});

// ── conformance rows that are about MY files ─────────────────────────────────────────────────
chk("P05701", "every popup in page.tsx registers with the back-stack manager", () => {
  const layers = [...p.matchAll(/useBackClose\("([^"]+)"/g)].map((m) => m[1]);
  const want = ["owner-rest", "owner-drill-restaurant", "owner-drill-dish", "owner-kpi-tile", "owner-rest-drawer"];
  const missing = want.filter((w) => !layers.includes(w));
  const rng = layers.some((l) => /owner-rng/.test(l)) || /useBackClose\(`owner-rng-\$\{id\}`/.test(p);
  return missing.length === 0 && rng ? true : `missing layers: ${JSON.stringify(missing)} rangeDrop=${rng}`;
});
chk("P05703", "nothing in page.tsx hand-rolls pushState / popstate", () =>
  !/pushState|replaceState|popstate/.test(p) ? true : "the page hand-rolls history");
chk("P05704", "a drill LEVEL is a back step too, not only a popup", () =>
  /useBackClose\("owner-drill-restaurant"/.test(p) && /useBackClose\("owner-drill-dish"/.test(p)
    ? true : "a drill level is no longer a back step");
chk("P05712", "no poll in page.tsx is faster than the 60s backstop", () => {
  const ms = [...p.matchAll(/useActiveAutoRefresh\([^,]*,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  const timers = [...p.matchAll(/setInterval\([^,]*,\s*(\d+)/g)].map((m) => Number(m[1]));
  const all = [...ms, ...timers];
  return all.length >= 1 && all.every((v) => v >= 60000) ? true : `poll intervals = ${JSON.stringify(all)}`;
});
chk("P05713", "the dashboard's overview read is shared with the shell's, not duplicated", () =>
  /fetchOwnerOverview\(scp\)/.test(p) && !/fetch\(`\/api\/owner\/overview/.test(p)
    ? true : "the dashboard fetches the overview directly instead of through the shared cache");
chk("P05714", "analytics reads are cached client-side per (scope, range)", () =>
  /const \[cache, setCache\] = useState<Record<string, Payload>>\(\{\}\);/.test(p)
    && /const key = `\$\{sk\}\|\$\{range\}`;/.test(p) ? true : "the per-(scope,range) cache changed");
chk("P05715", "the mini feed asks for 6 rows, not a page of 200", () =>
  /limit=6/.test(p) ? true : "the feed limit changed");
chk("P05721", "dashboard figures come from the compute-on-view snapshot cache", () => {
  const a = code(ANALYTICS);
  return count(a, /cachedOwnerPayload\(\{/g) === 2 ? true : "one of the two scopes no longer uses the snapshot cache";
});
chk("P05722", "Refresh is the only thing that forces a recompute", () => {
  const a = code(ANALYTICS);
  const forces = [...a.matchAll(/force: ([^,\n]*)/g)].map((m) => m[1].trim());
  return forces.length === 2 && forces.every((f) => f === 'sp.get("refresh") === "1"')
    ? true : `force expressions = ${JSON.stringify(forces)}`;
});
chk("P05723", "there is no blind cron behind any of these numbers", () => {
  const a = code(ANALYTICS), o = code(OVERVIEW);
  return !/cron|schedule\(|setInterval/.test(a) && !/cron|schedule\(|setInterval/.test(o)
    ? true : "a scheduled job appeared in one of the two routes";
});
chk("P05729", "lfh_theme (the guest key) is never read or written in page.tsx or layout.tsx", () =>
  !/lfh_theme/.test(p) && !/lfh_theme/.test(code(LAYOUT)) ? true : "the guest theme key leaked in");
chk("P05733", "nothing in my territory adds a bill-delete route (R27)", () =>
  !/delete[A-Za-z]*Bill|bill[_-]?delete/i.test(p) ? true : "a bill-delete path appeared");
chk("P05735", "every figure on the owner home says which period it covers", () => {
  // every chart card carries a period chip, and every tile a period caption
  const chips = count(p, /className="ow2-tag"/g);
  return chips >= 6 ? true : `only ${chips} period chips on the page`;
});

// ── the Coming-soon pair ─────────────────────────────────────────────────────────────────────
chk("P05795", "the two Coming-soon sections land on a real page", () => {
  const m = src(MKT), o = src(ONL);
  return /<ComingSoon/.test(m) && /<ComingSoon/.test(o) ? true : "one of the two is not a ComingSoon page";
});
chk("P05796", "the Coming-soon page says plainly it is not built yet", () => {
  const cs = src("components/ComingSoon.tsx");
  return /not (built|ready)|coming soon|on the way|isn.t here yet/i.test(cs)
    ? true : "ComingSoon does not say it is unbuilt";
});
chk("P05797", "the Coming-soon pages carry no toggle, permission or module of their own", () => {
  const m = code(MKT), o = code(ONL);
  return !/entitlement|permission|useFeatures|settings/i.test(m) && !/entitlement|permission|useFeatures|settings/i.test(o)
    ? true : "a Coming-soon page grew a gate";
});
chk("P05798", "/owner/marketing names what it will do in the owner's words", () => {
  const t = src(MKT);
  return /Coupons & happy-hour pricing/.test(t) && /Campaign ROI tracking/.test(t) && /Marketing & offers/.test(t)
    ? true : "the marketing copy changed";
});
chk("P05799", "/owner/online names what it will do in the owner's words", () => {
  const t = src(ONL);
  return /Unified Zomato \/ Swiggy inbox/.test(t) && /Online & aggregators/.test(t)
    ? true : "the online copy changed";
});
chk("P05800", "neither Coming-soon page fetches anything", () =>
  !/fetch\(|await /.test(code(MKT)) && !/fetch\(|await /.test(code(ONL))
    ? true : "a Coming-soon page issues a request");

// ── the two routes that feed the dashboard ───────────────────────────────────────────────────
chk("P05807", "the overview answers one row per restaurant for the caller's own scope", () => {
  const o = code(OVERVIEW);
  return /const allow = scope\.all \? null : new Set\(scope\.ids\);/.test(o)
    && /\.filter\(\(r: Row\) => !allow \|\| allow\.has\(r\.restaurant_id\)\)/.test(o)
    ? true : "the overview's own scope filter changed";
});
chk("P05808", "the overview's entitlements map is built from the shared key list", () => {
  const o = code(OVERVIEW);
  return /getOwnerEntitlementsUnion\(scope\.ids\)/.test(o) && /mergeOwnerEntitlements\(null\)/.test(o)
    ? true : "the entitlements are no longer built from the shared helpers";
});
chk("P05809", "the overview's entitlements map has no `activity` SECTION key, and the page never reads one", () => {
  // The row is about the entitlements MAP the overview sends. `lib/ownerEntitlements.ts` does
  // contain the word, in `logViewSubset(part: "removals" | "activity")` — the finer cut INSIDE
  // the `logs` section, which is a different thing. Asserting on the bare word was a detector
  // fault that would have sent the next reader to "fix" a working helper.
  const keysBlock = /OWNER_SECTION_KEYS[^=]*=\s*\[([\s\S]*?)\]/.exec(code("lib/ownerEntitlements.ts"));
  if (!keysBlock) return "OWNER_SECTION_KEYS not found";
  const isSectionKey = /["']activity["']/.test(keysBlock[1]);
  const pageReads = /entitlements\?\.activity/.test(p);
  return !isSectionKey && !pageReads
    ? true : `activity is a section key=${isSectionKey}; the page reads it=${pageReads}`;
});

report("T13 replay · T12 round 1 (P05501–P06000, the rows this terminal owns)", { minChecks: 120 });
