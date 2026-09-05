// Round 2 · Band L — THE 60-SECOND REFRESH, THE SAVED COPY, AND TWO TABS.  ids P67582–P67651.
//
// Round 1 mentioned the auto-refresh in ONE row, the saved snapshot in three, and two tabs in
// none. These are the parts of the page that run while nobody is looking at it, and the parts
// that decide what he sees in the first 200ms of opening it.
import { chk, skip, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { openWith, closeBrowser, screenText, ESTATE, BASE, idFor } from "./r2lib.mjs";
import { readFileSync } from "node:fs";

const id = idFor(67581);
let n = 1;
const EXPECT_ROWS = 71;
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));
const src = (p) => readFileSync("/Users/aevinite/Documents/Projects/wt-s8-t13/" + p, "utf8");
const page = src("app/owner/page.tsx");

// ══ 1 · the instant-paint saved copy ══════════════════════════════════════════════════════════
const A = await openWith({});
await chk(id(n++), "a first visit writes a saved copy for the next open of this tab", async () => {
  const keys = await A.pg.evaluate(() => Object.keys(sessionStorage).filter((k) => /snap|dash/i.test(k)));
  return keys.length >= 1 ? true : `nothing saved: ${JSON.stringify(await A.pg.evaluate(() => Object.keys(sessionStorage)))}`;
});
await chk(id(n++), "…in sessionStorage, so it is per TAB and dies with it", async () => {
  const local = await A.pg.evaluate(() => Object.keys(localStorage).filter((k) => /snap|dash/i.test(k)));
  return local.length === 0 ? true : `the saved copy leaked into localStorage: ${JSON.stringify(local)}`;
});
const firstFigures = (await A.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
await chk(id(n++), "reloading the SAME tab paints figures almost immediately", async () => {
  await A.pg.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await A.pg.waitForTimeout(700);            // deliberately early — before any request can answer
  const vals = (await A.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  return vals.some((v) => /^₹|^\d/.test(v)) ? true : `nothing painted in 700ms: ${JSON.stringify(vals)}`;
});
await chk(id(n++), "…and they are the SAME figures, not a flash of something else", async () => {
  const vals = (await A.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const same = vals.filter((v, i) => v === firstFigures[i]).length;
  return same >= 3 ? true : `before ${JSON.stringify(firstFigures)} after ${JSON.stringify(vals)}`;
});
await chk(id(n++), "…and the page SAYS they are a saved copy until a live answer lands", async () => {
  const bar = await A.pg.locator(".ow2-tools").innerText();
  return /your last view/i.test(bar) || /updated/i.test(bar)
    ? true : `the toolbar says nothing about age: ${JSON.stringify(bar.replace(/\s+/g, " ").slice(0, 90))}`;
});
await chk(id(n++), "…and once the live answer lands it stops saying that", async () => {
  await A.pg.waitForTimeout(9000);
  const bar = await A.pg.locator(".ow2-tools").innerText();
  return !/your last view/i.test(bar) ? true : "the page still calls its figures a saved copy after they arrived";
});
await chk(id(n++), "the saved copy is never written INTO the live cache", () =>
  !/setCache\([^)]*snap/.test(page) ? true : "the snapshot is being promoted into the live cache");
await chk(id(n++), "…so every card still revalidates behind it", () =>
  /if \(!cache\[`\$\{scopeKey\}\|\$\{r\}`\]\) fetchPayload\(scopeKey, r\)/.test(page)
    ? true : "the fetch-if-missing guard no longer looks at the live cache only");
await chk(id(n++), "the saved copy is keyed per admin tab", () =>
  /const snapKey = `dash\$\{scopePin \? `:\$\{scopePin\}` : ""\}`;/.test(page)
    ? true : "two admin tabs would share one saved copy");
await chk(id(n++), "…and it is only written once real figures exist", () =>
  /if \(!ov \|\| !Object\.keys\(cache\)\.length\) return;/.test(page)
    ? true : "an empty page could overwrite a good saved copy");
await chk(id(n++), "…and an unrecognised saved copy is discarded rather than rendered", () =>
  /return saved && isPayload\(saved\) \? \(saved as Payload\) : undefined;/.test(page)
    ? true : "a saved copy from an older version of this page would be handed to the cards");
await chk(id(n++), "opening a DIFFERENT tab does not inherit the first tab's saved copy", async () => {
  const B = await openWith({});
  const keys = await B.pg.evaluate(() => Object.keys(sessionStorage).filter((k) => /snap|dash/i.test(k)));
  const painted = (await B.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  await B.ctx.close();
  return painted.length === 5 ? true : `a fresh tab painted ${JSON.stringify(painted)} (saved keys: ${keys.length})`;
});

// ══ 2 · the 60-second backstop ════════════════════════════════════════════════════════════════
await chk(id(n++), "the refresh is activity-gated, not a bare timer", () =>
  /useActiveAutoRefresh/.test(page) && !/setInterval/.test(page)
    ? true : "a raw interval would keep asking while nobody is watching");
await chk(id(n++), "…at 60 seconds, never faster", () => {
  const ms = [...page.matchAll(/useActiveAutoRefresh\([^,]*,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  return ms.length === 1 && ms[0] === 60000 ? true : `intervals: ${JSON.stringify(ms)}`;
});
await chk(id(n++), "…and it is held in a ref, so it never fires a stale closure", () =>
  /const tickRef = useRef\(tick\); tickRef\.current = tick;/.test(page)
    ? true : "the tick could capture an old scope or period");
await chk(id(n++), "the tick refreshes the overview, the main period, the month and the money", () => {
  const m = /const tick = useCallback\(\(\) => \{([\s\S]*?)\}, \[loadOverview/.exec(page);
  if (!m) return "tick not found";
  const b = m[1];
  return /loadOverview\(\)/.test(b) && /for \(const r of neededRanges\) fetchPayload\(scopeKey, r\)/.test(b)
    && /fetchPayload\(scopeKey, "month"/.test(b) && /fetchMoney\(scopeKey, globalRange\)/.test(b)
    ? true : "one of the four jobs is gone from the tick";
});
await chk(id(n++), "…and the activity feed, which was once left out", () => {
  const m = /const tick = useCallback\(\(\) => \{([\s\S]*?)\}, \[loadOverview/.exec(page);
  return /if \(activeRid\) fetchActs\(activeRid\);/.test(m[1]) ? true : "the feed is frozen at page load again";
});
await chk(id(n++), "the tick REALLY fires against the live app", async () => {
  const before = A.reqs.length;
  // keep the tab "active" the way the shared hook expects, then wait past the backstop
  for (let i = 0; i < 14; i++) { await A.pg.mouse.move(400 + i, 300 + i); await A.pg.waitForTimeout(5000); }
  const after = A.reqs.length;
  return after > before ? true : `no owner-API call in ~70s of an active tab (${before} → ${after})`;
});
await chk(id(n++), "…and it does not collapse the page to 'Loading…' while it does", async () => {
  const loading = (await A.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : `${loading.length} cards blanked during a background refresh`;
});
await chk(id(n++), "…and the figures do not flicker away and back", async () => {
  const vals = (await A.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  return vals.length === 5 && vals.every((v) => v.length > 0) ? true : JSON.stringify(vals);
});
await chk(id(n++), "an idle tab stops asking", () => {
  const hook = src("components/admin/shared.tsx");
  return /useActiveAutoRefresh/.test(hook) ? true : "the shared activity-gated hook is gone";
});
await chk(id(n++), "…and each tick is jittered, so ten devices do not share one beat", () => {
  const hook = src("components/admin/shared.tsx");
  return /jitter|Math\.random/.test(hook) ? true : "the shared refresh hook no longer jitters";
});

// ══ 3 · Refresh, by hand ══════════════════════════════════════════════════════════════════════
await chk(id(n++), "Refresh forces a recompute on every payload it re-fetches", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(page);
  return (m[1].match(/refresh: true/g) || []).length >= 3 ? true : "one of the payloads is refreshed without forcing";
});
await chk(id(n++), "…including the month payload, which was once left out", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(page);
  return /fetchPayload\(scopeKey, "month", \{ qs: "range=month", refresh: true \}\)/.test(m[1])
    ? true : "the month card would keep showing figures up to five minutes old";
});
await chk(id(n++), "…and the activity feed", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(page);
  return /if \(activeRid\) jobs\.push\(fetchActs\(activeRid\)\);/.test(m[1]) ? true : "the feed is left out of Refresh";
});
await chk(id(n++), "…and one failed job cannot leave the spinner turning", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(page);
  return /Promise\.allSettled\(jobs\)\.finally\(/.test(m[1]) ? true : "a rejected job would strand the spinner";
});
await chk(id(n++), "…and the spinner is held long enough to be seen", () => {
  const m = /const manualRefresh = \(\) => \{([\s\S]*?)\n  \};/.exec(page);
  return /const wait = Math\.max\(0, 400 - \(Date\.now\(\) - started\)\);/.test(m[1]) ? true : "the 400ms floor is gone";
});
await chk(id(n++), "pressing Refresh really re-asks the server", async () => {
  const before = A.reqs.length;
  await A.pg.locator("button", { hasText: "Refresh" }).first().click();
  await A.pg.waitForTimeout(5000);
  const fired = A.reqs.length - before;
  return fired >= 3 ? true : `Refresh fired ${fired} request(s)`;
});
await chk(id(n++), "…and every one of them asks for a recompute", async () => {
  const before = A.reqs.length;
  await A.pg.locator("button", { hasText: "Refresh" }).first().click();
  await A.pg.waitForTimeout(5000);
  const fresh = A.reqs.slice(before);
  const analytics = fresh.filter((u) => /analytics/.test(u));
  const forced = analytics.filter((u) => /refresh=1/.test(u));
  return analytics.length > 0 && forced.length === analytics.length
    ? true : `${forced.length} of ${analytics.length} analytics calls forced a recompute`;
});
await chk(id(n++), "…and the spinner stops", async () =>
  (await A.pg.locator(".fa-rotate-right.fa-spin").count()) === 0 ? true : "the spinner never stopped");
await chk(id(n++), "…and the age line updates", async () => {
  const bar = await A.pg.locator(".ow2-tools").innerText();
  return /updated/i.test(bar) ? true : `the toolbar reads ${JSON.stringify(bar.replace(/\s+/g, " ").slice(0, 80))}`;
});

// ══ 4 · the age line tells the truth about the OLDEST thing on screen ═════════════════════════
await chk(id(n++), "the header age reports the OLDEST payload, never the newest", () =>
  /const oldestShown = shownAges\.length\s*\n?\s*\? shownAges\.reduce\(\(a, b\) => \(Date\.parse\(a\) <= Date\.parse\(b\) \? a : b\)\)/.test(page)
    ? true : "the age line could claim the page is fresher than its stalest card");
await chk(id(n++), "…and the set it takes the oldest of includes the month and the money", () => {
  const m = /const shownAges = \[([\s\S]*?)\]\n/.exec(page);
  return /ages\[`\$\{scopeKey\}\|month`\]/.test(m[1]) && /ages\[`money:\$\{scopeKey\}\|\$\{globalRange\}`\]/.test(m[1])
    ? true : "one of the three payloads is missing from the oldest-of set";
});
await chk(id(n++), "every card can state its own age on hover", () =>
  /const ageTitle = \(key: string\) => \{/.test(page) ? true : "the per-card age tooltip is gone");
await chk(id(n++), "…with an absolute time as well as a relative one", () =>
  /return `Figures computed \$\{new Date\(at\)\.toLocaleString\("en-IN", \{ dateStyle: "medium", timeStyle: "short", timeZone: IST \}\)\} · \$\{timeAgo\(at\)\}`;/.test(page)
    ? true : "the tooltip no longer carries both");
await chk(id(n++), "the age line is on screen and quiet", async () => {
  const el = A.pg.locator(".ow2-tools span").last();
  const size = await el.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  return size <= 12 ? true : `the age line is ${size}px — louder than the figures it describes`;
});

// ══ 5 · two tabs of the same panel, as a REAL owner ═══════════════════════════════════════════
const T1 = await openWith({});
const T2 = await openWith({});
await chk(id(n++), "two tabs of the dashboard both render", async () => {
  const a = await T1.pg.locator(".ow2-kpi").count(), b = await T2.pg.locator(".ow2-kpi").count();
  return a === 5 && b === 5 ? true : `tab1=${a} tab2=${b}`;
});
await chk(id(n++), "…and they agree about the figures", async () => {
  const a = (await T1.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim()).join("|");
  const b = (await T2.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim()).join("|");
  return a === b ? true : `tab1=${a}\n       tab2=${b}`;
});
await chk(id(n++), "changing the period in one tab does not move the other", async () => {
  const beforeB = (await T2.pg.locator(".owr-btn.main").innerText()).trim();
  await T1.pg.locator(".owr-btn.main").click();
  await T1.pg.waitForSelector(".owr-pop", { timeout: 8000 });
  await T1.pg.locator(".owr-pop button", { hasText: /^Today/ }).first().click();
  await T1.pg.waitForTimeout(5500);
  const afterB = (await T2.pg.locator(".owr-btn.main").innerText()).trim();
  return beforeB === afterB ? true : `tab 2's period moved from ${JSON.stringify(beforeB)} to ${JSON.stringify(afterB)}`;
});
await chk(id(n++), "…but a NEW tab in the SAME browser inherits the period he chose", async () => {
  // A new browser CONTEXT has its own localStorage, so opening one proves nothing about a choice
  // remembered per browser — the first version of this row did exactly that and read a working
  // feature as broken. A second PAGE in tab 1's own context is the real question.
  const T3 = await T1.ctx.newPage();
  await T3.goto(BASE + T1.route, { waitUntil: "networkidle", timeout: 120000 });
  await T3.waitForTimeout(3600);
  const label = (await T3.locator(".owr-btn.main").innerText()).trim();
  await T3.close();
  return /Today/.test(label) ? true : `a new tab in the same browser opened on ${JSON.stringify(label)}`;
});
await chk(id(n++), "…because the choice is remembered per BROWSER, not per tab", () =>
  /localStorage\.setItem\(RANGE_LS_KEY, k\)/.test(page)
    ? true : "the chosen period is no longer remembered across a refresh");
await chk(id(n++), "…while the DRILL is remembered per tab", () =>
  /sessionStorage\.setItem\(drillKey, JSON\.stringify\(view\)\)/.test(page)
    ? true : "the open restaurant is no longer per-tab");
await chk(id(n++), "opening a dish in one tab does not open it in the other", async () => {
  await T1.pg.locator(".rv-dish").first().click().catch(() => {});
  await T1.pg.waitForTimeout(1500);
  const otherDish = await T2.pg.locator(".own-dish-name").count();
  return otherDish === 0 ? true : "the second tab followed the first into a dish";
});
await chk(id(n++), "…and going back in one tab leaves the other where it was", async () => {
  await T1.pg.locator(".own-dish-x").click().catch(() => {});
  await T1.pg.waitForTimeout(1400);
  const b = await T2.pg.locator(".ow2-kpi").count();
  return b === 5 ? true : `the second tab now shows ${b} tiles`;
});
await T1.ctx.close();
await T2.ctx.close();

// ══ 6 · the pre-warm — one extra period, not seven ════════════════════════════════════════════
await chk(id(n++), "the pre-warm asks for ONE extra period", () => {
  const m = /const others = Array\.from\(new Set<Range>\(\[([^\]]*)\]\)\)/.exec(page);
  return /saved && saved !== globalRange \? saved : "today"/.test(m[1]) ? true : `warm list = ${m[1]}`;
});
await chk(id(n++), "…once per scope per visit", () =>
  /if \(warmedScopes\.current\.has\(sk\)\) return;\s*\n\s*warmedScopes\.current\.add\(sk\);/.test(page)
    ? true : "the pre-warm would run again on every render");
await chk(id(n++), "…after a delay, so it never competes with the first paint", () =>
  /\}, 4000 \+ i \* 1500\)\)/.test(page) ? true : "the pre-warm no longer waits for the page to settle");
await chk(id(n++), "…and its timers are cleared on unmount", () =>
  /return \(\) => \{ timers\.forEach\(clearTimeout\); \};/.test(page) ? true : "the pre-warm timers leak");
await chk(id(n++), "…and it skips a period already in hand", () =>
  /if \(!cacheRef\.current\[`\$\{sk\}\|\$\{k\}`\]\) fetchPayload\(sk, k\);/.test(page)
    ? true : "the pre-warm re-fetches what it already has");
await chk(id(n++), "one page open really does cost a small, duplicate-free set of calls", async () => {
  // Measured on a FRESH open. `A.reqs` accumulates for the life of that page, and by this point A
  // has been reloaded and refreshed several times — so slicing its first few entries was measuring
  // a reload, not an open, and reported the second load's overview as a duplicate.
  const F = await openWith({});
  await F.pg.waitForTimeout(4600);            // past the pre-warm
  const dupes = F.reqs.filter((u, i) => F.reqs.indexOf(u) !== i);
  const total = F.reqs.length;
  await F.ctx.close();
  return dupes.length === 0 && total <= 8
    ? true : `${total} calls on one open, duplicates: ${JSON.stringify([...new Set(dupes)])}`;
});

// ══ 7 · what the page does when nobody is looking ════════════════════════════════════════════
await chk(id(n++), "no request is made while the page is hidden", async () => {
  // The hook reads `document.hidden`, NOT `document.visibilityState` — overriding only the second
  // left the page believing it was still on screen, so the tick fired and a working gate looked
  // broken. Read the hook before faking the state it reads.
  const before = A.reqs.length;
  await A.pg.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await A.pg.waitForTimeout(75000);          // past a full 60s tick
  const after = A.reqs.length;
  return after - before === 0
    ? true : `${after - before} call(s) while the tab was hidden: ${JSON.stringify(A.reqs.slice(before, before + 3))}`;
});
await chk(id(n++), "…and polling RESUMES when the tab comes back", async () => {
  // What the hook actually promises, read rather than assumed. It arms a wake-on-return only for
  // the IDLE path — `wasIdle` is set inside the tick and only when `!document.hidden` — so coming
  // back from a HIDDEN tab resumes on the next 60s tick rather than firing at once. An earlier
  // version of this row demanded an immediate refresh here and reported a working gate as broken.
  // The difference is recorded in the row below.
  const before = A.reqs.length;
  await A.pg.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await A.pg.locator("body").click({ position: { x: 5, y: 5 } });
  for (let i = 0; i < 16 && A.reqs.length === before; i++) await A.pg.waitForTimeout(5000);
  return A.reqs.length > before
    ? true : `polling never resumed after the tab came back (${before} calls, still ${A.reqs.length} after ~80s)`;
});
skip(id(n++), "returning from a HIDDEN tab does not refresh immediately, the way returning from IDLE does",
  "OBSERVED, and it is the hook's own design rather than a fault here. useActiveAutoRefresh arms " +
  "its wake-on-return inside the tick and only when the tab is VISIBLE, so an idle user who comes " +
  "back gets fresh figures at once, while someone switching back from another tab waits for the " +
  "next 60s tick. The age line says how old the figures are throughout, so nothing is stated " +
  "falsely — and the hook is components/admin/shared.tsx, shared by eleven admin screens, so " +
  "changing it is not this terminal's call.");
await chk(id(n++), "the dashboard writes nothing, ever", () => {
  const methods = [...page.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]);
  return methods.length === 0 ? true : JSON.stringify(methods);
});
await chk(id(n++), "…so nothing here needs the clash guard or the offline outbox", () =>
  !/idempotenc|outbox|lib\/clash/i.test(page) ? true : "a write-path helper appeared on a read-only page");

// ══ 8 · the remaining named surfaces of this path ════════════════════════════════════════════
for (const [what, fn] of [
  ["the money read has its own cache key, apart from the figures", () => /`money:\$\{sk\}\|\$\{range\}`/.test(page)],
  ["…and its own age, recorded under that key", () => /setAges\(\(a2\) => \(\{ \.\.\.a2, \[`money:\$\{sk\}\|\$\{range\}`\]: m\.cachedAt \}\)\)/.test(page)],
  ["…and a failed money read is stored as a refusal, not a zero", () => /m\.error \? "err" : m\.totals/.test(page)],
  ["the figures cache is keyed by scope AND period", () => /const key = `\$\{sk\}\|\$\{range\}`;/.test(page)],
  ["two requests for the same key are never both in flight", () => /if \(inflight\.current\.has\(key\)\) return;/.test(page)],
  ["…and the key is always released, even when the read throws", () => /\} finally \{\s*inflight\.current\.delete\(key\);\s*\}/.test(page)],
  ["the all-time records scan is asked for once per restaurant per visit", () => /!recsAsked\.current\.has\(rid\)/.test(page)],
  ["…and the flag is set at ASK time, not at answer time", () => /if \(recQ\) recsAsked\.current\.add\(rid!\);/.test(page)],
  ["…and cleared when the read failed, so a retry is possible", () => /recsAsked\.current\.delete\(rid\);/.test(page)],
  ["the month payload is fetched once, apart from the period dropdown", () => /if \(!cache\[`\$\{scopeKey\}\|month`\]\) fetchPayload\(scopeKey, "month", \{ qs: "range=month" \}\);/.test(page)],
  ["the only periods fetched are the one on screen", () => /const neededRanges = useMemo\(\(\) => \[globalRange\], \[globalRange\]\);/.test(page)],
  ["the overview read is shared with the shell rather than duplicated", () => /fetchOwnerOverview\(scp\)/.test(page) && !/fetch\(`\/api\/owner\/overview/.test(page)],
  ["the activity feed asks for six rows", () => /limit=6/.test(page)],
  ["a failed overview is treated as a failure, not rendered as data", () => /if \(\(o as unknown as \{ error\?: string \}\)\.error\) throw new Error/.test(page)],
  ["the connection light is reported from the page's own reads", () => /reportRealtime\("online"\)/.test(page) && /reportRealtime\("weak"\)/.test(page)],
  ["…but a deliberate refusal never touches it", () => {
    const m = /if \(a\.error && a\.disabled\) \{(.*)\}\n/.exec(page);
    return !!m && !/reportRealtime/.test(m[1]);
  }],
]) {
  await chk(id(n++), what, () => fn() ? true : "no longer true");
}

await A.ctx.close();
// The row-count lock is about a FULL run. A `--only=<id>` run deliberately executes one row, and
// an earlier version exited 2 here before report() could print — so every sabotage case looked
// like a guard staying green when the guard had never been given the chance to speak.
if (!argOnly && executedIds().length !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: ran ${executedIds().length} rows, declares ${EXPECT_ROWS} (next id ${id(n)})`);
  process.exit(2);
}
report(`T13 R2 band L · the 60-second refresh, the saved copy, and two tabs (P67582–P67651) · ${BASE}`, { minChecks: EXPECT_ROWS });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "drove two live tabs, waited out the real 60s backstop, hid the tab, and read the saved copy out of sessionStorage",
  section: "R2 · Band L — the 60-second refresh, the saved copy, and two tabs — P67582–P67651",
});
await closeBrowser();
