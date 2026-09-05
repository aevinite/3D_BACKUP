#!/usr/bin/env node
// verify-owner-screen.mjs — the owner's HOME screen and his Audit & logs page.
//
// WHY THIS EXISTS. Every check below is a fault that actually shipped and was found by the T12
// sweep on 2026-08-17, so each one is a regression test rather than a style opinion. Three of them
// were faults that a green test suite could never have caught, because the code ran perfectly and
// simply did not do what the screen promised.
//
//   1.  The dashboard hero's middle shortcut said "Staff & powers" while the sidebar three inches
//       away said "Team" and the page itself is headed "Team & pay". The sidebar was corrected on
//       2026-08-05; the shortcut was missed.
//   2.  The Recent-activity card gated its "See all" link on `entitlements.activity` — a key the
//       server has NEVER sent (the section is `logs`). `undefined !== false` is always true, so the
//       gate was decorative.
//   3.  A 403 + `disabled: true` from /api/owner/oplog folded into the same `null` the card renders
//       as "Loading…", so the card span for ever on the screen an owner opens every day.
//   4.  The 60s backstop refreshed everything on the dashboard EXCEPT the activity feed, which was
//       therefore frozen at page load while the numbers beside it stayed fresh.
//   5.  A deliberate "Reports aren't enabled" answer was printed in a RED card headed "Couldn't
//       load.", over six cards stuck on "Loading…", three blank tiles and five links into a hub
//       that would only refuse him.
//   6.  The removals record's money line described ONE page while calling itself a total.
//   7.  The Activity log's type chips and sort select were computed into a variable and thrown
//       away — the list rendered the raw page, so both controls were dead. eslint had been
//       reporting the unused variable the whole time.
//   8.  The dish drill was not a back step and its scroll memory addressed `.adm-main`, which is
//       `overflow-y: visible` at <=900px. On a phone there was NO way back from a dish at all.
//   9.  The Manager-mode breadcrumb dispatched an event only the dashboard and the reports hub
//       listen for, so on /owner/manager it was a silent dead tap.
//   10. Tapping the sidebar's "Dashboard" while a dish was open did nothing, because Next does not
//       remount the route you are already on.
//
// The T12 sweep of 2026-08-27 added six more, all of the same shape — code that ran perfectly and
// did not say what was true:
//
//   11. The Activity log's search and severity chips are SERVER-side, so narrowing to nothing made
//       the server answer with zero rows — and the branch that fired was worded for an empty
//       record: "No staff activity yet — it appears here as your team works.", over 8,829 entries.
//   12. "Today so far" reads the overview rather than analytics, so the switched-off state never
//       reached it. /api/owner/overview zeroes that restaurant's day on purpose, so the row read
//       "— · — · ₹0, 0 orders today · — · —" — one confident false zero beside four honest dashes.
//   13. Two owner-panel writers log the owner's uuid as the actor, and both of these screens
//       printed it verbatim in the person column: "Handled a rating · c0af7b5b-…-f475e48bab53".
//   14. /api/owner/analytics has sent partial: ["records"] since 2026-08-12 and nothing on the
//       dashboard ever read it, so a failed all-time-records read still left the card silently
//       absent — the exact fault that key was added to end.
//   15. A food-loss read that FAILED (null, never a zero, by the route's own rule) printed as a
//       flat "− ₹0" in the On hand popup under a headline "Money on hand", and the Expenses tile
//       face said nothing either.
//   16. A Recent-activity read that failed also landed on null, which the card renders as
//       "Loading…" — the same fault the 403 branch was fixed for, one branch over.
//
// Static + instant: no server, no database, no browser.
// Run: node scripts/verify-owner-screen.mjs   (or npm run verify:owner-screen)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

const home = read("app/owner/page.tsx");
const audit = read("app/owner/activity/page.tsx");
const shell = read("components/owner/OwnerShell.tsx");
const ents = read("lib/ownerEntitlements.ts");
const pkg = read("package.json");

// Comments carry a lot of the reasoning in this codebase, and several checks below are about what
// the CODE does — so strip comments before asserting on behaviour.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const homeC = code(home), auditC = code(audit), shellC = code(shell);

const fails = [];
let total = 0;
const check = (name, ok, hint) => { total++; if (!ok) fails.push(`${name}\n     → ${hint}`); };

if (!home || !audit || !shell) {
  console.error("✗ could not read the owner home / audit / shell files — has the territory moved?");
  process.exit(2);
}

// ── 1. one name for the Team section ────────────────────────────────────────────────────────────
check("the dashboard hero does not say \"Staff & powers\"",
  !/Staff\s*&amp;\s*powers|Staff & powers/.test(homeC),
  "app/owner/page.tsx: the hero shortcut is back to \"Staff & powers\". The sidebar says \"Team\" and\n       the page it opens is headed \"Team & pay\" — one screen must not have two names.");

// ── 2. gate on an entitlement the server actually sends ─────────────────────────────────────────
check("the dashboard reads no entitlement key the server does not send",
  !/entitlements[?]?\.\s*activity/.test(homeC),
  "app/owner/page.tsx: something gates on `entitlements.activity` again. There is no such key —\n       OWNER_SECTION_KEYS calls the section `logs`, so that test is always true and gates nothing.");
check("`logs` is still a real entitlement key",
  /"logs"/.test(ents),
  "lib/ownerEntitlements.ts no longer lists `logs` in OWNER_SECTION_KEYS. If the section was\n       renamed, app/owner/page.tsx and components/owner/OwnerShell.tsx must follow in the same commit.");
check("the Recent-activity card is gated on `logs`",
  /entitlements[?]?\.\s*logs\s*!==\s*false/.test(homeC),
  "app/owner/page.tsx: the Recent-activity card no longer checks the `logs` entitlement, so it\n       will render for an owner whose Audit & logs the admin has switched off.");

// ── 3. "switched off" is not "still loading" ─────────────────────────────────────────────────────
check("the activity feed tells a refusal apart from an empty answer",
  /j\.disabled/.test(auditC.slice(0, 0) + homeC) && /setActsOff\(true\)/.test(homeC),
  "app/owner/page.tsx: fetchActs no longer reads `disabled` from the answer, so a 403 becomes the\n       same `null` as \"nothing arrived\" and the card sits on \"Loading…\" for ever.");
