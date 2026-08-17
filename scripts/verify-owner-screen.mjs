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
const check = (name, ok, hint) => { if (!ok) fails.push(`${name}\n     → ${hint}`); };

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
  /!actsOff\s*&&/.test(homeC),
  "app/owner/page.tsx: the Recent-activity card no longer checks `actsOff`. Module checklist\n       point 6: render nothing when the flag is off — never a card that spins for ever.");

// ── 4. the activity feed rides the 60s backstop ─────────────────────────────────────────────────
{
  const tick = (homeC.match(/const tick = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/) || [""])[0];
  check("the 60s backstop refreshes the activity feed too",
    /fetchActs\(/.test(tick),
    "app/owner/page.tsx: `tick` no longer re-fetches the activity feed, so the card headed \"who did\n       what\" freezes at page load while every other card on the screen stays 60s fresh.");
}

// ── 5. a switched-off section reads as off, not broken ──────────────────────────────────────────
check("a `disabled` analytics answer goes to its own state, not the error banner",
  /a\.disabled.*setOffNote/.test(homeC) && !/a\.disabled\s*\)\s*\{\s*setErr\(errText/.test(homeC),
  "app/owner/page.tsx: the `disabled` branch of fetchPayload is putting the sentence back into\n       `err`, which renders in a RED card headed \"Couldn't load.\" A permission is not a breakage.");
check("no card claims to be loading once the section is known to be off",
  /const loadNote = offNote \?/.test(homeC) && (homeC.match(/\{loadNote\}/g) || []).length >= 12,
  "app/owner/page.tsx: the chart cards are back to a hardcoded \"Loading…\". Once the server has\n       said the section is switched off, no payload is coming and that promise is false — route\n       every placeholder through `loadNote` (12 of them at the time of writing).");
check("the KPI tiles stop linking into Reports when Reports are off",
  /const kpiHref = \(t: string\) => \(reportsOn \? reportHref\(t\) : undefined\)/.test(homeC)
    && !/<Kpi[^>]*href=\{reportHref\(/.test(homeC),
  "app/owner/page.tsx: a KPI tile is wired straight to `reportHref` again, so it stays a link for\n       an owner whose Reports section the admin removed. Use `kpiHref`, which returns undefined.");

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

// ── the guard is wired up ──────────────────────────────────────────────────────────────────────
check("this guard is registered in package.json",
  /"verify:owner-screen"/.test(pkg),
  "package.json no longer has a verify:owner-screen entry, so nothing runs this file.");

if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) failed — the owner's home screen or his Audit & logs page has regressed:\n`);
  fails.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log("✓ all 20 checks passed — the owner home screen and Audit & logs hold their 2026-08-17 fixes");