check("the card is left out entirely when the log is off",
  // Re-pinned 2026-09-05 (T13 round 2). This asserted the INLINE form `!actsOff &&` and went red
  // when that condition was named `logsCardOn` and reused by the row's column count — a refactor,
  // not a regression, and the behaviour is identical. What the row is about: the card's render
  // gate must still depend on actsOff, however it is spelled, and the gate must be a WITHHOLDING
  // one (the card absent) rather than a disabled shell.
  (/!actsOff\s*&&/.test(homeC) || /const logsCardOn = [^;]*!actsOff/.test(homeC))
    && /\{logsCardOn && \(|!actsOff && \(/.test(homeC),
  "app/owner/page.tsx: the Recent-activity card no longer depends on `actsOff`. Module checklist\n       point 6: render nothing when the flag is off — never a card that spins for ever.");

// ── 4. the activity feed rides the 60s backstop ─────────────────────────────────────────────────
{
  const tick = (homeC.match(/const tick = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/) || [""])[0];
  check("the 60s backstop refreshes the activity feed too",
    /fetchActs\(/.test(tick),
    "app/owner/page.tsx: `tick` no longer re-fetches the activity feed, so the card headed \"who did\n       what\" freezes at page load while every other card on the screen stays 60s fresh.");
}

// ── 5. a switched-off section reads as off, not broken ──────────────────────────────────────────
check("a `disabled` analytics answer goes to its own state, not the error banner",
  /a\.disabled.*setOffScope/.test(homeC) && !/a\.disabled\s*\)\s*\{\s*setErr\(errText/.test(homeC),
  "app/owner/page.tsx: the `disabled` branch of fetchPayload is putting the sentence back into\n       `err`, which renders in a RED card headed \"Couldn't load.\" A permission is not a breakage.");
// The refusal must be about ONE scope, or drilling into a reports-off restaurant would blank the
// group view the owner returns to — a return to a cached scope fires no fetch, so nothing would
// clear a scope-less flag.
check("the refusal is remembered per scope",
  /offScope && offScope\.scope === scopeKey/.test(homeC),
  "app/owner/page.tsx: the switched-off flag is no longer scope-aware. On an estate where one\n       restaurant has Reports removed, it would blank the group dashboard too.");
// Found in a light-skin screenshot of the switched-off state: the note said figures were not shown
// while the tiles still drew delta chips and sparklines and the payroll tiles printed real money,
// all of it from the instant-paint snapshot of an earlier visit.
check("no stale snapshot figure leaks through the switched-off state",
  // Re-pinned 2026-09-05 (T13 round 2). This asserted the one-line ternary `pl` used to be. `pl`
  // is now a block — it also refuses a snapshot whose SHAPE this version of the page does not
  // recognise — and the rule is unchanged: a refused scope yields no payload, from the live cache
  // or the saved one. Both halves are required, so neither can be dropped quietly.
  /if \(offScope && offScope\.scope === scopeKey\) return undefined;/.test(homeC)
    && /const saved = snap\?\.cache\?\.\[/.test(homeC),
  "app/owner/page.tsx: `pl` is serving the instant-paint snapshot again for a scope the server has\n       refused, so the page prints delta chips, sparklines, a full revenue chart and real payroll\n       money underneath a note saying the figures are not shown.");
check("no card claims to be loading once the section is known to be off",
  /const loadNote = offNote \?/.test(homeC) && (homeC.match(/\{loadNote\}/g) || []).length >= 12,
  "app/owner/page.tsx: the chart cards are back to a hardcoded \"Loading…\". Once the server has\n       said the section is switched off, no payload is coming and that promise is false — route\n       every placeholder through `loadNote` (12 of them at the time of writing).");
// The tiles open a popup now (owner, 2026-08-18), so "does it link" became "does it open at all":
// with the section off, no tile may offer a way in, and the popup's own footer says so instead of
// showing a live link into a hub that would refuse him.
check("no tile opens its popup when Reports are off",
  // Re-pinned 2026-09-05 (T13 round 2): the condition is now `dashed` (offNote OR a failed
  // overview), which is strictly wider — a tile with nothing behind it is not a button in EITHER
  // state. `dashed` is asserted to contain offNote alongside, so the original rule still holds.
  /onOpen=\{dashed \? undefined :/.test(homeC) && /const dashed = !!offNote \|\| ovFailed;/.test(homeC),
  "app/owner/page.tsx: a KPI tile opens its popup unconditionally again. With Reports switched off\n       there is nothing to show and nowhere to send him — the tile must not be a button.");
check("the popup's footer refuses instead of linking when Reports are off",
  /reportsOn \? \(/.test(homeC) && /Reports are switched off for this restaurant/.test(home),
  "app/owner/page.tsx: the tile popup's bottom button links into Reports even when the section is\n       switched off. Say so in the footer instead.");

// ── 6. the removals money line names its own slice ──────────────────────────────────────────────
check("the removals record says which slice its money figure covers",
  /on this page/.test(auditC),
  "app/owner/activity/page.tsx: the records line is back to \"N records · ₹X in total\" over a\n       single page of a paged record. Say \"on this page\" when there is more than one.");

// ── 7. the Activity log's own controls reach the rendered list ──────────────────────────────────
check("the Activity log renders the filtered, sorted list",
  /\{list\.map\(/.test(auditC) && !/\{rows\.map\(/.test(auditC),
  "app/owner/activity/page.tsx: the list is mapping `rows` again, so the type chips and the sort\n       select are dead controls — they were built for the owner on 2026-08-14. Map `list`.");
check("narrowing the Activity log to nothing has its own empty state",
  /Nothing of that kind on this page/.test(audit),
  "app/owner/activity/page.tsx: narrowing to an empty result no longer offers a way back out of\n       it, so it reads as \"nothing happened\" rather than \"nothing of that kind\".");

// ── 8. the drill is a back step, on the element that really scrolls ─────────────────────────────
check("the drill registers a back-stack layer per level",
  /useBackClose\("owner-drill-restaurant"/.test(homeC) && /useBackClose\("owner-drill-dish"/.test(homeC),
  "app/owner/page.tsx: the dish/restaurant drill is no longer a back step. On a 360px phone the\n       breadcrumb is display:none, so BACK is the ONLY way out of a dish — without these layers it\n       leaves the owner panel altogether.");
check("the drill's scroll memory finds the element that really scrolls",
  /function scrollPort\(\)/.test(homeC) && /\[".adm-main", ".adm"\]/.test(homeC),
  "app/owner/page.tsx: the scroll save/restore is addressing `.adm-main` alone again. At <=900px\n       globals.css makes that `overflow-y: visible` and `.adm` the scroller, so it silently does\n       nothing on a phone. Measured: 360x780 -> `.adm` 4109/780, `.adm-main` 4052/4052.");
check("nothing in my territory relies on the window scrolling",
  !/window\.scroll(To|By)\(/.test(homeC),
  "app/owner/page.tsx: something is calling window.scrollTo. The window NEVER scrolls on the owner\n       console at any width — measured 1280x800: document 800/800. Use scrollPort().");
// The Pager's own window.scrollTo is a documented no-op that is harmless ONLY because both loaders
// blank their rows first, which collapses the list and clamps the scroll to the top. Guard that,
// so the accident cannot be removed without noticing.
check("both log loaders blank their rows before fetching",
  /setRemovals\(null\); loadAudit\(\)/.test(auditC) && /setRows\(null\); loadActivity\(\)/.test(auditC),
  "app/owner/activity/page.tsx: a loader stopped blanking its rows first. That collapse is the ONLY\n       reason paging lands at the top of the list — the Pager's window.scrollTo cannot move the\n       owner console (see the check above). Keep it, or move the Pager onto the real scroll port.");

// ── 9 & 10. no silent dead taps in the shell ────────────────────────────────────────────────────
{
  const crumb = (shellC.match(/<button type="button" className="cr root"[\s\S]*?<\/button>/) || [""])[0];
  check("the breadcrumb's middle segment reaches Manager mode",
    /lfh:owner-manager-rid/.test(crumb),
    "components/owner/OwnerShell.tsx: the crumb button only dispatches lfh:owner-open-restaurant.\n       Manager mode listens on lfh:owner-manager-rid, so on /owner/manager the segment is a silent\n       dead tap — and a tap must never vanish in silence.");
}
{
  const nav = (shellC.match(/<Link key=\{it\.href\}[\s\S]*?title=\{on \?/) || [""])[0];
  check("tapping the section you are already in does something",
    /lfh:owner-open-restaurant/.test(nav),
    "components/owner/OwnerShell.tsx: the sidebar's own Dashboard link is a dead tap again while a\n       restaurant or dish is drilled open — Next does not remount the route you are on. On a phone\n       it is the only control the owner can see, because the breadcrumb is hidden there.");
}
check("Manager mode still listens on the channel the crumb now uses",
  /lfh:owner-manager-rid/.test(read("components/owner/OwnerManagerMode.tsx")),
  "components/owner/OwnerManagerMode.tsx no longer listens for lfh:owner-manager-rid, so the crumb\n       fix in OwnerShell.tsx has nothing to talk to. Change both in one commit.");

// ── the improvements, so they are not quietly undone ───────────────────────────────────────────
check("the activity card's empty state says what will fill it",
  !/adm-empty">Nothing yet\.<\/div>/.test(homeC),
  "app/owner/page.tsx: the Recent-activity empty state is back to a bare \"Nothing yet.\", which on\n       a new restaurant reads as a broken card rather than \"nobody has done anything yet\".");
check("Audit & logs refreshes through the console's shared activity-gated hook",
  /useActiveAutoRefresh\(/.test(auditC) && !/setInterval\(/.test(auditC),
  "app/owner/activity/page.tsx: the 60s refresh is hand-rolled again. The shared hook is what stops\n       it polling for a screen nobody is watching and what jitters the tick off a shared beat.");
check("every \"couldn't read part of this\" strip sits under its own card title",
  !/<PartialStrip[^\n]*\n\s*<div className="ow2-ct">/.test(home),
  "app/owner/page.tsx: a PartialStrip is back above its card's heading, where it floats at the top\n       of the card belonging to nothing. All four sit under their own title.");

// ── 11. the "live" pill carries its own readable ink ────────────────────────────────────────────
// Found by this sweep's SECOND pass, and made reachable by check 5 above: every KPI tile used to be
// a Link, and globals.css forces everything inside an anchor to inherit its colour, so the pill's
// declared flat emerald never applied and it measured 17.74:1 on the light skin. A tile that is NOT
// a link (which is now the case when Reports are off) applied the declared value and the same pill
// measured 1.92:1 on a white card. Measured after the fix: light 6.35:1, dark 8.3:1.
check("the \"live\" pill mixes its ink toward the skin's own text",
  /\.ow2-live \{[^}]*color: color-mix\(in srgb, var\(--accent\)/.test(home),
  "app/owner/page.tsx: .ow2-live is back to a flat colour. It is only readable by accident while\n       every tile is a Link — a tile without an href applies the declared value and lands at 1.92:1\n       on a white card. Mix the accent toward var(--text), like .ow2-split .txt em does.");

// ── 12. the tile row he asked for, 2026-08-18 ───────────────────────────────────────────────────
// "we can keep revenue, orders, today so far, expenses, on hand money" and "everything should be in
// the one line". Five tiles, in that order, and no sixth creeping back in.
{
  const labels = [...homeC.matchAll(/<Kpi k="([^"]+)"/g)].map((m) => m[1]);
  check("the tile row is the five he asked for, in his order",
    JSON.stringify(labels) === JSON.stringify(["Revenue", "Orders", "Today so far", "Expenses", "On hand"]),
    `app/owner/page.tsx: the tile row is ${JSON.stringify(labels)}. He asked for exactly Revenue,\n       Orders, Today so far, Expenses, On hand — five, so they fit one line. "Avg order" belongs in\n       the Orders popup and cancellations/staff pay in the Expenses and Revenue popups.`);
}
check("the row is laid out five across",
  /ow2-stats5/.test(homeC) && /repeat\(5, minmax\(0, 1fr\)\)/.test(home),
  "app/owner/page.tsx: the five-across grid is gone, so the tiles wrap to two rows again — the exact\n       thing he asked to be fixed (\"right now it is top bottom two rows\").");
check("the tile face shows the SHORT money form",
  /compact && !loading/.test(homeC) && /compactINR\(v\)/.test(homeC),
  "app/owner/page.tsx: the tiles print full rupees again. He asked for the short form on the face\n       (\"you can do, like, two point seven lakh\") with the whole number in the popup — it is also\n       what makes five tiles fit one line.");
// ── 13. cancellations and discounts must NOT be added to Expenses ───────────────────────────────
// Migration 315 makes revenue the NET figure and no rollup counts a cancelled order, so both are
// already out of revenue. Adding either to Expenses and then subtracting Expenses from revenue would
// count the same loss twice and read "on hand" lakhs too low. This is the one check here that guards
// a NUMBER rather than a screen.
// THE INVARIANT, restated for the P5 shape (2026-08-18). Expenses legitimately includes the INGREDIENT
// COST of food that was cooked and then binned — that is a real cost. What it must never include is the
// cancelled BILL's value, or a discount: revenue is already net of discounts and never counted a
// cancelled order (mig 315), so either would count the same loss twice and read "On hand" lakhs low.
// The two are easy to confuse because both are "cancellations", which is exactly why this is guarded.
check("no cancelled-bill value or discount is added into the money maths",
  /const staffOut = kMain\?\.staffPay\?\.paidOut \?\? 0;/.test(homeC)
    && !/cancelledValue/.test(homeC.replace(/^type MoneyTotals =.*$/m, ""))
    && !/expensesOut[^\n]*discount|discount[^\n]*expensesOut/.test(homeC),
  "app/owner/page.tsx: a cancelled bill's value or a discount is feeding the Expenses / On hand maths.\n       Revenue is already net of discounts and never included a cancelled order (mig 315), so this\n       counts the same loss twice. Only the PRICED ingredient cost (foodLoss) belongs there.");
check("the Expenses popup says why a cancelled bill's VALUE is not in it",
  /never money you had/.test(homeC),
  "app/owner/page.tsx: the Expenses popup no longer explains why discounts and cancelled bills are\n       excluded. He asked for them \"under expenses\"; the screen owes him the reason they are not.");
// ── 13b. THE DASHBOARD QUOTES NO CANCELLATION FIGURE (owner, 2026-08-18) ────────────────────────
// "the order which is been cancel but how you will calculate that bcz like it will in [the] audit so
// there would not even be [a] cancellation, only if you see." A cancellation is a RECORD you go and
// look at, and the database has always agreed: lfh_audit_risk() classifies `order_cancelled` as
// `record`, never `money`.
// It is also unquotable here. Measured on one restaurant over one 30-day window: the money rollup
// behind this screen said 1,124 cancelled worth ₹8,28,096 while the Audit said 394 worth ₹1,85,766 —
// the rollup counts every order row marked cancelled, the Audit holds only the ones recorded with a
// reason. Both are true about different sets, so ANY figure printed here contradicts the record one
// click away. The screen explains what a cancellation means for revenue and links to the record.
// The `MoneyTotals` type still DECLARES cancelledValue — it mirrors what /api/owner/reports sends,
// and that is not a rendering. Drop the type line, then ban every remaining use.
check("no cancellation figure is printed on the dashboard",
  !/cancelledValue/.test(homeC.replace(/^type MoneyTotals =.*$/m, "")),
  "app/owner/page.tsx: a cancellation amount is being printed again. It cannot be: the money rollup\n       and the Audit disagree 3x on the same window because they count different sets, so a figure\n       here contradicts the record one click away. Explain it and link to Audit & logs instead.");
check("the dashboard does not call a cancellation money lost",
  !/lost to cancel/i.test(homeC),
  "app/owner/page.tsx: \"lost to cancellations\" is back. Nothing was charged for a cancelled bill, so\n       no money was lost — lfh_audit_risk() calls it `record`, not `money`.");
check("a discount IS still shown as money given away",
  /Discounts given/.test(home),
  "app/owner/page.tsx: the discount line went with the cancellation line. A discount really is money\n       the restaurant gave away — lfh_audit_risk() calls `discount_given` MONEY — so it stays, said\n       plainly as already off the revenue.");
check("the cancellation note offers a door to the record",
  /d\.audit && ov\?\.entitlements\?\.logs !== false/.test(homeC),
  "app/owner/page.tsx: the popup note says cancellations live in Audit & logs but no longer links\n       there — and the link must stay gated on the same `logs` entitlement the sidebar uses.");
// ── 14. the detail opens on the scope and period on screen ──────────────────────────────────────
check("the dashboard sends the VIEWED scope and the chosen range",
  /q\.set\("view", activeRid \?\? "all"\)/.test(homeC) && /q\.set\("range", [^)]*globalRange\)/.test(homeC),
  "app/owner/page.tsx: the detail link stopped carrying `view` and `range`. Then it falls back to the\n       admin's own ?rid pin, and from the All-restaurants view every tile lands on ONE restaurant —\n       his bug of 2026-08-18.");
{
  const rep = read("app/owner/reports/page.tsx");
  // AND IT MUST BE READ IN AN EFFECT, NOT IN RENDER. As a useMemo it worked for a TYPED address and
  // failed for a CLICKED link — the component renders before an App Router navigation commits the new
  // URL, so it read the previous page's query and fell back to the pin, permanently.
  check("the reports page reads `view` after the URL has committed",
    /useEffect\(\(\) => \{ setViewPin\(new URLSearchParams/.test(rep),
    "app/owner/reports/page.tsx: `view` is being read during render again (useMemo). On a clicked link\n       that reads the PREVIOUS page's query, so the scope silently falls back to the admin pin —\n       measured: url said view=all, the selector said Burger Barn, at 1s and at 16s.");
  check("the reports page lets `view` beat the admin pin",
    /viewPin/.test(rep) && /viewPin === "all" \? "" : viewPin/.test(rep),
    "app/owner/reports/page.tsx: it forces its scope to ?rid again, so a link from the All-restaurants\n       dashboard lands on the one restaurant the admin console drilled into.");
  check("the reports page honours the range it is handed",
    /qs\.get\("range"\)/.test(rep) && /wanted === "week" \? "7d"/.test(rep),
    "app/owner/reports/page.tsx: it ignores ?range, so opening a tile on \"This month\" hands him 30\n       days instead. The two screens have different period lists, so `week` needs its mapping.");
  check("the reports hub finds the element that really scrolls",
    /for \(const sel of \[".adm-main", ".adm"\]\)/.test(rep),
    "app/owner/reports/page.tsx: `scroller()` is back to .adm-main alone, so keeping your place does\n       nothing at <=900px where .adm is the scroller.");
}
// ── 15. a way back you can SEE ──────────────────────────────────────────────────────────────────
check("the dish view has a visible close control",
  /own-dish-x/.test(homeC) && /width: 44px; height: 44px/.test(home),
  "app/owner/page.tsx: the dish view's ✕ is gone or under 44px. The phone's BACK and the drawer both\n       work, but neither is visible, and the breadcrumb is display:none at 360px.");
// ── 16. one wording for how long ago ────────────────────────────────────────────────────────────
check("the dashboard uses the shared timeAgo, not its own copy",
  /timeAgo/.test(homeC) && !/function timeAgo\(iso: string\)/.test(homeC),
  "app/owner/page.tsx: a local timeAgo is back, so the dashboard says \"5 min ago\" while Audit & logs\n       and eleven admin screens say \"5m ago\".");
// ── 17. the two handoffs in other owner files ───────────────────────────────────────────────────
check("manager mode re-emits its breadcrumb after the shell is listening",
  /requestAnimationFrame\(\(\) => emit\(tail\)\)/.test(read("components/owner/OwnerManagerMode.tsx")),
  "components/owner/OwnerManagerMode.tsx: the single-emit is back. Child effects run before parent\n       effects, so on a hard load the tail is shouted before OwnerShell is listening and the pill\n       stays blank with a restaurant's floor on screen.");
{
  const ch = read("components/owner/Charts.tsx");
  check("a long category label is trimmed with an ellipsis, not clipped",
    /CAT_AXIS_W/.test(ch) && /label\.slice\(0, budget - 1\)/.test(ch),
    "components/owner/Charts.tsx: CatTick draws the full label again. textAnchor=\"end\" means it runs\n       off the LEFT edge and loses the identifying first words, and its only rescue is a hover title\n       that a phone does not have.");
}

// ── 18. Audit & logs narrows in place (owner, 2026-08-18, approving the sweep's 🟡 3) ───────────
// Picking a restaurant in the cockpit switcher used to throw a multi-restaurant owner OUT of this
// page onto the dashboard — the one page of the three that did.
check("Audit & logs re-scopes in place instead of navigating away",
  /path === "\/owner\/reports" \|\| path === "\/owner\/activity"/.test(shellC),
  "components/owner/OwnerShell.tsx: /owner/activity left the in-place branch, so picking a restaurant\n       there throws the owner back to the dashboard again.");
check("the switcher sends the restaurant NAME as well as its id",
  /name: rid \? \(myRests\.find/.test(shellC),
  "components/owner/OwnerShell.tsx: the scope event no longer carries the name, so Audit & logs cannot\n       put the restaurant in the crumb without a lookup of its own.");
check("the top pill mirrors the scope on Audit & logs",
  /path === "\/owner\/activity"\n?\s*\?? \(crumbTail\[0\]|owner\/activity"$/m.test(shellC) || /\|\| path === "\/owner\/activity"\s*\n\s*\? \(crumbTail\[0\]/.test(shellC),
  "components/owner/OwnerShell.tsx: the pill stopped following the scope on Audit & logs, so it can\n       say one restaurant while the list under it shows another.");
check("the audit page filters by the picked restaurant",
  /if \(pickRid\) params\.set\("rid", pickRid\)/.test(auditC) && /lfh:owner-scope/.test(auditC),
  "app/owner/activity/page.tsx: the page no longer listens for the scope pick, or no longer sends it\n       as `rid`, so the switcher does nothing there.");
check("the filter starts at ALL restaurants for everyone",
  /const \[pickRid, setPickRid\] = useState<string>\(""\)/.test(auditC),
  "app/owner/activity/page.tsx: the filter is seeded from the admin pin again. lib/ownerScope resolves\n       that pin to the whole OWNER's estate, so seeding it narrowed this page while the dashboard next\n       door showed everything — and the pill then disagreed with the list under it.");
check("picking a restaurant resets the paging",
  /setAudPage\(1\); setPage\(1\)/.test(auditC),
  "app/owner/activity/page.tsx: narrowing the scope no longer resets the paging, so page 5 of the whole\n       estate answers with nothing for one restaurant and reads as \"no records\".");
check("an empty record says WHICH restaurant it is empty for",
  /Nothing has been removed at \$\{scopeName\}/.test(audit) && /No staff activity at \$\{scopeName\}/.test(audit),
  "app/owner/activity/page.tsx: the empty states are back to \"Nothing has been removed yet\", which reads\n       as \"nowhere, ever\" when the switcher has narrowed the page to one restaurant.");

// ── 19. food cooked and then binned reaches the Expenses tile (P5, owner 2026-08-18) ────────────
// "the cancelinging amout go up expensis goes up." The tile must add the ingredient cost of food that
// was made and then cancelled — and must NOT add the cancelled bill's value, which was never money he
// had (mig 315: revenue is net and never counted a cancelled order).
check("Expenses = staff pay + food made then binned",
  /const expensesOut = staffOut \+ foodLost;/.test(homeC) && /const onHand = \(kMain\?\.revenue \?\? 0\) - expensesOut;/.test(homeC),
  "app/owner/page.tsx: the Expenses tile stopped adding the food loss, or On hand stopped subtracting\n       the same total — the three tiles then no longer reconcile on screen.");
check("the food loss comes from the analytics payload, not the bill value",
  /foodLost = kMain\?\.foodLoss\?\.amount \?\? 0/.test(homeC) && !/foodLost[^\n]*cancelledValue/.test(homeC),
  "app/owner/page.tsx: the food loss is being taken from somewhere other than the priced `foodLoss`\n       figure. The cancelled BILL value is not a cost and must never feed this tile.");
{
  const an = read("app/api/owner/analytics/route.ts");
  check("the loss is priced from real expense rows, scoped and capped",
    /category", "food_loss"/.test(an) && /is\("voided_at", null\)/.test(an) && /\.in\("restaurant_id", ids\)/.test(an),
    "app/api/owner/analytics/route.ts: the food-loss read lost its scope, its voided filter or its\n       category — a struck-out loss must not still count, and it must never read past this owner.");
  check("the loss window follows the BUSINESS day, both ends",
    /gte\("expense_date", istDateOf\(from\)\)/.test(an) && /lte\("expense_date", businessDateHi\(to\)\)/.test(an),
    "app/api/owner/analytics/route.ts: the food-loss window stopped using businessDateHi. A restaurant's\n       day ends at 05:00 IST, so a calendar bound drops today's losses — measured: the tile showed 2 of\n       3 and a total that happened to look plausible.");
  check("a failed loss read is reported ABSENT, never as zero",
    /food-loss read failed[\s\S]{0,80}return null/.test(an),
    "app/api/owner/analytics/route.ts: a failed food-loss read now returns 0, which tells him he wasted\n       nothing. It must be absent so the popup can say it could not be read.");
}
{
  const mig = read("supabase/migrations/340_was_the_food_actually_made.sql");
  check("the loss expense is dated by the business day",
    /- interval '5 hours'\) AT TIME ZONE 'Asia\/Kolkata'\)::date/.test(mig),
    "supabase/migrations/337: the food-loss expense is dated by the calendar day again. Migration 294\n       set the rule — step back the 5-hour offset first — or food cooked after midnight is stamped\n       tomorrow and falls outside the window the dashboard filters by.");
  check("answering is append-only: a correction adds a row, never edits one",
    /INSERT INTO deletion_audit[\s\S]{0,400}'removal_classified'/.test(mig),
    "supabase/migrations/337: a classification no longer writes its own row. The history of who answered\n       what, and what they changed it from, is the record — it may never be overwritten.");
}

// ── 20. the OWNER may answer it too (owner, 2026-08-19: "can be change by owner or manager") ────
// A narrow, deliberate exception to this page being read-only. The 2026-08-04 rule is that an owner
// can never RESTORE or UNDO a removal — that still stands and is checked below. Answering whether the
// kitchen had cooked the food undoes nothing and edits no row; it records a fact only a person present
// can know, append-only.
{
  const oa = read("app/api/owner/audit/route.ts");
  check("the owner can answer \"was the food made?\"",
    /export async function POST/.test(oa) && /lfh_cancel_classify/.test(oa),
    "app/api/owner/audit/route.ts: the owner can no longer answer it. He asked for owner AND manager on\n       2026-08-19; the manager route alone is half the instruction.");
  check("…and still cannot restore anything from here",
    /canRestore: false/.test(oa) && !/lfh_restore|p_restore|restore_removal/.test(oa),
    "app/api/owner/audit/route.ts: a restore path has appeared. Answering is the ONLY write an owner\n       gets on this record — putting a bill back is Aevidine's alone (owner rule, 2026-08-04).");
  check("the owner's answer is scoped, gated and checked against the order",
    /inScope\(scope, rid\)/.test(oa) && /logViewSubset\(await entitledSubset\(\[rid\], "logs"\), "removals"\)/.test(oa)
      && /status !== "cancelled"/.test(oa),
    "app/api/owner/audit/route.ts: the POST stopped checking that the order is one of theirs, that the\n       section is switched on, or that the order is actually cancelled. Hiding a page is never the\n       only guard.");
  check("the restaurant comes from the ORDER, not from the caller",
    /from\("orders"\)\s*\.select\("restaurant_id, status"\)/.test(oa.replace(/\n\s*/g, " ")),
    "app/api/owner/audit/route.ts: the POST is trusting a restaurant id from the body. Read it from the\n       order and then check scope — narrow, never widen.");
  const ap = read("app/owner/activity/page.tsx");
  check("each row's answer buttons hold their own tap",
    /function MadeAnswer/.test(ap) && /if \(busy !== null\) return;/.test(ap),
    "app/owner/activity/page.tsx: the answer buttons no longer guard against a second tap, or the state\n       moved back up to the list — one shared flag greys out every row on the page.");
  check("a refused answer is shown, never swallowed",
    /answerErr/.test(ap) && /Couldn&rsquo;t record that answer/.test(ap),
    "app/owner/activity/page.tsx: a refused answer is silent again. A switched-off section or an order\n       that is no longer cancelled are both real answers the screen owes him.");
}

// ══ T12 sweep, 2026-08-27 ══════════════════════════════════════════════════════════════════════

// 11 — an empty ANSWER is not an empty RECORD (Audit & logs → Activity log)
check("a search that matches nothing is not called 'no staff activity yet'",
  /rows\.length === 0 \?[\s\S]{0,900}?q\.trim\(\)[\s\S]{0,200}?Nothing matches that/.test(auditC),
  "app/owner/activity/page.tsx: the zero-rows branch of ActivityView stopped checking `q`. The search\n       is server-side, so an unmatched search lands HERE — and telling the owner his team has done\n       nothing, over a log of thousands of entries, is simply false.");
check("…and a severity chip that matches nothing says so too, with a way back",
  /rows\.length === 0 \?[\s\S]{0,900}?:\s*level\s*\?[\s\S]{0,260}?setLevel\(""\)/.test(auditC),
  "app/owner/activity/page.tsx: filtering to Notable/Info with no such rows reads as an empty log\n       again, and offers no way back to All.");
check("the search's empty state offers a way to clear it",
  /setQ\(""\)[\s\S]{0,60}Clear the search/.test(auditC),
  "app/owner/activity/page.tsx: the 'nothing matches' state is a dead end again — the removals half\n       beside it has always offered the way out.");

// 12 — the switched-off state reaches EVERY tile, today included
check("\"Today so far\" goes quiet when Reports are switched off",
  // Re-pinned 2026-09-05 (T13 round 2). The condition is now named `dashed`, which is
  // `offNote || ovFailed` — the tile also stops pretending when the OVERVIEW read has failed, a
  // state in which it used to sit blank for ever. `dashed` still contains offNote (asserted just
  // below), so the rule this row is about is unchanged and strictly wider.
  /k="Today so far"[\s\S]{0,400}?dashed \? undefined : \(\) => setTileOpen\("today"\)[\s\S]{0,400}?dashed \? "—" : todayRev/.test(homeC)
    && /const dashed = !!offNote \|\| ovFailed;/.test(homeC),
  "app/owner/page.tsx: the Today tile prints the overview's figure again. That route ZEROES the day for\n       a restaurant whose Reports the admin took away, so the tile prints ₹0 as fact beside four tiles\n       that honestly say '—'. It reads as 'you took nothing today'.");
check("…and its \"live\" pill goes with it",
  /k="Today so far"[\s\S]{0,600}?pill=\{dashed \? undefined : "● live"\}/.test(homeC)
    && /const dashed = !!offNote \|\| ovFailed;/.test(homeC),
  "app/owner/page.tsx: a '● live' pill is back over an em dash. There is nothing live to point at when\n       the figures are not shown.");

// 13 — never a database id where a person's name goes
check("the owner's log has a guard against printing a raw database id as a person",
  /export function actorLabel/.test(read("lib/ownerActor.ts")) && /export function actorIsRawId/.test(read("lib/ownerActor.ts")),
  "lib/ownerActor.ts has gone. Two owner-panel writers log the owner's uuid as the actor, so both of\n       these screens would print it in the person column again.");
check("the dashboard's mini feed renders the actor through that guard",
  /actorLabel\(a\.actor\)/.test(homeC) && !/\{a\.actor \|\| "—"\}/.test(homeC),
  "app/owner/page.tsx: the Recent-activity card is printing `a.actor` raw again.");
check("both halves of Audit & logs render the actor through it too",
  /actorLabel\(r\.actor\)/.test(auditC) && /!actorIsRawId\(a\.actor\)/.test(auditC),
  "app/owner/activity/page.tsx: a removals row or an activity row is printing its actor raw again.");
check("…and the reference stays traceable in the tooltip",
  /actorTitle\(/.test(homeC) && /actorTitle\(/.test(auditC),
  "the id is now simply thrown away. Keep it in the cell's title so support can still trace a row.");

// 14 — a card that vanishes says so (the client half of the route's improvement I5)
check("the dashboard reads the server's partial:[\"records\"] answer",
  /a\.partial\.includes\("records"\)/.test(homeC) && /setRecsUnread/.test(homeC),
  "app/owner/page.tsx: nothing reads the `records` partial key again, so a failed all-time-records read\n       leaves the card silently absent — the exact fault /api/owner/analytics added that key to end.");
check("…and the Your-records card appears to say it",
  /recordsUnread \|\| \(records && \(records\.bestDay \|\| records\.starDish\)\)/.test(homeC),
  "app/owner/page.tsx: the Your-records card is gated on data alone again, so when the read fails there\n       is one fewer block on the page and nothing explains it.");
check("…in wording written for ONE restaurant, not several",
  /msg="We couldn&rsquo;t read your all-time records/.test(homeC) && /msg\?: string/.test(homeC),
  "app/owner/page.tsx: the records strip is back on the group wording ('Some restaurants didn't\n       answer'), which is not true of a single restaurant's own records.");

// 15 — an unread cost never prints as a settled zero
check("the On hand popup admits an unread food figure",
  /const foodUnread = !!kMain && kMain\.foodLoss == null/.test(homeC)
    && /foodUnread \? "we couldn[^"]*read this[^"]*missing from the sum below"/.test(homeC),
  "app/owner/page.tsx: the On hand popup prints a flat '− ₹0' for a food-loss read that FAILED, and then\n       headlines 'Money on hand' as if it were settled. null means unread, never zero — the route says so.");
check("…and its total says it may be too high",
  /\["Money on hand", inr\(onHand\), foodUnread \?/.test(homeC),
  "app/owner/page.tsx: the 'Money on hand' line stopped carrying the caveat, so an answer built on a\n       missing cost reads as final.");
check("the Expenses tile face admits it too",
  /kMain && kMain\.foodLoss == null \? "staff pay only/.test(homeC),
  "app/owner/page.tsx: the Expenses tile falls through to the staff-pay wording again when the food\n       figure could not be read, so a total that is too low looks complete.");

// 16 — a failed read is not 'still loading'
check("the Recent-activity card tells a failed read apart from loading",
  /const \[actsErr, setActsErr\] = useState\(false\)/.test(homeC) && /catch \{ setActs\(null\); setActsErr\(true\); \}/.test(homeC),
  "app/owner/page.tsx: a failed /api/owner/oplog read folds back into the null the card renders as\n       'Loading…' — the identical fault the 403 branch was fixed for, one branch over.");
check("…and says so on screen, with one tap to try now",
  /actsErr[\s\S]{0,200}Couldn&rsquo;t load this just now[\s\S]{0,320}Try again/.test(homeC),
  "app/owner/page.tsx: the failed state is invisible again — the card spins with no end and no retry.");

// 17 — the icon does not touch the word (a flex row eats the leading space)
check("the Refresh buttons on Audit & logs keep their icon gap",
  (auditC.match(/fas fa-rotate" style=\{\{ marginRight: 6 \}\}/g) || []).length === 2,
  "app/owner/activity/page.tsx: a Refresh button lost its icon margin. .owx .adm-btn is a flex row, and a\n       flex container collapses the leading space of a text run — so the glyph sits hard against the word.");

// 18 — the all-time records scan is asked for ONCE per restaurant, not once per payload in flight
check("the unbounded all-time-records read is asked for once, at ask-time",
  /recsAsked\.current\.has\(rid\)/.test(homeC) && /if \(recQ\) recsAsked\.current\.add\(rid!\)/.test(homeC),
  "app/owner/page.tsx: the records=1 guard is back on `recsRef` alone, which is only filled once a\n       request has ANSWERED — so the main-range and month payloads, dispatched in the same pass, both\n       carry it and the one read the server keeps outside its cache runs twice on every open.");
check("…and a failed records read can still be retried",
  /recsAsked\.current\.delete\(rid\)/.test(homeC),
  "app/owner/page.tsx: the ask-flag is never cleared, so a records read that failed can never be tried\n       again for the rest of the visit.");

// 19 — the one tile that does not follow the dropdown links to its OWN period
check("the Today popup's report link opens TODAY, not the dropdown's period",
  /q\.set\("range", t === "daysummary" \? "today" : globalRange\)/.test(homeC),
  "app/owner/page.tsx: the Today popup says 'it is always today' and its 'See the full detail' link\n       carries the dropdown's range again — one screen, two answers, one tap apart.");

// 20 — a removal kind nobody mapped still reads as English, never as a column value
check("an unmapped removal kind is humanised, not printed raw",
  /function humanKind/.test(auditC) && /REMOVAL_KIND\[r\.kind\] \|\| \["•", KINDS\[r\.kind\] \|\| humanKind\(r\.kind\)\]/.test(auditC),
  "app/owner/activity/page.tsx: the removals row falls back to the raw `r.kind` again. It is not\n       hypothetical — app/api/owner/customers writes kind: \"customer_erased\", auditsort.js has no label\n       for it, and the top row of the record read '• customer_erased · Guest ending 1601'.");
// 21 — the skin broadcast has exactly ONE writer, and it is not inside a state updater
check("the skin's three writes sit outside setSkin's updater",
  /const toggleSkin = \(\) => \{\s*const next = skin === "dark"/.test(shellC) && !/setSkin\(\(cur\) => \{/.test(shellC),
  "components/owner/OwnerShell.tsx: the localStorage write, the cookie write and the lfh:owner-skin\n       broadcast are back inside setSkin's updater. React requires an updater to be pure and calls it\n       twice in development to catch this — measured: one tap fired the broadcast twice. This is the\n       one event that drives the EMBEDDED panel's skin, and its rule is one writer.");

check("the guest-erasure REASON has words, and any future code has a floor",
  /data_erasure_request: "Data erasure request"/.test(auditC)
    && /REMOVAL_REASON\[r\.reason_code\] \|\| humanKind\(r\.reason_code\)/.test(auditC),
  "app/owner/activity/page.tsx: the reason column prints a raw code again. app/api/owner/customers\n       writes reason_code: \"data_erasure_request\" and the six manager reasons do not include it, so the\n       row read 'data_erasure_request — Guest asked for their personal data to be erased'.");
check("…and the CHIP strip, the search and the money line read from that same map",
  /function labelsWith/.test(auditC) && /kindCountsFrom\(removals \|\| \[\], counts, KINDS, KIND_ICON\)/.test(auditC)
    && /kindLabel: KINDS/.test(auditC) && /KINDS\[activeKind\]/.test(auditC),
  "app/owner/activity/page.tsx: a chip, the search or the '· <kind>' line is back on the bare\n       KIND_LABEL. AUDITSORT.kindCountsFrom falls back to the raw kind itself, which is how the strip\n       came to print '• customer_erased 2' beside ten properly-named chips.");

// 22 — the guest-erasure row has REAL words in the one map all four surfaces read (owner, 2026-08-29)
{
  const as = read("public/panels/auditsort.js");
  check("customer_erased is named in the shared map, not just floored locally",
    /customer_erased: "Guest record erased"/.test(as) && /customer_erased: "\\uD83E\\uDDF9"/.test(as),
    "public/panels/auditsort.js lost its customer_erased label or glyph. Then the owner panel falls back\n       to humanKind, and the manager panel, the admin console and the removal-detail card go back to\n       printing the column value.");
}

// 23 — every owner-panel write records a PERSON, never a database id (owner, 2026-08-29)
{
  const sc = read("lib/ownerScope.ts");
  check("there is ONE definition of who an owner write is recorded as",
    /export function ownerActorName\(scope: OwnerScope\): string/.test(sc) && /ownerName\?: string/.test(sc),
    "lib/ownerScope.ts: ownerActorName has gone. Five routes used to build this by hand and all five\n       wrote scope.ownerId — a uuid — into columns the panels PRINT.");
  check("…and the owner's login name is carried on the scope to feed it",
    /ownerName: owner\.username \|\| undefined/.test(sc),
    "lib/ownerScope.ts: the scope stopped carrying the owner's login name, so ownerActorName falls back\n       to the uuid again.");
  let raw = 0;
  for (const f of ["app/api/owner/ratings/route.ts", "app/api/owner/customers/route.ts", "app/api/owner/issues/route.ts"]) {
    const t = read(f);
    if (/scope\.ownerId \|\| "owner"/.test(t)) raw++;
    check(`${f.split("/").slice(-2)[0]} records the person through ownerActorName`,
      /ownerActorName\(scope\)/.test(t) && !/scope\.ownerId \|\| "owner"/.test(t),
      `${f}: it is back to building the actor by hand from scope.ownerId, which is a uuid. That value\n       lands in staff_actions.actor, deletion_audit.actor, feedback.acknowledged_by or issues.raised_by —\n       all four are columns a screen prints.`);
  }
  check("no owner route builds that expression by hand any more",
    raw === 0,
    `${raw} route(s) still build the actor from scope.ownerId. One definition, or they drift again.`);
  const iss = read("app/owner/issues/page.tsx");
  check("the Feedback screen guards the ids already written before that fix",
    /actorLabel\(r\.acknowledged_by\)/.test(iss) && /actorLabel\(i\.raised_by\)/.test(iss),
    "app/owner/issues/page.tsx: 'handled by' and 'Raised by' print their column raw again. Rows written\n       before 2026-08-29 still hold a uuid there.");
}

// 24 — the type-chip strip folds on a PHONE only, and never folds a way out (owner, 2026-08-29)
check("the removals chip strip folds on a narrow screen",
  /const CHIP_FOLD = 5/.test(auditC) && /const folding = narrow && !allChips && chips\.length > CHIP_FOLD \+ 1/.test(auditC),
  "app/owner/activity/page.tsx: the chip strip no longer folds. Eleven chips over eight lines pushed the\n       search box below the fold on the screen you search from — measured at ~530px on a 360px phone.");
check("…and it is a PHONE rule, keyed to the console's own 760px step",
  /matchMedia\("\(max-width: 760px\)"\)/.test(auditC),
  "app/owner/activity/page.tsx: the fold is no longer width-aware, so it hides chips on a desktop where\n       all of them fit two lines.");
check("…and it never folds 'All', nor the chip you are standing on",
  /i < CHIP_FOLD \|\| c\.kind === kind/.test(auditC) && /activeKind === "" \? "on"/.test(auditC),
  "app/owner/activity/page.tsx: the fold can now hide the selected chip or the way back to All — narrowing\n       to a rare type would make the chip you are standing on vanish.");
check("…and there is one tap to see the rest",
  /setAllChips\(true\)/.test(auditC) && /\+ \{hiddenChipCount\} more/.test(auditC),
  "app/owner/activity/page.tsx: the folded chips have no way to be shown — that is hiding, not folding.");

// 25 — the pager scrolls the element that actually scrolls (owner, 2026-08-29)
check("paging moves the real scroller, not the window",
  /for \(const sel of \[".adm-main", ".adm"\]\)/.test(auditC) && !/window\.scrollTo/.test(auditC),
  "app/owner/activity/page.tsx: the Pager is back on window.scrollTo. The window NEVER scrolls on the\n       owner console — above 900px .adm-main is the scroller, below it .adm is — so that line moves\n       nothing, and 'page 2 opens at the top' is left resting on the list collapsing while it loads.");

// 26 — the multi-restaurant test owner exists and is reachable (owner, 2026-08-29)
{
  const lg = read("scripts/sweep/login.mjs");
  check("a sweep can sign in as an owner who owns TWO restaurants",
    /ownerMulti: \{ username: "diagmulti"/.test(lg),
    "scripts/sweep/login.mjs lost the ownerMulti entry. Without it, a third of this dashboard — the\n       estate table, the drawer, the callouts, the stacked bars, the picker and the switcher's\n       re-scope — can only be checked by reading, which is how two faults sat for months.");
  check("…and the script that creates it is still in the repo",
    /diagmulti/.test(read("scripts/sweep/make-multi-owner.mjs")),
    "scripts/sweep/make-multi-owner.mjs has gone. It is idempotent and prints its own undo — keep it,\n       or the fixture cannot be rebuilt on a fresh database.");
  check("…and it is NEVER pointed at Aangan",
    /refusing: Aangan is in the list/.test(read("scripts/sweep/make-multi-owner.mjs")),
    "scripts/sweep/make-multi-owner.mjs dropped its Aangan guard. Aangan is the read-only control at\n       factory defaults — giving it a second owner would destroy what it is for.");
}

// 27 — the estate DRAWER hides a restaurant's takings when its Reports are off (round 2, 2026-08-29)
check("the drawer knows about reportsOff, like the table row it opens from",
  /drawer\.r\.reportsOff \? \(/.test(homeC) && /Figures aren&rsquo;t shown for this restaurant/.test(homeC),
  "app/owner/page.tsx: the estate drawer prints money again for a restaurant whose Reports the admin\n       switched off. /api/owner/overview zeroes that restaurant on purpose and analytics leaves it out,\n       so the drawer showed 'Today ₹0 · Revenue ₹0 · Avg ₹0 · 0 orders all-time' over a trading\n       restaurant — one inch from a table cell reading 'figures hidden'. That is the exact fault the\n       reportsOff flag was added for on 2026-08-04.");
check("…and draws no trend chart of a series it was never given",
  /!drawer\.r\.reportsOff && drawerTrend\.length >= 2/.test(homeC),
  "app/owner/page.tsx: the drawer draws a trend for a reports-off restaurant — a flat line of zeros\n       presented as its business.");
check("…while open tables and Active/Off stay, because they are not money",
  /<div><small>Open tables<\/small>/.test(homeC) && /own-pill \$\{drawer\.r\.active/.test(homeC),
  "app/owner/page.tsx: the drawer now hides the two things that are still true and still useful when\n       the takings are hidden — they come from the overview for every restaurant.");

// 28 — the estate table STACKS on a phone instead of hiding its figures off the right edge
//      (T12 sweep round 2, 2026-08-29)
check("the estate table stops being a table on a narrow screen",
  /\.hq-table :global\(thead\) \{ display: none/.test(homeC)
    && /\.hq-table, \.hq-table :global\(tbody\), \.hq-table :global\(tr\), \.hq-table :global\(td\) \{ display: block/.test(homeC),
  "app/owner/page.tsx: the multi-restaurant table is a table again on a phone. Measured on a 360px\n       screen with a real two-restaurant owner, the six remaining columns came to a 561px table inside a\n       330px scroller — Revenue, Orders and Open all sat off the right edge behind a sideways swipe\n       with no scrollbar and no hint. What he saw was a list of names and not one figure.");
check("…and every figure carries the header it lost",
  /data-l=\{`Revenue · \$\{RANGE_LABEL\[globalRange\]\}`\}/.test(homeC)
    && /td\[data-l\]\)::before \{ content: attr\(data-l\)/.test(homeC),
  "app/owner/page.tsx: a stacked cell prints a number with no label. On a stacked row there is no\n       column header above it, so an unlabelled figure is just a number nobody can read.");
check("…including the reports-off row, which must still say figures hidden",
  /data-l="Figures" title="Reports are switched off/.test(homeC),
  "app/owner/page.tsx: the hidden-figures cell lost its stacked label.");
check("…and the phone rule does not reach the desktop",
  /@media \(max-width: 760px\) \{[\s\S]*?\.hq-table :global\(thead\) \{ display: none/.test(homeC),
  "app/owner/page.tsx: the stacking rules escaped their media query — above 760px this must stay a real\n       table with its sticky header and all ten columns.");

// …and a NOTE, never a failure, listing the removal kinds the app can WRITE that nobody has named.
// It is a note because the words live in public/panels/auditsort.js, which the owner console only
// READS — a guard that goes red over a file its own territory cannot edit is a guard that gets
// ignored. The source of truth for "what can be written" is the RemovalKind union in
// lib/removalAudit.ts; the source of truth for "what has words" is auditsort's KIND_LABEL block.
{
  const kinds = new Set([...read("lib/removalAudit.ts").matchAll(/^\s*\|\s*"([a-z_]{4,40})"/gm)].map((m) => m[1]));
  const lab = read("public/panels/auditsort.js");
  const block = lab.slice(lab.indexOf("var KIND_LABEL"), lab.indexOf("var KIND_ICON") + 1 || undefined);
  const labelled = new Set([...block.matchAll(/^\s*([a-z_]{4,40})\s*:/gm)].map((m) => m[1]));
  const unnamed = [...kinds].filter((k) => !labelled.has(k));
  if (unnamed.length) {
    console.log(`  note  ${unnamed.length} removal kind(s) this app can write have no words in public/panels/auditsort.js:`);
    console.log(`        ${unnamed.join(", ")}`);
    console.log(`        They reach the screen through humanKind() in app/owner/activity/page.tsx, which is a`);
    console.log(`        floor, not a label. The real fix is one KIND_LABEL + KIND_ICON line each, so the owner,`);
    console.log(`        manager and admin panels and the removal-detail card all say the same words.`);
  }
}

// ══ THE FIVE FIXES FROM SWEEP #8 / T13 (2026-09-04) ═══════════════════════════════════════════
// Each of these was a real fault on the owner's dashboard, each has one commit, and each is
// watched here so it cannot come back quietly. The driven versions live in
// scripts/sweep/t13/ (P66701–P67296); these are the cheap static half that needs no server.

// item 1 — a one-restaurant owner lost his restaurant's header on the way back from a dish
check("the way out of an empty dish goes HOME for a one-restaurant owner",
  /viewTo\(single \? \{ level: "home" \} : \{ level: "restaurant", rid: view\.rid \}\)/.test(homeC),
  "app/owner/page.tsx: the 'No sales for this dish' button sends a ONE-restaurant owner to a\n" +
  "       'restaurant' level that he does not have. The hero renders on (home && single), so he lands\n" +
  "       on a dashboard with no restaurant name, no ACTIVE pill, no open-table count and none of the\n" +
  "       three shortcuts — and the drill is remembered per tab, so a refresh comes back the same way.");
check("…and it is LABELLED for the place it actually goes",
  /\{single \? "Back to the dashboard" : "Back to the restaurant"\}/.test(homeC),
  "app/owner/page.tsx: the empty-dish button's words and its destination can disagree again.");
check("…and the dish header's ✕ still agrees with it",
  (homeC.match(/single \? "Back to the dashboard" : "Back to the restaurant"/g) || []).length >= 3,
  "app/owner/page.tsx: the ✕ and the empty-state button word the same journey differently.");

// item 2 — the estate crowned a top performer that had taken ₹0
check("the top-performer banner is not awarded for ₹0",
  /const bestEarned = !!best && best\.revenue > 0 && total > 0;/.test(homeC),
  "app/owner/page.tsx: on a 4+ restaurant estate before the first bill of the day, the banner read\n" +
  "       '🏆 TOP PERFORMER · TODAY — <name> — ₹0 · 0% of revenue'. It crowns a winner of nothing, and\n" +
  "       because every revenue is equal at that point the two orderings tie-break differently — the\n" +
  "       trophy named one restaurant while the table below ranked another #1. The page's own insight\n" +
  "       strip already guards on the group total; this is the same guard.");
check("…and `best` still reads the payload the database orders by revenue",
  /const best = p\.restaurantRevenue\[0\];/.test(homeC),
  "app/owner/page.tsx: the banner no longer reads restaurantRevenue[0]. That list is ORDER BY revenue\n" +
  "       DESC in the database (mig 321); if the banner stops reading [0], this contract has moved and\n" +
  "       the guard above is watching the wrong thing.");

// item 3 — the Orders tile stated an average before anything was paid
check("the Orders caption does not state an average when nothing has been paid",
  /kMain\.paidOrders \? `\$\{inr\(kMain\.avg\)\} per paid order` : "none paid yet"/.test(homeC),
  "app/owner/page.tsx: with real orders on the floor and nothing settled, the Orders tile read\n" +
  "       '₹0 per paid order' as a fact. The owner settled this wording on the tile beside it on\n" +
  "       2026-08-31 — '₹0' next to '79 orders today' read as a bug to him — and that tile says\n" +
  "       'none paid yet'. Same words, same doubt, no new query.");

// item 4 — on a phone the whole panel could be dragged, taking the top bar off screen
check("the stacked estate row is a positioned box, so nothing inside it escapes to the document",
  /\.hq-table :global\(tr\.hq-row\) \{ position: relative;/.test(home),
  "app/owner/page.tsx: the estate table's rank cell is hidden off-screen with position:absolute so a\n" +
  "       screen reader still announces it. Without `position: relative` on its ROW, that cell resolves\n" +
  "       against the DOCUMENT and its resting place is partway down the list — measured at 360px, the\n" +
  "       page became 1168px tall against a 780px screen, so the whole panel could be dragged up 388px,\n" +
  "       taking the top bar (menu, scope, Connected, skin, sign-out) off screen and leaving the bottom\n" +
  "       half blank. Keep this inside the 760px media query.");
check("…and the rank cell is still hidden by CLIPPING, not by display:none",
  /\.hq-table :global\(td\.rk\) \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\); \}/.test(home),
  "app/owner/page.tsx: display:none would take the rank out of the accessibility tree entirely. The\n" +
  "       clipping pattern keeps it announced while off screen — that is the point of it.");

// item 5 — a custom date range ending today recomputed on every open
check("a custom period's cache key is stable, so its saved figures can be found again",
  /\? `custom:\$\{from\.slice\(0, 10\)\}:\$\{to\.slice\(0, 10\)\}`/.test(code(read("app/api/owner/analytics/route.ts"))),
  "app/api/owner/analytics/route.ts: for a custom range the key carried the RESOLVED end of the\n" +
  "       window, and for any range including today that end is 'now' down to the millisecond — so no\n" +
  "       two requests could share a key and every open recomputed the whole payload, leaving another\n" +
  "       cache row behind under a key nothing can hit again. Keyed to the DAY, like the eight fixed\n" +
  "       periods already are; the fingerprint is what notices new orders inside that day.");
check("…and it is still built from the RESOLVED window, never the raw query string",
  !/custom:\$\{sp\.get\("from"\)/.test(code(read("app/api/owner/analytics/route.ts"))),
  "app/api/owner/analytics/route.ts: the custom cache key reads the raw query values again, so every\n" +
  "       distinct junk value mints its own cache row holding the identical 30-day payload.");

// ══ THE THREE HE PICKED OFF THE REPORT (items 9, 10, 11 — 2026-09-05) ═════════════════════════

// item 9 — the Every dish card names the period its figures cover
check("the Every dish card carries a period chip, like every other card on the page",
  /<span>Every dish <span className="mut">· tap one for detail<\/span><\/span>[\s\S]{0,700}?<span className="ow2-tag"/.test(homeC),
  "app/owner/page.tsx: this was the only card showing period-scoped figures with no period on its\n" +
  "       face, while the 'Your records' strip below it deliberately spells out its own rolling window\n" +
  "       — because two dish figures with different windows once read as a contradiction (549 plates\n" +
  "       against 529, both captioned '30 days'). The list changes completely with the dropdown.");
check("…and that chip follows the MAIN range rather than a window of its own",
  /<span>Every dish[\s\S]{0,700}?<span className="ow2-tag" title=\{\[rangeSpanText\(globalRange\), mainAge\(\)\]/.test(homeC),
  "app/owner/page.tsx: the dish card's chip no longer reads globalRange, so it can name one period\n" +
  "       while the list under it shows another — the exact fault the chip was added to prevent.");

// item 11 — Who earns more stands down when the whole estate has taken nothing
check("'Who earns more' says so when NO restaurant has taken anything",
  /if \(populated\(data\.map\(\(d\) => Number\(d\.revenue\) \|\| 0\)\) === 0\) \{[\s\S]{0,240}?<NotEnough/.test(read("components/owner/Charts.tsx")),
  "components/owner/Charts.tsx: on a zero-revenue period this drew one flat ₹0 column per restaurant\n" +
  "       while 'Revenue over time' in the very next card said 'Not enough data yet'. Same screen, same\n" +
  "       empty morning, two different answers about whether there is anything to show.");
check("…and the gate is ZERO, not the MIN_POINTS rule the time charts use",
  !/populated\(data\.map\(\(d\) => Number\(d\.revenue\) \|\| 0\)\) < MIN_POINTS/.test(read("components/owner/Charts.tsx")),
  "components/owner/Charts.tsx: this is a COMPARISON between restaurants, not a trend. One restaurant\n" +
  "       on ₹8,000 with four on ₹0 is a real and useful picture — it says exactly who traded. Applying\n" +
  "       the two-point trend rule here would hide the answer.");

// item 10 — our own test tooling must not trip the app's sign-in limit
check("the sweep's login helper TESTS an expired session before spending a sign-in",
  /const probe = await context\.request\.get\(`\$\{base\}\$\{shared\.route \|\| l\.route\}`, \{ maxRedirects: 0/.test(read("scripts/sweep/login.mjs")),
  "scripts/sweep/login.mjs: the 15-minute TTL is a guess at how long a session lasts; the real cookie\n" +
  "       lives far longer. Discarding an expired entry meant a long sweep signed in three or four times\n" +
  "       for no reason — five in five minutes answers 429, and on a stack with alerts on, the owner is\n" +
  "       messaged about his own test tooling.");
check("…and it waits out a 429 instead of throwing and leaving the lane dead",
  /if \(res\.status\(\) === 429\) \{[\s\S]{0,600}?res = await attempt\(\);/.test(read("scripts/sweep/login.mjs")),
  "scripts/sweep/login.mjs: answering the limit by throwing meant the lane died AND the attempt still\n" +
  "       counted against the window. Two lanes doing that in a row locks the whole sweep out.");
check("…and it still says plainly which failure it was",
  /is still rate-limited after waiting/.test(read("scripts/sweep/login.mjs")),
  "scripts/sweep/login.mjs: a real wrong-password and a rate limit must not read the same, or the next\n" +
  "       person raises the limit instead of finding the lane that is looping.");

// ══ ROUND 2 (2026-09-05) ══════════════════════════════════════════════════════════════════════

// a withheld card must not leave a hole where it was
check("the dish row collapses to ONE column when the activity card is withheld",
  /className=\{`ow2-two\$\{logsCardOn \? "" : " ow2-one"\}`\}/.test(homeC)
    && /\.ow2-two\.ow2-one \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(home),
  "app/owner/page.tsx: when the admin takes Audit & logs away, the Recent-activity card is correctly\n" +
  "       left out — and the grid kept its second track, so the dish list stayed in the left half and the\n" +
  "       right half was blank. Measured at 1440px: a 582x500 rectangle of empty page in the middle of\n" +
  "       the dashboard, which reads exactly like a card that failed to load. The comment beside that\n" +
  "       gate had claimed 'the dish list beside it simply takes the row' since it was written.");
check("…and the wrapper and the card read the SAME condition, so they cannot disagree",
  /const logsCardOn = ov\?\.entitlements\?\.logs !== false && !actsOff;/.test(homeC)
    && /\{logsCardOn && \(/.test(homeC),
  "app/owner/page.tsx: the row's column count and the card's own gate must be one value. Two copies\n" +
  "       of the same condition is how the hole came back the first time.");

// a tile that will never fill must not keep animating
check("the tiles stop pretending to load once the overview read has FAILED",
  /const ovFailed = !ov && !!err;/.test(homeC) && /const dashed = !!offNote \|\| ovFailed;/.test(homeC),
  "app/owner/page.tsx: with /api/owner/overview answering 500, `ov` is never coming — and every tile\n" +
  "       sat blank for ever: no figure, no dash, no caption, and the '● live' pill still on the Today\n" +
  "       tile over nothing at all. The red card explains the PAGE; a tile has to explain itself, which\n" +
  "       is the rule the switched-off state already follows.");
check("…and each of the five says WHY, rather than just going blank",
  /const dashSub = offNote \? offSub : "We couldn/.test(homeC)
    && (homeC.match(/sub=\{dashed \? dashSub/g) || []).length === 5,
  "app/owner/page.tsx: a dash with no sentence beside it is only half an answer. All five tiles must\n" +
  "       carry the reason, and it must say 'switched off' or 'we could not load it' — never both.");
check("a coverage caption never claims a count the page does not have",
  /const restScopeText = !ov\s*\n?\s*\? "your restaurants"/.test(homeC),
  "app/owner/page.tsx: with no overview payload restCount is 0, so four chart captions read 'added up\n" +
  "       across all 0 restaurants' under a red 'Couldn\u2019t load' card. A caption that overstates its\n" +
  "       coverage is what this line was written for; claiming ZERO coverage as fact is the same fault\n" +
  "       upside down.");
check("an unrecognised payload shape is treated as NO payload, not rendered",
  // Both DOORS and the SUBSTANCE. Asserting only that the function exists and is called let a
  // sabotaged `isPayload` that returns true unconditionally sit here green — the driven band
  // (P67411-P67430) catches that, but a static guard that cannot tell a validator from a stub is
  // not worth much on its own. So it also has to check the fields it walks.
  /function isPayload\(x: unknown\): boolean \{/.test(homeC)
    && /p\.scope !== "group" && p\.scope !== "restaurant"/.test(homeC)
    && /!Array\.isArray\(p\.timeseries\)/.test(homeC)
    && /!Array\.isArray\(p\.restaurantRevenue\)/.test(homeC)
    && /!Array\.isArray\(p\.dishes\)/.test(homeC)
    && /if \(!isPayload\(a\)\) throw new Error/.test(homeC)
    && /saved && isPayload\(saved\)/.test(homeC),
  "app/owner/page.tsx: every card walks p.timeseries / p.dishes / p.restaurantRevenue. Hand any of\n" +
  "       them something that is not an array and monthCompare throws 'p.timeseries is not iterable' —\n" +
  "       an uncaught render error, so the WHOLE owner panel falls to the error boundary and reads 'We\n" +
  "       couldn\u2019t load this just now'. Measured with {}, [] and a bare string: shell gone, five\n" +
  "       tiles gone. Both doors need the check — the live fetch AND the sessionStorage snapshot, which\n" +
  "       was written by whatever version of this page last ran in the tab.");

// ── the guard is wired up ──────────────────────────────────────────────────────────────────────
check("this guard is registered in package.json",
  /"verify:owner-screen"/.test(pkg),
  "package.json no longer has a verify:owner-screen entry, so nothing runs this file.");

if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) failed — the owner's home screen or his Audit & logs page has regressed:\n`);
  fails.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log(`✓ all ${total} checks passed — the owner home screen and Audit & logs hold their 2026-08-17 and 2026-08-27 fixes`);
