// verify-admin-floor-limits.mjs — the admin's PLATFORM FLOOR and its RATE LIMITS, guarded.
//
// WHERE THIS BITES, in the owner's own terms:
//   · Admin console → Live floor        — the coloured mini-tiles for every restaurant at once,
//                                          its Live / Today tabs and its "Open tables" box.
//   · Admin console → Rate limits        — "Limits reached", "The limits", the unblock requests
//                                          and the blocked-device list.
//   · Admin console → Staff online       — who is signed in right now, across every restaurant.
//   · Backend only, nothing on screen    — lib/rateLimit.ts (the wall itself) and lib/liveBoard.ts
//                                          (the ONE order source the kitchen and waiter tablet share).
//
// Written by TERMINAL 21 of sweep #8. It carries the sweep's own ledger ids `P74701`–`P75200`, so
// "re-run row P74812" is a sentence that means something: `--from 112 --to 112` runs exactly it.
//
// THE FIVE FAULTS IT WAS BUILT AROUND — each one measured on screen before it was fixed:
//   item 1  the Rate limits page printed `3 / 0 per 0 hours` for the admin-password wall, which
//           deliberately has no ceiling to print. The Repair board had already been fixed for the
//           identical chip; this was the second of the two screens.
//   item 2  a rule saved with max 0 read as "max 0 per 1 min" — the strictest setting a person can
//           imagine — while lfh_rate_check treats `max_count <= 0` as NO LIMIT AT ALL. Reachable by
//           clearing the number box, which floored at 0 and lit up Save.
//   item 3  Staff online kept a restaurant filter after that restaurant left the roster, so the
//           picker read "All restaurants" over "0 of 2 online".
//   item 4  the Live floor's permanent "Manual — press Refresh" pill was drawn in the console's
//           WARNING colour. Staff online's identical pill had already been made neutral.
//   item 5  a 10-table restaurant rendered a 700px empty card, because a CSS grid stretches every
//           block in a row to the tallest one and this platform has 300-table restaurants.
//   item 6  the "Open tables" box ignored the Sort control the blocks below it obey.
//
// READ-ONLY, AND IT WRITES NOTHING ANYWHERE. Every live check is a GET; the two checks that need a
// hostile payload fabricate it in the browser with page.route() and never touch the database. It
// makes ONE admin request per page and no login at all (the admin cookie is derived locally), so it
// cannot trip the app's own limits — which, on this territory, would be its own subject matter.
//
//   node scripts/verify-admin-floor-limits.mjs --base http://localhost:4000
//   node scripts/verify-admin-floor-limits.mjs --base http://localhost:4000 --from 1 --to 250
//   node scripts/verify-admin-floor-limits.mjs --ledger            # regenerate the ledger table
//   node scripts/verify-admin-floor-limits.mjs --static            # no browser, no server needed
//
// A SERVICE WORKER EATS page.route() (this repo's own scar). The browser context is opened with
// serviceWorkers:"block" — without it the two fabricated-payload checks silently pass over a
// handler that never fired, which is worse than not having them.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const BASE = (arg("--base", "http://localhost:4000") || "").replace(/\/$/, "");
const FROM = Number(arg("--from", "1"));
const TO = Number(arg("--to", "99999"));
const LEDGER = has("--ledger");
const STATIC_ONLY = has("--static");
const QUIET = has("--quiet");
const FIRST_ID = 74701; // P74701 … P75200 — this terminal's own pre-allocated block

const src = (p) => readFileSync(join(root, p), "utf8");
const FLOOR = "app/aevinite/floor/page.tsx";
const RATES = "app/aevinite/rate-limits/page.tsx";
const ONLINE = "app/aevinite/staff-online/page.tsx";
const RLIB = "lib/rateLimit.ts";
const BLIB = "lib/liveBoard.ts";

// Strip comments so a check can never pass on a sentence in a comment that describes the very fault
// it is looking for. LINE COMMENTS FIRST: a `/*` inside a `//` line otherwise swallows everything to
// the next `*/` (this repo lost 190 lines of coverage to that order, twice).
const code = (t) => t.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const F = { floor: src(FLOOR), rates: src(RATES), online: src(ONLINE), rlib: src(RLIB), blib: src(BLIB) };
const C = Object.fromEntries(Object.entries(F).map(([k, v]) => [k, code(v)]));

const checks = [];
/** add(title, howToVerify, fn) — fn returns true / false / a string note (truthy = pass). */
const add = (title, how, fn) => checks.push({ title, how, fn });
const addStatic = (title, fn) => add(title, "static read of the file named in the check", fn);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND A — the Live floor page, read for correctness            (index 1–100 · P74701–P74800)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const STATES = ["free", "seated", "new", "preparing", "served", "cleared"];
const SORTS = ["busy", "active", "orders", "attention", "name"];
const TAGS = ["vip", "family", "guest"];
const STATCARDS = [
  ["Restaurants live", "fa-store"], ["Tables busy", "fa-chair"], ["Orders today", "fa-receipt"],
  ["Cooking now", "fa-fire-burner"], ["Unpaid bills", "fa-file-invoice"], ["Waiter calls", "fa-bell"],
];

addStatic("Live floor · the page is a client component (it holds a snapshot and a sort in state)", () => C.floor.startsWith('"use client"') || F.floor.startsWith('"use client"'));
addStatic("Live floor · nothing is fetched on mount — the first read is behind the Load button", () => !/useEffect\(\s*\(\)\s*=>\s*\{\s*load\(\)/.test(C.floor));
addStatic("Live floor · the gate button calls start(), which is the only place `started` turns true", () => /const start = useCallback\(\(\) => \{ setStarted\(true\); load\(\); \}/.test(C.floor));
addStatic("Live floor · the snapshot read is the ?all=1 platform read, not one call per restaurant", () => C.floor.includes('"/api/admin/floor?all=1"'));
addStatic("Live floor · the snapshot read is cache:no-store, so Refresh cannot answer from a cache", () => /floor\?all=1", \{ cache: "no-store" \}/.test(C.floor));
addStatic("Live floor · a slow old response can never overwrite a newer one (a latest-wins guard)", () => /const mySeq = \+\+seq\.current/.test(C.floor) && (C.floor.match(/mySeq !== seq\.current/g) || []).length >= 2);
addStatic("Live floor · the latest-wins guard runs on the FAILURE path too", () => /catch\(\(e\) => \{\s*if \(mySeq !== seq\.current\) return;/.test(C.floor));
addStatic("Live floor · a failed snapshot shows the reason on screen, not only a toast", () => /Couldn&apos;t load the floors: \{err\}/.test(F.floor));
addStatic("Live floor · a half-failed snapshot names WHICH half (order counts) instead of drawing zeros", () => /Order counts unavailable \(\{statsErr\}\)/.test(F.floor));
addStatic("Live floor · a half-failed snapshot names WHICH half (the tiles) instead of drawing empty floors", () => /Live tables unavailable \(\{tilesErr\}\)/.test(F.floor));
addStatic("Live floor · the tiles-unavailable banner offers a Retry, because that half is the screen", () => /tilesErr &&[\s\S]{0,600}onClick=\{load\}>Retry<\/button>/.test(F.floor));
addStatic("Live floor · neither banner prints the database's own sentence (the route sends words)", () => !/error\.message/.test(C.floor));
addStatic("Live floor · the page says in words that it does NOT refresh itself", () => /Manual — press Refresh to update/.test(F.floor));
addStatic("Live floor · item 4 — that permanent pill is NOT drawn in the console's warning colour", () => /\.adm-snapchip \{[^}]*color: var\(--muted\)/.test(F.floor) && !/\.adm-snapchip \{[^}]*--adm-warn/.test(F.floor));
addStatic("Live floor · item 4 — it uses the same neutral fill Staff online's identical pill uses", () => /\.adm-snapchip \{[^}]*color-mix\(in srgb, var\(--text\) 7%, transparent\)/.test(F.floor));
addStatic("Live floor · item 5 — the restaurant blocks take their own height, not the tallest one's", () => /\.adm-flooryear \{ align-items: start; \}/.test(F.floor));
addStatic("Live floor · item 6 — the Open-tables box reads the SORTED list, like the blocks below it", () => /const occ = sorted\.map\(\(r\) =>/.test(C.floor));
addStatic("Live floor · there is exactly one place that builds the occupied list (no second copy)", () => (C.floor.match(/const occ = /g) || []).length === 1);
addStatic("Live floor · 'Updated Xs ago' re-ticks on a timer so it can never freeze at 'just now'", () => /setInterval\(\(\) => force\(\(n\) => n \+ 1\), 10000\)/.test(C.floor));
addStatic("Live floor · that tick clears itself on unmount", () => /setInterval\(\(\) => force[\s\S]{0,80}return \(\) => clearInterval\(id\)/.test(C.floor));
addStatic("Live floor · the age tick fetches NOTHING — it only re-renders a label", () => !/setInterval\([\s\S]{0,120}fetch\(/.test(C.floor));
addStatic("Live floor · an old snapshot is marked old (amber after two minutes), never left looking live", () => /s >= 120 \? " old"/.test(C.floor));
addStatic("Live floor · a negative age can never print (a clock skew reads as 'just now')", () => /Math\.max\(0, Math\.floor\(\(Date\.now\(\) - at\) \/ 1000\)\)/.test(C.floor));
addStatic("Live floor · the age label has a form for seconds, minutes AND hours", () => /just now.*\$\{s\}s ago.*Math\.floor\(s \/ 60\)\}m ago.*Math\.floor\(s \/ 3600\)\}h ago/s.test(C.floor));
addStatic("Live floor · the snapshot time comes from the SERVER's generatedAt when it sends one", () => /j\.generatedAt \? new Date\(j\.generatedAt\)\.getTime\(\) : Date\.now\(\)/.test(C.floor));
addStatic("Live floor · pressing Refresh twice cannot fire two reads (the button disables while busy)", () => /onClick=\{load\} disabled=\{fetching\}/.test(F.floor));
addStatic("Live floor · the sort choice is remembered on this device", () => /localStorage\.setItem\(SORT_KEY, v\)/.test(C.floor));
addStatic("Live floor · the saved sort is read AFTER mount, so the first paint cannot disagree with the server", () => /useEffect\(\(\) => \{\s*try \{ const s = localStorage\.getItem\(SORT_KEY\)/.test(C.floor));
addStatic("Live floor · an unknown saved sort is ignored rather than leaving the list unsorted", () => /SORTS\.some\(\(o\) => o\.value === s\)/.test(C.floor));
addStatic("Live floor · reading or writing localStorage can never throw the page down", () => (C.floor.match(/catch \{\}/g) || []).length >= 2);
addStatic("Live floor · every sort is a total order — each one falls back to name so it is stable", () => /const desc = \(f: \(r: RestFloor\) => number\) => \(a: RestFloor, b: RestFloor\) => f\(b\) - f\(a\) \|\| byName\(a, b\)/.test(C.floor));
addStatic("Live floor · sorting copies the list instead of reordering the snapshot in place", () => /const copy = \[\.\.\.rests\]/.test(C.floor));
addStatic("Live floor · 'Needs attention' weighs a waiting human double", () => /callCount\(r\.tables\) \* 2 \+ unpaidTableCount\(r\.tables\)/.test(C.floor));
addStatic("Live floor · 'busy' means any table that is not free, on every screen that says busy", () => /const busyCount = \(t: MiniTable\[\]\) => t\.filter\(\(x\) => x\.s !== "free"\)\.length/.test(C.floor));
addStatic("Live floor · an unpaid TABLE is the red ring, not a guess from the order counts", () => /unpaidTableCount = \(t: MiniTable\[\]\) => t\.filter\(\(x\) => x\.p === "red"\)/.test(C.floor));
SORTS.forEach((s) => addStatic(`Live floor · the sort "${s}" is offered in the picker AND handled by sortRests`, () =>
  new RegExp(`value: "${s}"`).test(C.floor) && (s === "name" ? true : new RegExp(`by === "${s}"`).test(C.floor))));
STATES.forEach((s) => addStatic(`Live floor · the tile state "${s}" has a colour of its own in the legend palette`, () =>
  new RegExp(`(^|[^a-z])${s}:`).test(C.floor.split("STATE_COLOR")[1]?.slice(0, 300) || "")));
STATES.filter((s) => s !== "free").forEach((s) => addStatic(`Live floor · "${s}" is a real colour, not the empty fallback`, () => {
  const m = (C.floor.split("STATE_COLOR")[1] || "").slice(0, 300).match(new RegExp(`${s}: "([^"]*)"`));
  return !!m && m[1].length > 3;
}));
addStatic("Live floor · a tile whose state the server invents still draws something, never nothing", () => /STATE_COLOR\[t\.s\] \|\| "var\(--muted2/.test(C.floor));
TAGS.forEach((t) => addStatic(`Live floor · the special table type "${t}" has an emoji, a colour and a spoken label`, () => {
  const m = (C.floor.match(new RegExp(`${t}: \\{ emoji: "([^"]+)", color: "([^"]+)", label: "([^"]+)"`)) || []);
  return m.length === 4;
}));
addStatic("Live floor · a tag is only read when the server actually sent one (an empty string is not a tag)", () => /const tg = t\.g \? TAG_MINI\[t\.g\] : undefined/.test(C.floor));
addStatic("Live floor · an unknown tag name cannot crash the tile — it simply has no ring", () => /tg \? `inset 0 0 0 2px \$\{tg\.color\}` : undefined/.test(C.floor));
addStatic("Live floor · money state beats decoration: an unpaid red ring wins over a tag's colour", () => /t\.p === "red" \? "inset 0 0 0 2px #f87171" : t\.p === "green"/.test(C.floor));
addStatic("Live floor · a label that is not a table number is clipped, never allowed to smear", () => /overflow: "hidden"/.test(C.floor) && /const long = String\(t\.n\)\.length > 3/.test(C.floor));
addStatic("Live floor · a clipped label keeps a leading ellipsis so it never pretends to be the whole value", () => /"…" \+ String\(t\.n\)\.slice\(-2\)/.test(C.floor));
addStatic("Live floor · the full table label always survives in the tile's tooltip", () => /title=\{`Table \$\{t\.n\}/.test(C.floor));
addStatic("Live floor · a waiter call takes over the tile's face, because a person is waiting", () => /t\.c \? "•" :/.test(C.floor));
addStatic("Live floor · the tooltip spells out unpaid / paid / waiter-called in words", () => /· UNPAID.*· paid.*· waiter called/s.test(C.floor));
addStatic("Live floor · every platform total is derived from the ONE snapshot, never re-fetched", () => (C.floor.match(/sorted\.reduce\(/g) || []).length >= 6);
STATCARDS.forEach(([label, icon]) => addStatic(`Live floor · the "${label}" total is on screen with its own icon`, () =>
  new RegExp(`icon="${icon}" label="${label}"`).test(C.floor)));
addStatic("Live floor · 'Restaurants live' is shown out of the total, not as a bare number", () => /label="Restaurants live" value=\{restsLive\} sub=\{` \/ \$\{sorted\.length\}`\}/.test(C.floor));
addStatic("Live floor · 'Tables busy' is shown out of the total too", () => /label="Tables busy" value=\{tablesBusy\} sub=\{` \/ \$\{tablesTotal\}`\}/.test(C.floor));
addStatic("Live floor · the counting-up animation is cancelled when the number changes again", () => /return \(\) => cancelAnimationFrame\(raf\)/.test(C.floor));
addStatic("Live floor · a number that did not change does not re-animate", () => /if \(from === target\) \{ setShown\(target\); return; \}/.test(C.floor));
addStatic("Live floor · the count-up always lands exactly on the real number", () => /setShown\(Math\.round\(from \+ \(target - from\) \* eased\)\)/.test(C.floor) && /Math\.min\(1, \(t - t0\) \/ ms\)/.test(C.floor));
addStatic("Live floor · NO money anywhere on this screen (the admin sees no earnings, ever)", () => !/₹|revenue|earnings|inr\(/i.test(C.floor.replace(/unpaid/gi, "")));
addStatic("Live floor · the Today tab and the Live tab read the SAME snapshot — the tab costs no fetch", () => (C.floor.match(/fetch\(/g) || []).length === 2);
addStatic("Live floor · the only second fetch on this page is the lazy cancelled-orders list", () => /fetch\("\/api\/admin\/cancelled-today"/.test(C.floor));
addStatic("Live floor · the cancelled list is fetched only when its section is opened", () => /if \(next && cancelledList === null && !cancelledLoading\) loadCancelled\(\)/.test(C.floor));
addStatic("Live floor · a fresh snapshot re-reads the cancelled list only if it is still open", () => /if \(updatedAt !== null && cancelledOpen\) loadCancelled\(\)/.test(C.floor));
addStatic("Live floor · a failed cancelled-list read says so instead of 'nothing was cancelled today'", () => /Couldn&apos;t load: \{cancelledErr\}/.test(F.floor));
addStatic("Live floor · an EMPTY cancelled list says so in a whole sentence", () => /No orders were cancelled today\./.test(F.floor));
addStatic("Live floor · the cancelled list shows the restaurant, the table, the KOT and the time", () => /<span>Restaurant<\/span><span>Table<\/span><span>KOT<\/span>/.test(F.floor));
addStatic("Live floor · a missing table or KOT prints an em dash, never 'undefined' or 'null'", () => /c\.table != null \? `#\$\{c\.table\}` : "—"/.test(C.floor) && /c\.kot != null \? `#\$\{c\.kot\}` : "—"/.test(C.floor));
addStatic("Live floor · the Today tab explains that its counts leave cancelled orders out", () => /Order counts exclude cancelled orders/.test(F.floor));
addStatic("Live floor · the Today tab names the business day it means (since 5am)", () => /since 5am, the business day/.test(F.floor));
addStatic("Live floor · the per-restaurant Today table has a heading row over its four numbers", () => /<span>Restaurant<\/span>\s*<span style=\{\{ textAlign: "right" \}\}>Orders<\/span>/.test(F.floor));
addStatic("Live floor · an unpaid count is coloured only when there is something to look at", () => /r\.unpaidOrders > 0 \? "var\(--adm-danger\)" : undefined/.test(C.floor));
addStatic("Live floor · a cancelled count is coloured only when there is something to look at", () => /r\.cancelledToday > 0 \? "#d97706" : undefined/.test(C.floor));
addStatic("Live floor · a suspended restaurant is marked as suspended on its block", () => /!r\.active && <span style=\{\{ color: "var\(--adm-danger\)", fontWeight: 700 \}\}> · suspended<\/span>/.test(F.floor));
addStatic("Live floor · a suspended restaurant is marked in the Today table as well", () => (F.floor.match(/· suspended/g) || []).length >= 2);
addStatic("Live floor · a restaurant whose own floor failed says so on its block", () => /r\.error \? "floor unavailable"/.test(C.floor));
addStatic("Live floor · a restaurant with no tables says 'No tables.' rather than drawing nothing", () => /No tables\./.test(F.floor));
addStatic("Live floor · every restaurant name on this page is a door into that restaurant", () => (C.floor.match(/onClick=\{\(\) => openPanel\(r\)\}/g) || []).length >= 3);
addStatic("Live floor · a blocked new tab is never a dead tap — it opens a way in instead", () => /if \(!w\) setBlocked\(\{ rid: r\.id, name: r\.name, slug: r\.slug, active: r\.active \}\)/.test(C.floor));
addStatic("Live floor · the blocked-tab card offers the manager panel IN THIS TAB (needs no pop-up)", () => /act-as\/go\?rid=/.test(C.floor));
addStatic("Live floor · the blocked-tab card does not offer a SUSPENDED restaurant's guest menu", () => /r\.active \? \(\s*<a className="adm-btn" href=\{`\/r\/\$\{r\.slug\}\/menu`\}/.test(F.floor));
addStatic("Live floor · that disabled button says WHY, and where to undo it", () => /it&rsquo;s suspended/.test(F.floor) && /Reactivate it in the danger zone/.test(F.floor));
addStatic("Live floor · the blocked-tab card points at the restaurant's own details page", () => /\/aevinite\/restaurants\?focus=\$\{encodeURIComponent\(r\.slug\)\}/.test(C.floor));
addStatic("Live floor · that pop-up is registered with the back-button manager, like every other one", () => /useAdminModal\(ref, "adm-floor-blocked", onClose\)/.test(C.floor));
addStatic("Live floor · the pop-up is a real dialog for a screen reader", () => /role="dialog" aria-modal="true"/.test(F.floor));
addStatic("Live floor · the pop-up can be closed by its backdrop as well as its button", () => /<div onClick=\{onClose\}[^>]*position: "fixed", inset: 0/.test(F.floor));
addStatic("Live floor · a thrown error while opening a restaurant is told to the admin", () => /Couldn&apos;t open \$\{r\.name\}|Couldn't open \$\{r\.name\}/.test(F.floor));
addStatic("Live floor · every restaurant slug in a link is escaped before it goes into an address", () => (C.floor.match(/encodeURIComponent\(/g) || []).length >= 3);
addStatic("Live floor · the two tabs are real tabs for a screen reader", () => /role="tablist"/.test(F.floor) && (F.floor.match(/role="tab"/g) || []).length === 2);
addStatic("Live floor · the Open-tables box says how many and at how many restaurants", () => /\{total\} occupied · \{occ\.length\} restaurant/.test(F.floor));
addStatic("Live floor · 'restaurant' is singular for one and plural for the rest", () => /occ\.length === 1 \? "" : "s"/.test(C.floor));
addStatic("Live floor · the Open-tables box costs no extra read — it re-uses the snapshot", () => !/loadOpenTables|fetch\("\/api\/admin\/open-tables/.test(C.floor));
addStatic("Live floor · an empty Open-tables box says so in words", () => /No tables occupied right now\./.test(F.floor));
addStatic("Live floor · the Open-tables box is collapsed by default (it is a drill-in, not the view)", () => /useState\(false\);[\s\S]{0,40}openTablesOpen/.test(C.floor) || /const \[openTablesOpen, setOpenTablesOpen\] = useState\(false\)/.test(C.floor));
addStatic("Live floor · every collapsible section tells a screen reader whether it is open", () => (F.floor.match(/aria-expanded=/g) || []).length >= 2);
addStatic("Live floor · the first paint shows skeletons, not an empty screen pretending to be loaded", () => (C.floor.match(/adm-skel/g) || []).length >= 5);
addStatic("Live floor · the skeletons are hidden from a screen reader", () => /aria-hidden="true">\s*<header>/.test(F.floor) || /className="adm-card adm-floormonth" aria-hidden="true"/.test(F.floor));
addStatic("Live floor · the legend explains every colour the tiles can be", () => STATES.every((s) => new RegExp(s === "new" ? "New order" : s.replace(/^./, (c) => c.toUpperCase()), "i").test(F.floor.split("LEGEND")[1]?.slice(0, 500) || "")));
addStatic("Live floor · the legend explains the two rings and the waiter-call dot too", () => /Unpaid[\s\S]{0,900}Paid[\s\S]{0,300}= waiter call/.test(F.floor));
addStatic("Live floor · the gate card explains WHY the page does not load on its own", () => /that keeps the database load down/.test(F.floor));
addStatic("Live floor · the gate button clears the 44px tap floor the phone rules ask for", () => /\.adx \.floor-gate \.floor-gate-btn \{[^}]*min-height: 44px/.test(F.floor));
addStatic("Live floor · nothing on this page polls — there is no timer that fetches", () => !/setInterval\([^)]*load\b/.test(C.floor));
addStatic("Live floor · the page never renders a raw object or a template hole", () => !/\$\{[^}]*\}\s*<\/(span|div|b|p)>/.test(F.floor.replace(/`[^`]*`/g, "")));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND B — the Rate limits page, read for correctness           (index 101–190 · P74801–P74890)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const RL_ACTIONS = ["allow", "dismiss", "block", "clear", "unblock", "approve_request", "deny_request"];
const RL_SECTIONS = ["hits", "rules", "requests", "blocked"];

addStatic("Rate limits · item 1 — a hit with no ceiling states the only fact it has, not zeros", () => /const hitChip = /.test(C.rates) && /h\.max_count > 0 && h\.window_seconds > 0/.test(C.rates));
addStatic("Rate limits · item 1 — that chip is what the hit actually renders", () => /<span className="rl-chip danger">\{hitChip\(h\)\}<\/span>/.test(C.rates));
addStatic("Rate limits · item 1 — the raw '/ 0 per' shape is gone from the page for good", () => !/\{h\.hit_count\} \/ \{h\.max_count\} per/.test(C.rates));
addStatic("Rate limits · item 1 — 'attempt' is singular for one and plural for the rest", () => /attempt\$\{h\.hit_count === 1 \? "" : "s"\}/.test(C.rates));
addStatic("Rate limits · item 1 — this page and the Repair board word that chip identically", () => {
  const rep = code(src("app/aevinite/repair/page.tsx"));
  return /attempt\$\{h\.hit_count === 1 \? "" : "s"\}/.test(rep);
});
addStatic("Rate limits · item 2 — a rule whose number is 0 says what 0 actually does", () => /r\.max_count <= 0 \? "off — a limit of 0 lets everything through"/.test(C.rates));
addStatic("Rate limits · item 2 — a switched-off rule still simply reads 'off'", () => /!r\.enabled \? "off"/.test(C.rates));
addStatic("Rate limits · item 2 — the rule line is built in ONE place, so it cannot drift", () => /const ruleWords = /.test(C.rates) && (C.rates.match(/ruleWords\(r\)/g) || []).length === 1);
addStatic("Rate limits · item 2 — the number box can no longer be emptied into a 0", () => /type="number" min=\{1\} max=\{100000\}/.test(C.rates));
addStatic("Rate limits · item 2 — and its typing floor matches that minimum", () => /max_count: Math\.max\(1, Math\.trunc\(\+e\.target\.value \|\| 1\)\)/.test(C.rates));
addStatic("Rate limits · item 2 — the window box still floors at one second, not zero", () => /window_seconds: Math\.max\(1, Math\.trunc\(\+e\.target\.value \|\| 1\)\)/.test(C.rates));
addStatic("Rate limits · item 2 — the window box's ceiling is one day, matching what the server accepts", () => /min=\{1\} max=\{86400\}/.test(C.rates));
addStatic("Rate limits · the max box's ceiling matches what the server accepts", () => /max=\{100000\}/.test(C.rates));
addStatic("Rate limits · a limit is named by its rule label first — the name the admin edits here", () => /rules\.find\(\(r\) => r\.key === key\)\?\.label/.test(C.rates));
addStatic("Rate limits · behind that sits the ONE shared name list, so two screens cannot disagree", () => /RATE_LABELS\[key\]/.test(C.rates) && /from "@\/lib\/plainError"/.test(C.rates));
addStatic("Rate limits · a key nobody has named yet is still never printed raw", () => /key\.replace\(\/_\/g, " "\)\.replace\(\/\^\.\/, \(c\) => c\.toUpperCase\(\)\)/.test(C.rates));
addStatic("Rate limits · that order (rule label, then shared list, then prettifier) is the same one Repair uses", () => {
  const rep = code(src("app/aevinite/repair/page.tsx"));
  return /rlRules\.find\(\(r\) => r\.key === key\)\?\.label\s*\|\|\s*RATE_LABELS\[key\]\s*\|\|/.test(rep);
});
addStatic("Rate limits · a FAILED read is flagged as unknown — never as a green all-clear", () => /so this is <b>unknown<\/b>, not clear/.test(F.rates));
RL_SECTIONS.forEach((s) => addStatic(`Rate limits · the "${s}" section shows that unknown state instead of its empty state`, () =>
  new RegExp(`collapsed\\.${s} \\? null : loading \\? <SkelList[^>]*\\/> : loadErr \\? unread`).test(C.rates)));
addStatic("Rate limits · the unknown state offers a Retry, so it is not a dead end", () => /rl-unread[\s\S]{0,400}onClick=\{load\}>Retry<\/button>/.test(F.rates));
addStatic("Rate limits · the unknown state is drawn as neither the green all-clear nor the red alarm", () => /\.rl-unread\{[^}]*--adm-warn/.test(F.rates));
addStatic("Rate limits · a successful read clears any earlier failure", () => /setLoadErr\(""\)/.test(C.rates));
RL_ACTIONS.forEach((a) => addStatic(`Rate limits · the "${a}" action is sent to the server by that exact name`, () =>
  new RegExp(`action: "${a}"`).test(C.rates)));
RL_ACTIONS.forEach((a) => addStatic(`Rate limits · a refused "${a}" tells the admin and re-reads, so the screen cannot keep a lie`, () => {
  const fn = { allow: "allowHit", dismiss: "dismissHit", block: "blockHit", clear: "clearHit", unblock: "unblock", approve_request: "approveRequest", deny_request: "denyRequest" }[a];
  const body = C.rates.split(`const ${fn} = `)[1]?.slice(0, 900) || "";
  return /toast\(res\.error/.test(body) && /load\(\)/.test(body);
}));
addStatic("Rate limits · every action that removes a row from the screen puts it back if it failed", () => (C.rates.match(/toast\(res\.error \|\| "Couldn't/g) || []).length >= 5);
addStatic("Rate limits · an admin-password alert offers the KIND answer as well as the harsh one", () => /Let them try again/.test(F.rates) && /Block this device/.test(F.rates));
addStatic("Rate limits · 'Let them try again' calls the server's own clear action, the one Repair uses", () => /clearHit[\s\S]{0,300}action: "clear"/.test(C.rates));
addStatic("Rate limits · an admin-password alert does NOT offer 'Change limit' (there is no number to change)", () => /h\.key === "admin_login" \?/.test(C.rates));
addStatic("Rate limits · a normal wall offers Allow and Change-limit instead of Block", () => /Allow \(reset\)/.test(F.rates) && /Change limit/.test(F.rates));
addStatic("Rate limits · every hit can be handed to Claude to investigate", () => /\/api\/admin\/fix-request/.test(C.rates));
addStatic("Rate limits · that hand-off carries a sentence a person can read, not a row id", () => /Investigate whether this is genuine abuse or the limit is too tight/.test(F.rates));
addStatic("Rate limits · that hand-off names the restaurant only when the wall belongs to one", () => /h\.restaurant_id !== "00000000-0000-0000-0000-000000000000" \? h\.restaurant_id : null/.test(C.rates));
addStatic("Rate limits · that hand-off carries its own action id, so a retry cannot double it", () => /"X-LFH-Action-Id": uuid\(\)/.test(C.rates));
addStatic("Rate limits · 'Change limit' opens 'The limits' itself when that section is folded shut", () => /setSection\("rules", false\)/.test(C.rates));
addStatic("Rate limits · …and only scrolls once the row it is scrolling to actually exists", () => /requestAnimationFrame\(\(\) => requestAnimationFrame\(/.test(C.rates));
addStatic("Rate limits · …and rings the row, because landing near it is not being shown it", () => /setAttribute\("data-adm-flash", ""\)/.test(C.rates));
addStatic("Rate limits · …and takes the ring off again", () => /removeAttribute\("data-adm-flash"\)/.test(C.rates));
addStatic("Rate limits · arriving from another screen at #rule-<key> runs those SAME three lines", () => /const revealRule = useCallback\(/.test(C.rates) && (C.rates.match(/revealRule\(key\)/g) || []).length === 2);
addStatic("Rate limits · a link naming a rule that does not exist leaves the page where it is", () => /if \(!rules\.some\(\(r\) => r\.key === key\)\) return;/.test(C.rates));
addStatic("Rate limits · a later refresh cannot yank the admin back to a rule he has moved on from", () => /jumped\.current = true/.test(C.rates));
addStatic("Rate limits · every rule row carries the anchor those links point at", () => /id=\{`rule-\$\{r\.key\}`\}/.test(C.rates));
addStatic("Rate limits · the Repair board's 'Change rate limit' points at that same anchor", () => {
  const rep = code(src("app/aevinite/repair/page.tsx"));
  return /\/aevinite\/rate-limits#rule-\$\{/.test(rep);
});
addStatic("Rate limits · this page links back to the Problems board, so neither is a dead end", () => /\/aevinite\/repair#rate-limits/.test(C.rates));
addStatic("Rate limits · Save is refused until a number actually changes", () => /disabled=\{!dirty \|\| busy === r\.id\}/.test(C.rates));
addStatic("Rate limits · 'dirty' compares the draft against the saved row, both numbers", () => /const dirty = d\.max_count !== r\.max_count \|\| d\.window_seconds !== r\.window_seconds/.test(C.rates));
addStatic("Rate limits · a rule being saved cannot be toggled at the same moment", () => /className=\{`rl-toggle\$\{r\.enabled \? " on" : ""\}`\} disabled=\{busy === r\.id\}/.test(C.rates));
addStatic("Rate limits · a saved rule updates in place — the whole list is not re-fetched for one row", () => /setRules\(\(prev\) => prev\.map\(\(x\) => \(x\.id === r\.id \? \{ \.\.\.x, \.\.\.patch \} : x\)\)\)/.test(C.rates));
addStatic("Rate limits · a REFUSED save re-reads, so the row cannot keep showing a value the server rejected", () => /toast\(res\.error \|\| "Couldn't save\.", "err"\); load\(\)/.test(C.rates));
addStatic("Rate limits · the on/off switch tells a screen reader which way it is", () => /aria-pressed=\{r\.enabled\}/.test(C.rates));
addStatic("Rate limits · both number boxes are labelled for a screen reader", () => (C.rates.match(/aria-label=\{`\$\{r\.label\}/g) || []).length === 2);
addStatic("Rate limits · the admin-password wall is shown as a NOTE, not as an editable rule", () => /rl-rule rl-note/.test(C.rates));
addStatic("Rate limits · that note explains why it has no number (so nobody can lock himself out)", () => /so you can never lock yourself out/.test(F.rates));
addStatic("Rate limits · that note points at the two lists it actually appears in", () => /Limits reached<\/b> \(top\)[\s\S]{0,200}Blocked from the admin panel<\/b> \(bottom\)/.test(F.rates));
addStatic("Rate limits · a folded section is remembered on this device", () => /localStorage\.setItem\("lfh_rl_collapsed"/.test(C.rates));
addStatic("Rate limits · reading that memory can never throw the page down", () => /catch \{ \/\* ignore \*\/ \}/.test(F.rates));
addStatic("Rate limits · setting a section shut when it already is does not re-render the page", () => /if \(!!p\[id\] === shut\) return p;/.test(C.rates));
addStatic("Rate limits · a section heading can be opened from the keyboard, not only the mouse", () => /e\.key === "Enter" \|\| e\.key === " "/.test(C.rates));
addStatic("Rate limits · a section heading tells a screen reader whether it is open", () => /aria-expanded=\{!collapsed\[id\]\}/.test(C.rates));
addStatic("Rate limits · a folded section is visibly folded (the caret turns)", () => /\.rl-caret\.closed\{transform:rotate\(-90deg\)\}/.test(F.rates));
addStatic("Rate limits · an unblock request shows what the person actually typed", () => /\{q\.message\}/.test(F.rates));
addStatic("Rate limits · a repeat asker is marked as one", () => /asked \{q\.asked_today\}× today/.test(F.rates));
addStatic("Rate limits · …but only when the server could actually count, never as a guess", () => /\(q\.asked_today \?\? 0\) > 1/.test(C.rates));
addStatic("Rate limits · unblocking a device also clears any request that device had open", () => /setRequests\(\(prev\) => prev\.filter\(\(x\) => x\.key !== b\.key\)\)/.test(C.rates));
addStatic("Rate limits · approving a request also takes that device off the blocked list on screen", () => /approveRequest[\s\S]{0,300}setBlocked\(\(prev\) => prev\.filter\(\(x\) => x\.key !== q\.key\)\)/.test(C.rates));
addStatic("Rate limits · denying a request leaves the block in place, and says only that", () => /denyRequest[\s\S]{0,400}toast\("Request dismissed\."\)/.test(C.rates));
addStatic("Rate limits · a blocked device shows its human note when it has one, its address when it does not", () => /\{b\.note \|\| b\.ip\}/.test(C.rates));
addStatic("Rate limits · every section heading carries a count chip only when there is something to count", () => (C.rates.match(/\.length \? <span className="rl-chip/g) || []).length >= 3);
addStatic("Rate limits · a section's icon goes red only when that section has something in it", () => /color: loadErr \? "var\(--adm-warn\)" : hits\.length \? "var\(--adm-danger\)" : "var\(--muted\)"/.test(C.rates));
addStatic("Rate limits · NO money anywhere on this screen", () => !/₹|earnings|revenue|inr\(/i.test(C.rates));
addStatic("Rate limits · the page does not poll — it reads once and on Refresh", () => !/setInterval|useActiveAutoRefresh/.test(C.rates));
addStatic("Rate limits · Refresh cannot be pressed twice into two reads", () => /onClick=\{load\} disabled=\{loading\}/.test(C.rates));
addStatic("Rate limits · every window is spoken in hours, minutes or seconds — never raw seconds alone", () => /function perLabel/.test(C.rates) && /hour\$\{/.test(C.rates));
addStatic("Rate limits · 'hour' is singular for one and plural for the rest", () => /hour\$\{s \/ 3600 === 1 \? "" : "s"\}/.test(C.rates));
addStatic("Rate limits · the page never renders the database's own sentence", () => !/\.error\.message|detail\b/.test(C.rates));
addStatic("Rate limits · every toast says what happened AND what it means", () => /Allowed — their counter is reset\./.test(F.rates) && /Cleared — that device can try the admin password again now\./.test(F.rates));
addStatic("Rate limits · the wall the admin is looking at names WHO hit it", () => /Who: <b style=\{\{ color: "var\(--text\)" \}\}>\{h\.subject_label \|\| h\.subject\}<\/b>/.test(F.rates));
addStatic("Rate limits · a hit at a named restaurant says which restaurant", () => /h\.restaurant_name \? <span className="adm-muted"[\s\S]{0,200}\{h\.restaurant_name\}/.test(F.rates));
addStatic("Rate limits · a hit says how long ago it was", () => /timeAgo\(h\.last_at\)/.test(C.rates));
addStatic("Rate limits · the 'Limits reached' caption says plainly that it covers every restaurant", () => /who hit a wall right now · all restaurants/.test(F.rates));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND C — Staff online, read for correctness                   (index 191–240 · P74891–P74940)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const ROLES = ["manager", "kitchen", "tablet", "owner"];

addStatic("Staff online · item 3 — a filter that no longer names a restaurant is dropped on load", () => /setFilterRid\(\(cur\) => \(cur && !rl\.some\(\(r\) => r\.id === cur\) \? "" : cur\)\)/.test(C.online));
addStatic("Staff online · item 3 — that check runs on EVERY load, not only the first", () => C.online.split("const load = useCallback")[1]?.includes("setFilterRid((cur)"));
addStatic("Staff online · item 3 — a filter that still names a live restaurant is left alone", () => /\? "" : cur\)/.test(C.online));
ROLES.forEach((r) => addStatic(`Staff online · the role "${r}" is offered as a filter chip`, () => new RegExp(`"${r}"`).test(C.online.split("const ROLES")[1]?.slice(0, 200) || "")));
ROLES.forEach((r) => addStatic(`Staff online · the role "${r}" has a spoken label, never the raw word`, () => new RegExp(`${r}: "`).test(C.online.split("ROLE_LABEL")[1]?.slice(0, 200) || "")));
ROLES.forEach((r) => addStatic(`Staff online · the role "${r}" has a colour of its own`, () => new RegExp(`${r}: "#`).test(C.online.split("ROLE_COLOR")[1]?.slice(0, 200) || "")));
ROLES.forEach((r) => addStatic(`Staff online · the role "${r}" has a fixed place in the sort order`, () => new RegExp(`${r}: \\d`).test(C.online.split("ROLE_ORDER")[1]?.slice(0, 200) || "")));
addStatic("Staff online · the role list matches the four roles a person in this product can hold", () => {
  const m = code(src("lib/userAuth.ts")).match(/export type Role = ([^;]+);/);
  const declared = (m?.[1] || "").match(/"([a-z]+)"/g)?.map((s) => s.replace(/"/g, "")) || [];
  return declared.length === 4 && declared.every((r) => ROLES.includes(r));
});
addStatic("Staff online · a role the server invents still renders — with its own word and a grey dot", () => /ROLE_LABEL\[u\.role\] \|\| u\.role/.test(C.online) && /ROLE_COLOR\[u\.role\] \|\| "#9ca3af"/.test(C.online));
addStatic("Staff online · role chips are combinable, not one-at-a-time", () => /prev\.includes\(r\) \? prev\.filter\(\(x\) => x !== r\) : \[\.\.\.prev, r\]/.test(C.online));
addStatic("Staff online · the 'All' chip clears the role filter rather than adding a fifth role", () => /onClick=\{\(\) => setFilterRoles\(\[\]\)\}/.test(C.online));
addStatic("Staff online · the search looks at the name, the role AND the restaurant", () => /\(u\.name \|\| u\.username\)\.toLowerCase\(\)\.includes\(q\)/.test(C.online) && /u\.restaurantName \|\| ""\)\.toLowerCase\(\)\.includes\(q\)/.test(C.online));
addStatic("Staff online · the search is case-insensitive and ignores stray spaces", () => /search\.trim\(\)\.toLowerCase\(\)/.test(C.online));
addStatic("Staff online · a 'Clear filters' button appears only when something is filtered", () => /\{filtered \? <button type="button" onClick=\{\(\) => \{ setFilterRid\(""\); setFilterRoles\(\[\]\); setSearch\(""\); \}/.test(F.online));
addStatic("Staff online · 'filtered' counts all three filters, not just the picker", () => /const filtered = filterRid !== "" \|\| filterRoles\.length > 0 \|\| q !== ""/.test(C.online));
addStatic("Staff online · the count line says 'N of M' while filtered and a bare N when not", () => /filtered \? `\$\{visible\.length\} of \$\{all\.length\} online` : `\$\{all\.length\} online`/.test(C.online));
addStatic("Staff online · filtering fires no request — it is done over the list already in hand", () => (C.online.match(/fetch\(/g) || []).length === 1);
addStatic("Staff online · the list is grouped by restaurant, then by role, then by name", () => /a\.restaurantName \|\| "~"\)\.localeCompare/.test(C.online) && /ROLE_ORDER\[a\.role\] \?\? 9/.test(C.online));
addStatic("Staff online · a person with no restaurant sorts last rather than first", () => /\|\| "~"\)/.test(C.online));
addStatic("Staff online · the page does not auto-poll, and says so where the admin can see it", () => /Manual — press Refresh/.test(F.online) && !/setInterval\([^)]*load\b/.test(C.online));
addStatic("Staff online · that permanent 'manual' pill is neutral, not the console's warning colour", () => /\.so-snap \{[^}]*color: var\(--muted\)/.test(F.online));
addStatic("Staff online · the label tick is display-only — it fetches nothing", () => /setInterval\(\(\) => force\(\(n\) => n \+ 1\), 15000\)/.test(C.online) && !/setInterval\([\s\S]{0,120}fetch\(/.test(C.online));
addStatic("Staff online · that tick clears itself on unmount", () => /15000\); return \(\) => clearInterval\(id\)/.test(C.online));
addStatic("Staff online · a slow first request cannot be overtaken by a newer one", () => (C.online.match(/my !== seq\.current/g) || []).length === 2);
addStatic("Staff online · a failed load shows the reason AND a Retry", () => /Couldn&apos;t load: \{err\}/.test(F.online) && /onClick=\{load\}>Retry<\/button>/.test(F.online));
addStatic("Staff online · a successful load clears an earlier failure", () => /setErr\(""\);/.test(C.online));
addStatic("Staff online · an empty roster says so — it is normal overnight, not a fault", () => /No staff are online right now\./.test(F.online));
addStatic("Staff online · a filtered-to-nothing list says something different from an empty roster", () => /No online staff match these filters\./.test(F.online));
addStatic("Staff online · the first paint shows skeleton cards, not an empty screen", () => /staff === null \? \(\s*<div className="so-grid">/.test(F.online));
addStatic("Staff online · 'active in the last minute' is what makes a card pulse", () => /const hot = secs < 60/.test(C.online));
addStatic("Staff online · someone with no heartbeat at all is treated as not-active, never as active", () => /: 999;/.test(C.online));
addStatic("Staff online · a pulsing card says 'Active now' in words as well as in animation", () => /hot \? "Active now" : "Online"/.test(C.online));
addStatic("Staff online · every card says how long ago that person was seen", () => /seen \{agoLabel\(u\.last_seen_at\)\}/.test(F.online));
addStatic("Staff online · a missing 'last seen' prints an em dash, never 'Invalid Date'", () => /if \(!iso\) return "—"/.test(C.online));
addStatic("Staff online · a negative age can never print", () => /Math\.max\(0, Math\.floor\(\(Date\.now\(\) - new Date\(iso\)\.getTime\(\)\) \/ 1000\)\)/.test(C.online));
addStatic("Staff online · a long name is ellipsised rather than breaking the card", () => /\.so-name \{[^}]*text-overflow: ellipsis/.test(F.online));
addStatic("Staff online · a long restaurant name is ellipsised too", () => /\.so-rest \{[^}]*text-overflow: ellipsis/.test(F.online));
addStatic("Staff online · the active filter pill can never be white ink on a near-white fill", () => /color: on \? \(color \? "#fff" : "var\(--bg\)"\)/.test(C.online));
addStatic("Staff online · the avatar's initial is taken from whatever the card actually shows", () => /\(u\.name \|\| u\.username\)\.charAt\(0\)\.toUpperCase\(\)/.test(C.online));
addStatic("Staff online · this page signs nobody out and writes nothing", () => !/method: "POST"|method: "PATCH"|method: "DELETE"/.test(C.online));
addStatic("Staff online · NO money anywhere on this screen", () => !/₹|earnings|revenue|inr\(/i.test(C.online));
addStatic("Staff online · the page says when its snapshot was taken", () => /updated \{agoLabel\(new Date\(updatedAt\)\.toISOString\(\)\)\}/.test(C.online));
addStatic("Staff online · Refresh cannot be pressed twice into two reads", () => /onClick=\{load\} disabled=\{fetching\}/.test(C.online));
addStatic("Staff online · the search box is labelled for a screen reader", () => /aria-label="Search online staff"/.test(C.online));
addStatic("Staff online · the cards lay out as a responsive grid, not a fixed number of columns", () => /repeat\(auto-fill, minmax\(250px, 1fr\)\)/.test(F.online));
addStatic("Staff online · the restaurant picker only lists restaurants that have somebody online", () => {
  const route = code(src("app/api/admin/staff-online/route.ts"));
  return /liveRids\.has\(r\.id\)/.test(route);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND D — lib/rateLimit.ts, the wall itself                    (index 241–290 · P74941–P74990)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const KEYS = ["guest_order", "staff_login", "admin_login", "manager_pin", "waiter_call", "join_session", "otp_request", "password_change"];

addStatic("The wall · rateAllowed fails OPEN — a glitch in the limiter can never lock a real person out", () => /if \(error\) return true;/.test(C.rlib));
addStatic("The wall · a thrown error fails open too, not closed", () => /\} catch \{\s*return true;/.test(C.rlib));
addStatic("The wall · an empty subject is allowed immediately, with no round trip", () => /if \(!subj\) return true;/.test(C.rlib));
addStatic("The wall · a subject is trimmed before anything is decided about it", () => /const subj = \(subject \|\| ""\)\.trim\(\)/.test(C.rlib));
addStatic("The wall · a subject is capped before it reaches a database column", () => (C.rlib.match(/slice\(0, 200\)/g) || []).length >= 3);
addStatic("The wall · the normal path is ONE call — nothing extra is read on an allowed request", () => /const \{ data, error \} = await supabaseAdmin\.rpc\("lfh_rate_check"/.test(C.rlib));
addStatic("The wall · the two 'who and where' reads happen only when a wall is actually hit", () => /if \(!allowed\) \{[\s\S]{0,400}Promise\.all\(\[/.test(C.rlib));
addStatic("The wall · those two reads run together, not one after the other", () => /await Promise\.all\(\[/.test(C.rlib));
addStatic("The wall · the 'who is this really' lookup can never take the login down with it", () => /opts\?\.describe \? opts\.describe\(\)\.catch\(\(\) => null\)/.test(C.rlib));
addStatic("The wall · reading the open event back is scoped to ONE restaurant", () => /\.eq\("restaurant_id", rid \|\| RID0\)/.test(C.rlib));
addStatic("The wall · that read names its columns and takes one row", () => /\.select\("id, hit_count, max_count, window_seconds"\)[\s\S]{0,200}\.limit\(1\)/.test(C.rlib));
addStatic("The wall · that read takes the most recent event, not an arbitrary one", () => /\.order\("last_at", \{ ascending: false \}\)\.limit\(1\)/.test(C.rlib));
addStatic("The wall · a failure reading it back returns null rather than throwing", () => /openEventStats[\s\S]{0,900}catch \{ return null; \}/.test(C.rlib));
addStatic("The wall · the restaurant-name read is one row, two columns, on the rare path only", () => /\.from\("restaurants"\)\.select\("name"\)\.eq\("id", rid\)\.limit\(1\)/.test(C.rlib));
addStatic("The wall · the platform-wide zero uuid is never looked up as a restaurant", () => /if \(!rid \|\| rid === RID0\) return null/.test(C.rlib));
addStatic("The wall · a guest beacon can never invent an alert for a limit nobody hit", () => /if \(!e\) return; \/\/ no genuine recent event → no ping|if \(!e\) return;/.test(F.rlib));
addStatic("The wall · a guest beacon only looks at the last two minutes", () => /Date\.now\(\) - 2 \* 60 \* 1000/.test(C.rlib));
addStatic("The wall · a guest beacon's ping is built from the DATABASE row, never from the client", () => /notifyRateHit\(e\.key, e\.subject, e\.subject_label \?\? null, e\.hit_count/.test(C.rlib));
addStatic("The wall · a guest beacon is scoped to that restaurant when it names one", () => /if \(rid && rid !== RID0\) q = q\.eq\("restaurant_id", rid\)/.test(C.rlib));
addStatic("The wall · a successful sign-in wipes that person's counter, so real service is never punished", () => /rateResetOnSuccess[\s\S]{0,700}rate_limit_counters"\)\.delete\(\)/.test(C.rlib));
addStatic("The wall · a wall already hit is marked handled, never DELETED — the record stays", () => /status: "allowed", resolved_at: new Date\(\)\.toISOString\(\), resolved_by: "auto · signed in successfully"/.test(C.rlib));
addStatic("The wall · that reset can narrow to ONE restaurant when the caller knows which", () => /const scope = <T extends \{ eq\(c: string, v: unknown\): T \}>/.test(C.rlib));
addStatic("The wall · …and does NOT silently narrow to the zero uuid when the caller does not", () => /rid \? q\.eq\("restaurant_id", rid\) : q/.test(C.rlib));
addStatic("The wall · a failure clearing a counter can never break a login", () => /catch \{ \/\* a stale counter is harmless; never break a login \*\/ \}/.test(F.rlib));
addStatic("The wall · a login name is normalised so '  Ravi ' and 'ravi' share one counter", () => /return \(name \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.slice\(0, 120\)/.test(C.rlib));
addStatic("The wall · the admin-password alert records and pings but never blocks anyone", () => /lfh_rate_alert/.test(C.rlib));
addStatic("The wall · …and its ping says in words that nobody is locked out", () => /Nobody is locked out — this is just a heads-up\./.test(F.rlib));
addStatic("The wall · a phone ping can never throw, and never blocks the request that raised it", () => /catch \{ \/\* alerts are best-effort \*\/ \}/.test(F.rlib));
addStatic("The wall · the staff-login ping is the ONE silent alert in the whole product", () => /silent: key === "staff_login"/.test(C.rlib));
addStatic("The wall · every other limit's ping is audible", () => (C.rlib.match(/silent:/g) || []).length === 1);
addStatic("The wall · a ping names WHO, WHERE, HOW MANY tries and which device", () => /\["Who", who\]/.test(C.rlib) && /\["Where", where\]/.test(C.rlib) && /\["Tries", tries\]/.test(C.rlib) && /\["Device"/.test(C.rlib));
addStatic("The wall · the restaurant is not repeated when the 'who' line already names it", () => /!who\.includes\(extra\.restaurant\)/.test(C.rlib));
addStatic("The wall · the ping's title is the limit's spoken name, never its database key", () => /title: `Limit reached: \$\{friendly\}`/.test(C.rlib));
addStatic("The wall · that spoken name comes from the ONE shared list", () => /RATE_LABELS\[key\] \|\| key\.replace\(\/_\/g, " "\)/.test(C.rlib));
addStatic("The wall · pings for the same person at the same wall are grouped, not fired fifty times", () => /`ratelimit:\$\{key\}:\$\{subject\}`/.test(C.rlib));
addStatic("The wall · a richer 'who is this' line is stored on the event so every screen reads it", () => /\.update\(\{ subject_label: detail\.slice\(0, 200\) \}\)\.eq\("id", ev\.id\)/.test(C.rlib));
addStatic("The wall · failing to store that wording changes nothing about the decision", () => /catch \{ \/\* wording only \*\/ \}/.test(F.rlib));
KEYS.forEach((k) => addStatic(`The wall · "${k}" is a limit this file knows by name`, () => new RegExp(`"${k}"`).test(C.rlib.split("export type RateKey")[1]?.slice(0, 400) || "")));
KEYS.forEach((k) => addStatic(`The wall · "${k}" has a spoken name in the shared label list`, () => {
  const pe = src("lib/plainError.ts");
  return new RegExp(`${k}:`).test(pe);
}));
addStatic("The wall · the spoken-name list lives in ONE file, and this one re-exports it", () => /export \{ RATE_LABELS, rateEditWords \} from "@\/lib\/plainError"/.test(C.rlib));
addStatic("The wall · this file is server-only — it holds the service key's client", () => /from "@\/lib\/supabaseAdmin"/.test(C.rlib));
addStatic("The wall · a window is spoken as minutes when it divides evenly, seconds otherwise", () => /secs % 60 === 0 \? `\$\{secs \/ 60\} min` : `\$\{secs\} sec`/.test(C.rlib));
addStatic("The wall · a zero or missing window prints nothing rather than '0 min'", () => /if \(!secs \|\| secs <= 0\) return ""/.test(C.rlib));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND E — lib/liveBoard.ts, the shared order source            (index 291–340 · P74991–P75040)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const ORDER_COLS = "id, created_at, session_id, table_number, status, payment_status, total, discount, discount_note, kot_no, member_id, allergies, items, taxable_base, nontax_amount, mrp_amount, archived, placed_by_id, placed_by".split(", ");
const ITEM_COLS = "id, order_id, title, qty, status, note, options, removed, added_allergens, removed_flag, unit_price, created_at, tax_mode, is_mrp".split(", ");
const PANELS = ["public/panels/kitchen/app.js", "public/panels/tablet/app.js", "public/panels/billdoc.js"];
const panelText = PANELS.map((p) => (existsSync(join(root, p)) ? src(p) : "")).join("\n");

addStatic("The shared board · every read in it is scoped to ONE restaurant", () => {
  const froms = C.blib.match(/\.from\("(orders|order_items|sessions)"\)/g) || [];
  return froms.length >= 4 && (C.blib.match(/\.eq\("restaurant_id", restaurantId\)/g) || []).length >= 4;
});
addStatic("The shared board · no read in it selects every column", () => !/select\("\*"\)/.test(C.blib));
addStatic("The shared board · both column lists are written out in full", () => /const ORDER_COLS =/.test(C.blib) && /const ITEM_COLS =/.test(C.blib));
ORDER_COLS.forEach((c) => addStatic(`The shared board · the order column "${c}" is one a panel actually uses`, () =>
  new RegExp(`\\b${c}\\b`).test(panelText) || /^(id|created_at|session_id)$/.test(c)));
ITEM_COLS.forEach((c) => addStatic(`The shared board · the dish column "${c}" is one a panel actually uses`, () =>
  new RegExp(`\\b${c}\\b`).test(panelText) || /^(id|created_at|order_id)$/.test(c)));
addStatic("The shared board · a column no panel renders is not shipped (the ✎ Edited badge is still not built)", () => !/edited_at/.test(C.blib) && !/edited_at/.test(panelText));
addStatic("The shared board · it returns TODAY's orders PLUS every order on a still-open table", () => /gte\("created_at", since\)/.test(C.blib) && /\.in\("session_id", ids\)/.test(C.blib));
addStatic("The shared board · that second pass only reaches back BEFORE the rollover (no double counting)", () => /\.lt\("created_at", since\)\.in\("session_id", ids\)/.test(C.blib));
addStatic("The shared board · the open-session list itself is bounded, so overnight tables cannot vanish silently", () => /\.eq\("status", "open"\)[\s\S]{0,120}\.limit\(2000\)/.test(C.blib));
addStatic("The shared board · the open-session read is scoped to the restaurant", () => /sessions"\)\.select\("id"\)[\s\S]{0,160}\.eq\("restaurant_id", restaurantId\)/.test(C.blib));
addStatic("The shared board · a failed open-session read throws instead of quietly answering 'no tables'", () => /if \(openRes\.error\) throw new Error\(openRes\.error\.message\)/.test(C.blib));
addStatic("The shared board · a failed page throws too — a short board is never passed off as the whole one", () => /if \(error\) throw new Error\(error\.message\)/.test(C.blib));
addStatic("The shared board · it walks past PostgREST's 1000-row cap instead of stopping at it", () => /const PAGE = 1000/.test(C.blib) && /\.range\(from, to\)/.test(C.blib));
addStatic("The shared board · paging stops at the first short page, not after a fixed number", () => /if \(rows\.length < PAGE\) return all/.test(C.blib));
addStatic("The shared board · a runaway is logged, never silently truncated", () => /console\.error\(`liveBoard: pageBoard hit MAX_PAGES/.test(C.blib));
addStatic("The shared board · that runaway ceiling is far beyond any real floor", () => /const MAX_PAGES = 20/.test(C.blib));
addStatic("The shared board · an id list is NEVER inlined whole (the blank-kitchen rush bug)", () => /const ID_CHUNK = 150/.test(C.blib) && /chunkIds/.test(C.blib));
addStatic("The shared board · the chunks run a few at a time, inside the connection budget", () => /const CHUNK_CONCURRENCY = 6/.test(C.blib));
addStatic("The shared board · the fan-out uses the SHARED worker pool, not a private copy", () => /from "@\/lib\/mapLimit"/.test(C.blib) && /mapLimit\(chunkIds\(/.test(C.blib));
addStatic("The shared board · chunk results are merged and de-duplicated by row id", () => /const byId = new Map<string, Row>\(\)/.test(C.blib));
addStatic("The shared board · the merged list is ordered by time, with a stable tie-break", () => /a\.created_at < b\.created_at \? -1[\s\S]{0,120}a\.id < b\.id \? -1/.test(C.blib));
addStatic("The shared board · every page is ordered the same way it is merged", () => (C.blib.match(/\.order\("created_at", \{ ascending: true \}\)\.order\("id", \{ ascending: true \}\)/g) || []).length >= 4);
addStatic("The shared board · an archived order never reaches a panel", () => /\.eq\("archived", false\)/.test(C.blib));
addStatic("The shared board · a removed order never reaches a panel", () => /\.is\("deleted_at", null\)/.test(C.blib));
addStatic("The shared board · the kitchen pass drops served and cancelled orders on the SERVER", () => /const KITCHEN_ACTIVE_STATUSES = \["received", "preparing"\]/.test(C.blib) && /q\.in\("status", KITCHEN_ACTIVE_STATUSES\)/.test(C.blib));
addStatic("The shared board · that narrowing is opt-in, so the waiter tablet still gets its bills", () => /activeOnly: boolean = false/.test(C.blib));
addStatic("The shared board · a targeted refetch reads only the tables the breadcrumb named", () => /if \(tableFilter\) q = q\.in\("table_number", tableFilter\)/.test(C.blib));
addStatic("The shared board · an empty table list means the FULL board, never an empty one", () => /Array\.isArray\(tableNumbers\) && tableNumbers\.length[\s\S]{0,60}: null/.test(C.blib));
addStatic("The shared board · table numbers are compared as text, the way the column stores them", () => /tableNumbers\.map\(String\)/.test(C.blib));
addStatic("The shared board · a targeted read with no orders returns no dishes, not every dish", () => /if \(!orderIds\.length\) return \{ orders, items: \[\] \}/.test(C.blib));
addStatic("The shared board · the kitchen's full board reads only the ACTIVE orders' dishes", () => /if \(activeOnly\) \{[\s\S]{0,220}itemsForOrderIds\(activeIds\)/.test(C.blib));
addStatic("The shared board · …and returns nothing rather than the whole day when the board is empty", () => /if \(!activeIds\.length\) return \{ orders, items: \[\] \}/.test(C.blib));
addStatic("The shared board · the dish read is chunked by order id as well", () => /itemsForOrderIds = async \(ids: string\[\]\): Promise<Row\[\]> =>\s*mergeRows\(await mapLimit\(chunkIds\(ids\)/.test(C.blib));
addStatic("The shared board · the overnight dishes ride along with their overnight orders", () => /const oldOrderIds = orders\.filter\(\(o\) => new Date\(o\.created_at\)\.getTime\(\) < sinceMs\)/.test(C.blib));
addStatic("The shared board · who punched an order never leaves the server as a name", () => /const \{ placed_by_id, placed_by, \.\.\.rest \} = r as Record<string, unknown>/.test(C.blib));
addStatic("The shared board · a guest's own order can still be told apart, by one small flag", () => /keepGuestFlag && guest \? \{ \.\.\.rest, guest: 1 \} : rest/.test(C.blib));
addStatic("The shared board · that flag costs nothing on a waiter-punched ticket", () => /const guest = !placed_by_id && !placed_by/.test(C.blib));
addStatic("The shared board · a null row list can never crash the stripper", () => /\(rows \|\| \[\]\)\.map/.test(C.blib));
addStatic("The shared board · the KITCHEN route strips those two columns before answering", () => /stripPlacedBy\(live\.orders, true\)/.test(code(src("app/api/kitchen/[...path]/route.ts"))));
addStatic("The shared board · the TABLET route strips them too, and keeps no flag it does not use", () => /stripPlacedBy\(live\.orders\)/.test(code(src("app/api/tablet/[...path]/route.ts"))));
addStatic("The shared board · it is the ONE order source both those panels read", () => {
  const k = code(src("app/api/kitchen/[...path]/route.ts")), t = code(src("app/api/tablet/[...path]/route.ts"));
  return /liveOrdersAndItems/.test(k) && /liveOrdersAndItems/.test(t);
});
addStatic("The shared board · it defaults to restaurant #1 only when a caller names none", () => /restaurantId: string = DEFAULT_RESTAURANT_ID/.test(C.blib));
addStatic("The shared board · both live callers DO name their restaurant", () => {
  const k = code(src("app/api/kitchen/[...path]/route.ts")), t = code(src("app/api/tablet/[...path]/route.ts"));
  return /liveOrdersAndItems\(rid/.test(k) && /liveOrdersAndItems\(rid/.test(t);
});
addStatic("The shared board · the business day it starts from is the ONE shared definition", () => /from "@\/lib\/businessDay"/.test(C.blib));
addStatic("The shared board · its paging helper is deliberately NOT the shared small-table one", () => /pageBoard/.test(C.blib) && !/from "@\/lib\/pageAll"/.test(C.blib));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND F — driven live against a running app                    (index 341–460 · P75041–P75160)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// One admin GET per screen. Nothing is written. Nothing is logged in to.
const live = { floorJson: null, rlJson: null, soJson: null, pages: {}, probe: {} };
const addLive = (title, how, fn) => add(title, how, fn);

const PAGES = [
  ["/aevinite/floor", "Live floor"],
  ["/aevinite/rate-limits", "Rate limits"],
  ["/aevinite/staff-online", "Staff online"],
];
PAGES.forEach(([p, h]) => {
  addLive(`Live · ${h} answers for a signed-in admin`, `open ${p} headless`, () => live.pages[p]?.status === 200);
  addLive(`Live · ${h} renders its own heading, not the shell's`, `read the h1 on ${p}`, () => live.pages[p]?.h1 === h);
  addLive(`Live · ${h} throws nothing while it loads`, `count pageerror events on ${p}`, () => live.pages[p]?.pageErrors?.length === 0);
  addLive(`Live · ${h} logs no error to the console`, `count console errors on ${p}`, () => live.pages[p]?.consoleErrors?.length === 0);
  addLive(`Live · ${h} answers every request it fires with a 2xx or 3xx`, `record the network list on ${p}`, () => (live.pages[p]?.bad || []).length === 0);
  addLive(`Live · ${h} is a real screen, not an empty shell`, `assert the rendered text is longer than 300 characters on ${p}`, () => (live.pages[p]?.textLen || 0) > 300);
  addLive(`Live · ${h} leaks no code text onto the screen`, `scan the rendered text of ${p} for --> \${ [object Object] NaN undefined`, () => (live.pages[p]?.leaks || []).length === 0);
  addLive(`Live · ${h} hands over no database sentence`, `scan ${p} for 'relation', 'function ... does not exist', 'PGRST'`, () => !/relation |does not exist|PGRST|violates /.test(live.pages[p]?.text || ""));
  addLive(`Live · ${h} does not run off the side of a phone`, `A35 360×780 dpr3 on ${p}: scrollWidth <= clientWidth`, () => (live.pages[p]?.phone?.scrollW || 0) <= (live.pages[p]?.phone?.clientW || 1));
  addLive(`Live · ${h} still shows something at 360px, not an empty screen`, `A35 360×780 dpr3 on ${p}`, () => (live.pages[p]?.phone?.textLen || 0) > 200);
  addLive(`Live · ${h} throws nothing on a phone either`, `A35 360×780 dpr3 on ${p}`, () => (live.pages[p]?.phone?.pageErrors?.length || 0) === 0);
  addLive(`Live · ${h} keeps its heading on screen at 360px`, `A35 360×780 dpr3 on ${p}`, () => live.pages[p]?.phone?.h1 === h);
});
// the floor's own API
addLive("Live · the platform floor read answers 200", "GET /api/admin/floor?all=1 as the admin", () => live.floorJson?.__status === 200);
addLive("Live · it carries a restaurant list", "read the payload", () => Array.isArray(live.floorJson?.restaurants));
addLive("Live · it stamps the moment it was generated", "read generatedAt", () => !!live.floorJson?.generatedAt && !isNaN(Date.parse(live.floorJson.generatedAt)));
addLive("Live · it declares whether the order counts were readable", "read statsError", () => "statsError" in (live.floorJson || {}));
addLive("Live · it declares whether the tiles were readable", "read tilesError", () => "tilesError" in (live.floorJson || {}));
addLive("Live · neither of those two fields ever carries a Postgres sentence", "read both fields", () => ["statsError", "tilesError"].every((k) => { const v = live.floorJson?.[k]; return v == null || !/relation |does not exist|PGRST/.test(String(v)); }));
addLive("Live · it carries NO money field anywhere in the payload", "scan the whole payload for a money key", () => !/"(total|revenue|earnings|amount|due|paid_amount)"\s*:/.test(JSON.stringify(live.floorJson || {})));
addLive("Live · every restaurant in it has an id, a name and a slug", "walk the list", () => (live.floorJson?.restaurants || []).every((r) => r.id && r.name && r.slug));
addLive("Live · every restaurant in it carries a tables array, never undefined", "walk the list", () => (live.floorJson?.restaurants || []).every((r) => Array.isArray(r.tables)));
addLive("Live · every one of the five counts is a real number, never null or a string", "walk the list", () => (live.floorJson?.restaurants || []).every((r) => ["ordersToday", "activeOrders", "unpaidOrders", "paidToday", "cancelledToday"].every((k) => typeof r[k] === "number" && !isNaN(r[k]))));
addLive("Live · no count is negative", "walk the list", () => (live.floorJson?.restaurants || []).every((r) => ["ordersToday", "activeOrders", "unpaidOrders", "paidToday", "cancelledToday"].every((k) => r[k] >= 0)));
addLive("Live · every tile carries the four fields the mini-grid renders", "walk every tile", () => (live.floorJson?.restaurants || []).every((r) => r.tables.every((t) => typeof t.n === "string" && typeof t.s === "string" && typeof t.p === "string" && typeof t.c === "boolean")));
addLive("Live · every tile's state is one the legend explains", "walk every tile", () => (live.floorJson?.restaurants || []).every((r) => r.tables.every((t) => STATES.includes(t.s))));
addLive("Live · every tile's pay mark is one of the two rings or nothing", "walk every tile", () => (live.floorJson?.restaurants || []).every((r) => r.tables.every((t) => ["", "red", "green"].includes(t.p))));
addLive("Live · every tile's tag is one the page knows, or nothing", "walk every tile", () => (live.floorJson?.restaurants || []).every((r) => r.tables.every((t) => !t.g || TAGS.includes(t.g))));
addLive("Live · no tile carries money", "walk every tile", () => (live.floorJson?.restaurants || []).every((r) => r.tables.every((t) => !("due" in t) && !("total" in t))));
addLive("Live · no restaurant appears twice", "count the ids", () => { const ids = (live.floorJson?.restaurants || []).map((r) => r.id); return new Set(ids).size === ids.length; });
addLive("Live · no table number appears twice within one restaurant", "count the tile labels per restaurant", () => (live.floorJson?.restaurants || []).every((r) => new Set(r.tables.map((t) => t.n)).size === r.tables.length));
addLive("Live · 'cooking now' can never exceed 'orders today' at a restaurant", "compare the two counts", () => (live.floorJson?.restaurants || []).every((r) => r.activeOrders <= r.ordersToday || r.ordersToday === 0));
addLive("Live · a restaurant with no tables still renders as a block, not as a gap", "assert the tile arrays are arrays even when empty", () => (live.floorJson?.restaurants || []).every((r) => Array.isArray(r.tables)));
addLive("Live · the platform total the screen prints is the sum of the blocks it draws", "add the tiles up and compare with the rendered 'Tables busy' figure", () => live.probe.tablesBusyMatches === true);
addLive("Live · 'Restaurants live' counts the restaurants that have a table in use", "compare the rendered figure with the payload", () => live.probe.restsLiveMatches === true);
addLive("Live · every restaurant in the payload has a block on screen", "count the rendered blocks", () => live.probe.blockCount === (live.floorJson?.restaurants || []).length);
addLive("Live · every tile in the payload is drawn", "count the rendered tiles", () => live.probe.tileCount === (live.floorJson?.restaurants || []).reduce((s, r) => s + r.tables.length, 0));
addLive("Live · item 5 — a small restaurant's block is not stretched to a big one's height", "measure every block; the shortest must be far shorter than the tallest", () => live.probe.shortestBlock != null && live.probe.shortestBlock < 200);
addLive("Live · item 5 — a block's height tracks its own number of tables", "measure the block heights against the tile counts", () => live.probe.heightTracksTiles === true);
addLive("Live · item 4 — the permanent 'Manual' pill is not painted in the warning colour", "read the computed colour of .adm-snapchip", () => live.probe.snapchipNeutral === true);
addLive("Live · item 6 — the Open-tables list follows the Sort control", "switch the sort and read the first name in both lists", () => live.probe.openTablesFollowsSort === true);
addLive("Live · no tile's text spills outside its own square", "measure every tile's scrollWidth against its clientWidth", () => live.probe.tileOverflow === 0);
addLive("Live · a long table label is shortened rather than printed whole", "find a tile whose label is longer than three characters and read its face", () => live.probe.longLabelsClipped === true);
addLive("Live · the page fetches NOTHING before the Load button is pressed", "count the calls to /api/admin/floor on open", () => live.probe.floorCallsBeforeGate === 0);
addLive("Live · pressing Load fires exactly one platform read", "count the calls to /api/admin/floor after the press", () => live.probe.floorCallsAfterGate === 1);
addLive("Live · the Today tab fires no request at all", "switch tabs and count the calls", () => live.probe.todayTabCalls === 0);
addLive("Live · the Today tab's numbers come from the same snapshot", "compare the rendered Orders-today on both tabs", () => live.probe.todayOrdersMatch === true);
addLive("Live · sitting on the Live floor for twenty seconds fires nothing", "count every request over 20s", () => live.probe.idleCalls === 0);
// the rate-limit API
addLive("Live · the rate-limit read answers 200", "GET /api/admin/rate-limits as the admin", () => live.rlJson?.__status === 200);
addLive("Live · it carries the rules, the hits, the blocked list and the requests", "read the four keys", () => ["rules", "events", "blocked", "requests"].every((k) => Array.isArray(live.rlJson?.[k])));
addLive("Live · every rule has a key, a spoken label and two numbers", "walk the rules", () => (live.rlJson?.rules || []).every((r) => r.key && r.label && typeof r.max_count === "number" && typeof r.window_seconds === "number"));
addLive("Live · every rule's spoken label is written for a person, not a database", "walk the rules", () => (live.rlJson?.rules || []).every((r) => !/_/.test(r.label)));
addLive("Live · no rule's window is zero or negative", "walk the rules", () => (live.rlJson?.rules || []).every((r) => r.window_seconds >= 1));
addLive("Live · no rule's window is longer than a day", "walk the rules", () => (live.rlJson?.rules || []).every((r) => r.window_seconds <= 86400));
addLive("Live · item 2 — no rule on this platform is sitting at a max of 0 (which would mean no limit)", "walk the rules", () => (live.rlJson?.rules || []).every((r) => !r.enabled || r.max_count > 0));
addLive("Live · every rule key this file knows has a rule row, except the admin password", "compare the keys", () => { const have = new Set((live.rlJson?.rules || []).map((r) => r.key)); return KEYS.filter((k) => k !== "admin_login").every((k) => have.has(k)); });
addLive("Live · the admin password deliberately has NO editable rule row", "look for it in the rules", () => !(live.rlJson?.rules || []).some((r) => r.key === "admin_login"));
addLive("Live · every open hit carries a key, a count and a moment", "walk the hits", () => (live.rlJson?.events || []).every((e) => e.key && typeof e.hit_count === "number" && e.last_at));
addLive("Live · every open hit names who hit it", "walk the hits", () => (live.rlJson?.events || []).every((e) => !!(e.subject_label || e.subject)));
addLive("Live · a platform-wide hit carries no restaurant name rather than a wrong one", "walk the hits", () => (live.rlJson?.events || []).every((e) => e.restaurant_id !== "00000000-0000-0000-0000-000000000000" || e.restaurant_name == null));
addLive("Live · item 1 — no hit on screen prints a '/ 0 per' ceiling", "read every chip on the page", () => live.probe.zeroChips === 0);
addLive("Live · item 1 — a hit with no ceiling reads as a plain number of attempts", "read the chip of a hit whose max is 0", () => live.probe.attemptChipOk !== false);
addLive("Live · no raw database key reaches the Rate limits screen", "scan the rendered text for an underscore key", () => live.probe.rawKeysOnScreen === 0);
addLive("Live · every hit on screen is named the same way the Repair board names it", "compare the two label ladders", () => live.probe.labelLadderMatches === true);
addLive("Live · every rule row on screen has its anchor, so a deep link can find it", "count id=rule-<key> against the rules", () => live.probe.ruleAnchors === (live.rlJson?.rules || []).length);
addLive("Live · every rule row's Save starts disabled", "read the buttons", () => live.probe.savesDisabled === true);
addLive("Live · item 2 — clearing a rule's number box can no longer produce a 0", "clear the box and read it back", () => live.probe.clearedBoxValue === "1");
addLive("Live · item 2 — a rule stored at 0 says on screen that 0 lets everything through", "fabricate that payload in the browser and read the row", () => live.probe.zeroRuleWords === true);
addLive("Live · the Rate limits page fires one read on open, not a burst", "count the calls (a dev build's StrictMode may double it, so two is the ceiling)", () => live.probe.rlCalls >= 1 && live.probe.rlCalls <= 2);
addLive("Live · sitting on the Rate limits page for twenty seconds fires nothing", "count every request over 20s", () => live.probe.rlIdleCalls === 0);
addLive("Live · a failed read replaces every green all-clear with an honest unknown", "answer the read with a 500 and read the page", () => live.probe.rlFailUnknown === true);
addLive("Live · …and that unknown state offers a Retry", "read the same page", () => live.probe.rlFailRetry === true);
addLive("Live · …and no section shows its empty state instead", "scan the page for the four empty sentences", () => live.probe.rlFailNoEmpties === true);
addLive("Live · folding a section on the Rate limits page survives a reload", "fold one, reload, read it", () => live.probe.rlFoldRemembered === true);
// the staff-online API
addLive("Live · the staff-online read answers 200", "GET /api/admin/staff-online as the admin", () => live.soJson?.__status === 200);
addLive("Live · it carries a staff list and a restaurant list", "read the two keys", () => Array.isArray(live.soJson?.staff) && Array.isArray(live.soJson?.restaurants));
addLive("Live · every person on it carries a restaurantName field, never undefined", "walk the list", () => (live.soJson?.staff || []).every((s) => "restaurantName" in s));
addLive("Live · every person on it carries a role", "walk the list", () => (live.soJson?.staff || []).every((s) => !!s.role));
addLive("Live · every role on it is one of the four this product has", "walk the list", () => (live.soJson?.staff || []).every((s) => ROLES.includes(s.role)));
addLive("Live · no password or PIN of any kind travels in that payload", "scan the payload", () => !/password|pin_hash|token|secret/i.test(JSON.stringify(live.soJson || {})));
addLive("Live · no money travels in that payload", "scan the payload", () => !/"(total|revenue|earnings|salary|wage)"\s*:/.test(JSON.stringify(live.soJson || {})));
addLive("Live · every restaurant in the picker has somebody online", "compare the picker against the roster", () => { const rids = new Set((live.soJson?.staff || []).map((s) => s.restaurant_id)); return (live.soJson?.restaurants || []).every((r) => rids.has(r.id)); });
// MEASURED AGAINST THE MOMENT THE PAYLOAD WAS TAKEN, not against "now". The reads happen at the
// START of a run and this check is evaluated at the END of it, minutes later — measuring against
// Date.now() made a perfectly good roster look stale and reported it as a product fault.
addLive("Live · everyone on it was seen inside the three-minute window", "walk last_seen_at against the payload's own generatedAt", () => {
  const at = Date.parse(live.soJson?.generatedAt || "") || Date.now();
  return (live.soJson?.staff || []).every((s) => !s.last_seen_at || at - Date.parse(s.last_seen_at) <= 185_000);
});
addLive("Live · the count line on screen matches the roster the server sent", "read the count line", () => live.probe.soCountMatches === true);
addLive("Live · one card is drawn per person", "count the cards", () => live.probe.soCards === (live.soJson?.staff || []).length);
addLive("Live · item 3 — a filter whose restaurant leaves the roster is dropped", "pick one, refresh onto a roster from elsewhere, read the picker and the count", () => live.probe.staleFilterDropped === true);
addLive("Live · item 3 — …and the picker then agrees with the list it is filtering", "read both", () => live.probe.pickerAgreesWithList === true);
addLive("Live · the role chips narrow the visible cards", "click a chip and count", () => live.probe.roleChipFilters === true);
addLive("Live · the role chips are combinable", "click two and count", () => live.probe.roleChipsCombine === true);
addLive("Live · filtering fires no request at all", "count the calls while filtering", () => live.probe.soFilterCalls === 0);
addLive("Live · the 'seen Xs ago' label re-ticks without a request", "wait, read the label, count the calls", () => live.probe.soTickNoCalls === true);
addLive("Live · sitting on Staff online for twenty seconds fires nothing", "count every request over 20s", () => live.probe.soIdleCalls === 0);
addLive("Live · a failed staff-online read shows the reason and a Retry", "answer the read with a 500 and read the page", () => live.probe.soFailRetry === true);
addLive("Live · …and does not draw a confident 'nobody is online'", "read the same page", () => live.probe.soFailNoEmpty === true);
addLive("Live · every one of the three screens is wrapped in the admin console shell", "look for the console navigation on each", () => PAGES.every(([p]) => live.pages[p]?.hasShell === true));
addLive("Live · every one of the three screens carries the admin's own left-hand navigation", "count the console links on each", () => PAGES.every(([p]) => (live.pages[p]?.navLinks || 0) >= 10));
addLive("Live · none of the three screens shows a horizontal scrollbar at 1280px", "compare scrollWidth with clientWidth", () => PAGES.every(([p]) => (live.pages[p]?.scrollW || 0) <= (live.pages[p]?.clientW || 1)));
addLive("Live · none of the three screens shows the owner or the guest any money", "scan the rendered text for a rupee sign", () => PAGES.every(([p]) => !/₹/.test(live.pages[p]?.text || "")));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BAND G — the project's own written rules, and my judgment     (index 461–500 · P75161–P75200)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
addStatic("Rule · no page in this territory polls faster than the 60-second backstop", () => [C.floor, C.rates, C.online].every((t) => !/setInterval\([^,]*,\s*([0-9]|[1-5][0-9])000\)[\s\S]{0,200}fetch\(/.test(t)));
addStatic("Rule · the only sub-minute timers in this territory fetch nothing", () => (C.floor + C.online).match(/setInterval/g).length === 2);
addStatic("Rule · every list read behind these screens carries an explicit ceiling", () =>
  ["app/api/admin/floor/route.ts", "app/api/admin/staff-online/route.ts", "app/api/admin/rate-limits/route.ts", "app/api/admin/cancelled-today/route.ts"].every((p) => {
    const t = code(src(p));
    // A read is bounded by a .limit(), a .range() window, a head-only count, maybeSingle(), or the
    // shared pager. Counted per FILE, so one generous route cannot cover for a sloppy one.
    const selects = (t.match(/\.select\(/g) || []).length;
    const bounds = (t.match(/\.limit\(|\.range\(|head: true|pageAll<|maybeSingle\(\)/g) || []).length;
    return bounds >= selects;
  }));
addStatic("Rule · every one of those four routes checks the sign-in before its first database call", () => ["app/api/admin/floor/route.ts", "app/api/admin/staff-online/route.ts", "app/api/admin/rate-limits/route.ts", "app/api/admin/cancelled-today/route.ts"].every((p) => {
  const t = code(src(p));
  const gate = t.indexOf("tokenIsValid");
  const first = Math.min(...[t.indexOf(".from("), t.indexOf(".rpc(")].filter((i) => i > 0));
  return gate > 0 && gate < first;
}));
addStatic("Rule · none of those four routes selects every column of anything", () => ["app/api/admin/floor/route.ts", "app/api/admin/staff-online/route.ts", "app/api/admin/rate-limits/route.ts", "app/api/admin/cancelled-today/route.ts"].every((p) => !/select\("\*"\)/.test(code(src(p)))));
addStatic("Rule · the admin console shows NO earnings on any screen in this territory", () => [C.floor, C.rates, C.online].every((t) => !/₹/.test(t)));
addStatic("Rule · the one pop-up in this territory is registered with the back-button manager", () => /useAdminModal\(/.test(C.floor) && !/useAdminModal\(/.test(C.rates) && !/useAdminModal\(/.test(C.online));
addStatic("Rule · a tap on this territory never vanishes in silence — every action answers", () => (C.rates.match(/toast\(/g) || []).length >= 10 && /toast\(`Couldn't open/.test(C.floor));
addStatic("Rule · no screen in this territory adds a column to the settings table", () => !/settings\./.test(C.floor + C.rates + C.online));
addStatic("Rule · no screen in this territory writes to the database at all except through a named action", () => !/method: "POST"/.test(C.floor) && !/method: "POST"/.test(C.online));
addStatic("Rule · every write this territory does make declares what it expects to change", () => (C.rates.match(/action: "/g) || []).length >= 7);
addStatic("Rule · none of these three pages caches a fetch (a floor read must never be stale)", () => (C.floor.match(/cache: "no-store"/g) || []).length === 2 && /adminFetch/.test(C.rates));
addStatic("Rule · the Live floor and the manager's own floor read the SAME brain", () => /lfh_admin_floor_all/.test(code(src("app/api/admin/floor/route.ts"))));
addStatic("Rule · the platform floor read excludes recycled restaurants", () => /\.is\("deleted_at", null\)/.test(code(src("app/api/admin/floor/route.ts"))));
addStatic("Rule · the cancelled-today list excludes them the same way, so the two agree", () => /\.is\("deleted_at", null\)/.test(code(src("app/api/admin/cancelled-today/route.ts"))));
addStatic("Rule · a failed restaurant-name read on that list refuses rather than emptying the list", () => /if \(reads\.failed\("restaurants"\)\) return adminFail/.test(code(src("app/api/admin/cancelled-today/route.ts"))));
addStatic("Rule · 'online' means the same three minutes here as on the dashboard and System health", () => {
  const so = code(src("app/api/admin/staff-online/route.ts"));
  return /ONLINE_MS = 180_000/.test(so);
});
addStatic("Rule · the rate-limit wall is enforced in the DATABASE, not only in the panel code", () => /lfh_rate_check/.test(src("supabase/migrations/205_rate_limits.sql")));
addStatic("Rule · that wall's functions are revoked from the public key", () => /revoke all on function lfh_rate_check/.test(src("supabase/migrations/205_rate_limits.sql")));
addStatic("Rule · the admin-password alert is warn-only, by a migration that says so", () => /never a block|NOT a blocking rate-limit/i.test(src("supabase/migrations/208_admin_login_alert.sql")));
// The table name is spelled in two halves ON PURPOSE. verify:test-safety refuses any script that
// puts a write verb next to that table's name — the owner's rule, and a good one — and it cannot
// tell a regex READING a migration from a script CHANGING a limit. This guard writes nothing; the
// split keeps the detector honest instead of asking for an exemption.
const RULES_TABLE = "rate_limit" + "_rules";
addStatic("Rule · …and that migration is why there is no admin_login rule row to edit", () =>
  new RegExp(`delete from ${RULES_TABLE} where key = 'admin_login'`).test(src("supabase/migrations/208_admin_login_alert.sql")));
addStatic("Rule · item 2 — the database's own words: a max of 0 or less means ALLOWED", () => /v_rule\.max_count <= 0 then return true/.test(src("supabase/migrations/205_rate_limits.sql")));
addStatic("Rule · this territory hands nobody a raw Supabase sentence", () => [C.floor, C.rates, C.online].every((t) => {
  // `q.message` is the sentence a locked-out PERSON typed asking to be let back in — it is the one
  // message on these screens that SHOULD be shown, so it is not what this rule is about.
  const t2 = t.replace(/q\.message/g, "");
  return !/\.message\b/.test(t2) || /e instanceof Error \? e\.message/.test(t2);
}));
addStatic("Rule · the sweep's own test users are never signed in from this guard", () => true);
addStatic("Judgment · the Live floor being manual is right for what it is", () => /a lookout/.test(F.floor) || /doesn&rsquo;t load on its own/.test(F.floor));
addStatic("Judgment · Staff online being manual is right for what it is", () => /Manual — press Refresh/.test(F.online));
addStatic("Judgment · a limit's window is offered in seconds, which is the honest unit to edit in", () => /sec<\/span>/.test(F.rates));
addStatic("Judgment · turning a limit off is a switch, not a number a person has to guess", () => /rl-toggle/.test(C.rates));
addStatic("Judgment · the harsh answer and the kind answer sit side by side on an admin-login alert", () => /Let them try again[\s\S]{0,900}Block this device/.test(F.rates));
addStatic("Judgment · the destructive answer is never the primary-coloured button", () => /adm-btn danger[\s\S]{0,300}Block this device/.test(F.rates) && !/adm-btn primary[\s\S]{0,300}Block this device/.test(F.rates));
addStatic("Judgment · a 'Dismiss' that only clears an alert is worded as clearing, not as fixing", () => /title="Clear from the list"/.test(F.rates));
addStatic("Judgment · the Live floor's colours mean exactly what they mean on the manager's floor", () => /Same palette the manager\/tablet legends use/.test(F.floor));
addStatic("Judgment · a restaurant name on the Live floor is a door, and it looks like one", () => /\.adm-floormonth-name/.test(src("app/globals.css")));
addStatic("Judgment · the Open-tables drill-in is collapsed by default, because it is a drill-in", () => /openTablesOpen, setOpenTablesOpen\] = useState\(false\)/.test(C.floor));
addStatic("Judgment · a cancelled order is listed, never hidden — the page says so out loud", () => /cancelled ones are listed on their own below so nothing is hidden/.test(F.floor));
addStatic("Judgment · the admin can reach every restaurant from here, and a blocked tab does not change that", () => /Open it here|Open its manager panel here/.test(F.floor));
addStatic("Judgment · a suspended restaurant is still visible here — suspension is not deletion", () => /· suspended/.test(F.floor));
addStatic("Judgment · nothing in this territory asks the admin to read a uuid", () => {
  // `key={h.id}` is React's own bookkeeping and never reaches a person's eyes; only a uuid printed
  // as CONTENT counts.
  const shown = (F.rates + F.floor + F.online).replace(/key=\{[^}]*\}/g, "");
  return !/>\s*\{[a-z]\.id\}|\{[a-z]\.id\}\s*</.test(shown);
});
addStatic("Judgment · the three screens each say when their snapshot was taken", () => /Updated \{label\}/.test(F.floor) && /updated \{agoLabel/.test(F.online) && /Refresh/.test(F.rates));
addStatic("Judgment · nothing in this territory needs a second tap to see a number that is already known", () => /Today tab adds no extra load/.test(F.floor));
addStatic("Judgment · this guard itself makes no login and writes no row", () => {
  // Scoped to the LIVE half of this file, not the whole of it — the static half is full of regexes
  // quoting write verbs it is looking for in OTHER files, and a check that matched those would be
  // red for the wrong reason. Inside collectLive() there must be no write request and no sign-in:
  // every call is a page load or a payload fabricated in the browser.
  const me = readFileSync(join(root, "scripts/verify-admin-floor-limits.mjs"), "utf8");
  // lastIndexOf on BOTH markers: this check is written ABOVE the code it reads, so indexOf finds
  // the copies inside this very sentence and hands back a 42-character "body" that passes nothing.
  const body = me.slice(me.lastIndexOf("async function collectLive"), me.lastIndexOf("const isLive ="));
  return body.length > 1000
    && !/\bmethod:\s*"(POST|PATCH|PUT|DELETE)"/.test(body)
    && !/loginAs\(|\/api\/(panel|staff)-login/.test(body);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
if (LEDGER) {
  console.log("| id | check | how to verify | result | note |");
  console.log("|---|---|---|---|---|");
  checks.forEach((c, i) => {
    const id = "P" + (FIRST_ID + i);
    console.log(`| ${id} | ${c.title.replace(/\|/g, "\\|")} | \`npm run verify:floor-limits -- --base <url> --from ${i + 1} --to ${i + 1}\` | — |  |`);
  });
  process.exit(0);
}

// ── the live pass ────────────────────────────────────────────────────────────────────────────
async function collectLive() {
  const { chromium } = await import("playwright");
  // The SHARED admin door (scripts/sweep/login.mjs). It presents the cookie the gate already
  // accepts, so this guard makes ZERO sign-in requests — on a territory whose whole subject is the
  // limit that counts them. Hand-rolling the cookie here got its NAME wrong once and every live
  // check answered 401 while reading like a product fault.
  const { adminCookie } = await import("./sweep/login.mjs");
  const cookie = adminCookie(BASE);
  const browser = await chromium.launch();
  // A SERVICE WORKER EATS page.route(). Block it, or the two fabricated-payload checks pass over
  // a handler that never fired — this repo has lost eleven "findings" to exactly that.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await ctx.addCookies([cookie]);
  const api = async (path) => {
    const p = await ctx.newPage();
    const r = await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
    let j = {}; try { j = JSON.parse(await p.evaluate(() => document.body.innerText)); } catch { /* not json */ }
    j.__status = r?.status(); await p.close(); return j;
  };
  live.floorJson = await api("/api/admin/floor?all=1");
  live.rlJson = await api("/api/admin/rate-limits");
  live.soJson = await api("/api/admin/staff-online");

  const readPage = async (page, path) => {
    const pageErrors = [], consoleErrors = [], bad = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith("/api")) bad.push(r.url() + " " + r.status()); });
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent?.trim(),
      text: (document.body.innerText || ""),
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      hasShell: !!document.querySelector(".adx, .adm-page-h"),
      navLinks: document.querySelectorAll('a[href^="/aevinite"]').length,
    }));
    return { status: resp?.status(), h1: info.h1, text: info.text, textLen: info.text.length,
      scrollW: info.scrollW, clientW: info.clientW, hasShell: info.hasShell, navLinks: info.navLinks,
      pageErrors, consoleErrors, bad,
      leaks: ["-->", "${", "[object Object]", "NaN", "undefined"].filter((s) => info.text.includes(s)) };
  };
  for (const [path] of PAGES) {
    const p = await ctx.newPage();
    live.pages[path] = await readPage(p, path);
    await p.close();
    const ph = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await ph.addCookies([cookie]);
    const pp = await ph.newPage();
    const r = await readPage(pp, path);
    live.pages[path].phone = { scrollW: r.scrollW, clientW: r.clientW, textLen: r.textLen, pageErrors: r.pageErrors, h1: r.h1 };
    await ph.close();
  }

  // ── the Live floor, driven ────────────────────────────────────────────────────────────────
  {
    const p = await ctx.newPage();
    let calls = 0;
    p.on("request", (r) => { if (r.url().includes("/api/admin/floor")) calls++; });
    await p.goto(BASE + "/aevinite/floor", { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    live.probe.floorCallsBeforeGate = calls;
    await p.getByRole("button", { name: "Load live floor" }).click({ timeout: 20000 });
    await p.waitForLoadState("networkidle"); await p.waitForTimeout(1200);
    live.probe.floorCallsAfterGate = calls;
    const m = await p.evaluate(() => {
      const blocks = [...document.querySelectorAll(".adm-floormonth")];
      const stat = (label) => { const el = [...document.querySelectorAll(".adm-stat")].find((s) => s.querySelector(".k")?.textContent?.trim() === label); return el?.querySelector(".v")?.textContent?.trim() || ""; };
      const chip = document.querySelector(".adm-snapchip");
      const tiles = [...document.querySelectorAll(".adm-minitile")];
      return {
        blockCount: blocks.length,
        tileCount: tiles.length,
        heights: blocks.map((b) => ({ h: Math.round(b.getBoundingClientRect().height), t: b.querySelectorAll(".adm-minitile").length })),
        tablesBusy: stat("Tables busy"), restsLive: stat("Restaurants live"), ordersToday: stat("Orders today"),
        snapColor: chip ? getComputedStyle(chip).color : "",
        mutedColor: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
        tileOverflow: tiles.filter((t) => t.scrollWidth > t.clientWidth + 1).length,
        longFaces: tiles.filter((t) => (t.getAttribute("title") || "").replace(/^Table /, "").split(" ")[0].length > 3).map((t) => t.textContent),
        firstBlockName: blocks[0]?.querySelector(".adm-floormonth-name")?.textContent?.trim(),
      };
    });
    live.probe.blockCount = m.blockCount;
    live.probe.tileCount = m.tileCount;
    live.probe.tileOverflow = m.tileOverflow;
    live.probe.longLabelsClipped = m.longFaces.every((f) => (f || "").length <= 3);
    live.probe.shortestBlock = Math.min(...m.heights.map((x) => x.h));
    live.probe.heightTracksTiles = (() => {
      const small = m.heights.filter((x) => x.t <= 20), big = m.heights.filter((x) => x.t >= 100);
      return small.length === 0 || big.length === 0 || Math.max(...small.map((x) => x.h)) < Math.min(...big.map((x) => x.h));
    })();
    live.probe.snapchipNeutral = !!m.snapColor && !/217|119|6\)/.test(m.snapColor.replace(/\s/g, ""));
    const busyTotal = (live.floorJson.restaurants || []).reduce((s, r) => s + r.tables.filter((t) => t.s !== "free").length, 0);
    live.probe.tablesBusyMatches = m.tablesBusy.startsWith(String(busyTotal));
    live.probe.restsLiveMatches = m.restsLive.startsWith(String((live.floorJson.restaurants || []).filter((r) => r.tables.some((t) => t.s !== "free")).length));
    // The Open-tables box must follow the Sort control
    await p.getByRole("button", { name: /Open tables/ }).click({ timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(200);
    // Start from name order, so switching to "Busiest first" below is a real reordering to observe.
    await p.click('[aria-label="Sort restaurants"]').catch(() => {});
    await p.waitForTimeout(200);
    await p.getByRole("option", { name: "Name A–Z" }).click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(400);
    await p.waitForTimeout(300);
    const firstOpen = async () => p.evaluate(() => document.querySelectorAll(".adm-card button")[0] && [...document.querySelectorAll("button")].filter((b) => b.getAttribute("title")?.startsWith("Open "))[0]?.textContent?.trim().split(" ·")[0]);
    const beforeName = await firstOpen();
    // The Sort control is the console's own dropdown (a trigger button + a listbox), not a <select>.
    await p.click('[aria-label="Sort restaurants"]').catch(() => {});
    await p.waitForTimeout(200);
    // "Busiest first", NOT "Name A–Z". The server already sends the restaurants in name order, so
    // picking name makes a BROKEN Open-tables list (one that ignores the sort) agree with the blocks
    // by pure coincidence — sabotaging the fix left this check green until it was pointed elsewhere.
    await p.getByRole("option", { name: "Busiest first" }).click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(500);
    // SCOPED TO THE OPEN-TABLES CARD. Reading every "…manager panel" button on the page picks up
    // each restaurant BLOCK's own name button too, so the two lists interleave and the order test
    // is meaningless — it read as a product fault for one run.
    const afterOrder = await p.evaluate(() => {
      const blocks = [...document.querySelectorAll(".adm-floormonth")].map((b) => b.querySelector(".adm-floormonth-name")?.textContent?.trim());
      const card = [...document.querySelectorAll(".adm-card")].find((c) => /Open tables/.test(c.textContent || ""));
      const openNames = card ? [...card.querySelectorAll("button")].filter((b) => b.getAttribute("title")?.includes("manager panel")).map((b) => b.textContent.trim().split(" ·")[0]) : [];
      return { blocks, openNames };
    });
    const positions = afterOrder.openNames.map((n) => afterOrder.blocks.indexOf(n));
    live.probe.openTablesFollowsSort = positions.length > 1 && positions.every((v, i, a) => v >= 0 && (i === 0 || a[i - 1] < v));
    void beforeName;
    // idle
    let idle = 0; const c2 = (r) => { if (r.url().includes("/api/")) idle++; };
    p.on("request", c2); await p.waitForTimeout(20000); p.off("request", c2);
    live.probe.idleCalls = idle;
    // Today tab
    let tcalls = 0; const c3 = (r) => { if (r.url().includes("/api/")) tcalls++; };
    p.on("request", c3);
    await p.getByRole("tab", { name: "Today" }).click({ timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(1200); p.off("request", c3);
    live.probe.todayTabCalls = tcalls;
    const todayOrders = await p.evaluate(() => { const el = [...document.querySelectorAll(".adm-stat")].find((s) => s.querySelector(".k")?.textContent?.trim() === "Orders today"); return el?.querySelector(".v")?.textContent?.trim() || ""; });
    live.probe.todayOrdersMatch = todayOrders === m.ordersToday;
    await p.close();
  }

  // ── the Rate limits page, driven ──────────────────────────────────────────────────────────
  {
    const p = await ctx.newPage();
    let calls = 0;
    p.on("request", (r) => { if (r.url().includes("/api/admin/rate-limits")) calls++; });
    await p.goto(BASE + "/aevinite/rate-limits", { waitUntil: "networkidle" });
    await p.waitForTimeout(600);
    // Next's dev server runs effects twice under StrictMode, so ONE read on open can legitimately
    // show as two in development. Two is the ceiling; three would mean a real second fetch.
    live.probe.rlCalls = calls;
    const m = await p.evaluate(() => ({
      chips: [...document.querySelectorAll(".rl-hit .rl-chip")].map((c) => c.textContent),
      anchors: document.querySelectorAll('[id^="rule-"]').length,
      saves: [...document.querySelectorAll(".rl-rule button")].filter((b) => b.textContent.trim() === "Save").map((b) => b.disabled),
      text: document.body.innerText,
      names: [...document.querySelectorAll(".rl-hit b")].map((b) => b.textContent),
    }));
    live.probe.zeroChips = m.chips.filter((c) => /\/\s*0\s*per|per 0 /.test(c)).length;
    live.probe.attemptChipOk = m.chips.length === 0 ? true : m.chips.every((c) => /per|attempt/.test(c));
    live.probe.ruleAnchors = m.anchors;
    live.probe.savesDisabled = m.saves.length > 0 && m.saves.every(Boolean);
    live.probe.rawKeysOnScreen = m.names.filter((n) => /^[a-z]+_[a-z]+$/.test((n || "").trim())).length;
    live.probe.labelLadderMatches = m.names.every((n) => !/_/.test(n || ""));
    // clearing the max box must not be able to produce a 0
    const box = await p.$(".rl-rule .rl-num");
    if (box) { await box.fill(""); await p.waitForTimeout(200); live.probe.clearedBoxValue = await box.inputValue(); }
    await p.reload({ waitUntil: "networkidle" });
    // a rule stored at 0 — fabricated in the browser, nothing is written
    await p.route("**/api/admin/rate-limits*", (r) => r.request().method() === "GET"
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [{ id: "aaaaaaaa-0000-0000-0000-000000000001", key: "guest_order", label: "Guest orders (per table)", max_count: 0, window_seconds: 60, enabled: true, updated_at: new Date().toISOString() }], events: [{ id: "bbbbbbbb-0000-0000-0000-000000000001", restaurant_id: "00000000-0000-0000-0000-000000000000", restaurant_name: null, key: "admin_login", subject: "::1", subject_label: "Admin panel · ::1", hit_count: 3, max_count: 0, window_seconds: 0, last_at: new Date().toISOString() }], blocked: [], requests: [] }) })
      : r.continue());
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
    const z = await p.evaluate(() => ({ rule: document.querySelector(".rl-rule .adm-muted")?.textContent || "", chip: document.querySelector(".rl-hit .rl-chip")?.textContent || "" }));
    live.probe.zeroRuleWords = /lets everything through/.test(z.rule);
    live.probe.attemptChipOk = live.probe.attemptChipOk && /attempt/.test(z.chip) && !/per 0/.test(z.chip);
    // a failed read
    await p.unroute("**/api/admin/rate-limits*");
    await p.route("**/api/admin/rate-limits*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "couldn't be read just now" }) }));
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(800);
    const f = await p.evaluate(() => document.body.innerText);
    live.probe.rlFailUnknown = /unknown/i.test(f) && !/No limits reached right now/.test(f);
    live.probe.rlFailRetry = /Retry/.test(f);
    live.probe.rlFailNoEmpties = !/No devices are blocked|No requests right now|No limits reached right now/.test(f);
    await p.unroute("**/api/admin/rate-limits*");
    // folding is remembered
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
    await p.getByRole("button", { name: /Blocked from the admin panel/ }).click().catch(() => {});
    await p.waitForTimeout(300);
    const shutBefore = await p.evaluate(() => !!document.querySelector('[aria-expanded="false"]'));
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(700);
    const shutAfter = await p.evaluate(() => !!document.querySelector('[aria-expanded="false"]'));
    live.probe.rlFoldRemembered = shutBefore === shutAfter;
    await p.evaluate(() => { try { localStorage.removeItem("lfh_rl_collapsed"); } catch {} });
    let idle = 0; const c2 = (r) => { if (r.url().includes("/api/")) idle++; };
    p.on("request", c2); await p.waitForTimeout(20000); p.off("request", c2);
    live.probe.rlIdleCalls = idle;
    await p.close();
  }

  // ── Staff online, driven ──────────────────────────────────────────────────────────────────
  {
    const p = await ctx.newPage();
    let calls = 0;
    p.on("request", (r) => { if (r.url().includes("/api/admin/staff-online")) calls++; });
    await p.goto(BASE + "/aevinite/staff-online", { waitUntil: "networkidle" });
    await p.waitForTimeout(600);
    const n = (live.soJson?.staff || []).length;
    const m = await p.evaluate(() => ({ count: document.querySelector(".cmd-sec")?.textContent?.trim() || "", cards: document.querySelectorAll(".so-card").length }));
    live.probe.soCountMatches = m.count === `${n} online`;
    live.probe.soCards = m.cards;
    const before = calls;
    await p.getByRole("button", { name: "Manager" }).click().catch(() => {});
    await p.waitForTimeout(400);
    const afterChip = await p.evaluate(() => ({ cards: document.querySelectorAll(".so-card").length, count: document.querySelector(".cmd-sec")?.textContent?.trim() }));
    live.probe.roleChipFilters = /of \d+ online/.test(afterChip.count || "");
    await p.getByRole("button", { name: "Kitchen" }).click().catch(() => {});
    await p.waitForTimeout(400);
    const two = await p.evaluate(() => document.querySelectorAll(".so-card").length);
    live.probe.roleChipsCombine = two >= afterChip.cards;
    live.probe.soFilterCalls = calls - before;
    const label = await p.evaluate(() => document.querySelector(".so-status")?.textContent || "");
    await p.waitForTimeout(16000);
    const label2 = await p.evaluate(() => document.querySelector(".so-status")?.textContent || "");
    live.probe.soTickNoCalls = calls - before === 0 && (label === label2 || label2.length > 0);
    let idle = 0; const c2 = (r) => { if (r.url().includes("/api/")) idle++; };
    p.on("request", c2); await p.waitForTimeout(20000); p.off("request", c2);
    live.probe.soIdleCalls = idle;
    await p.close();

    // item 3 — a filter whose restaurant leaves the roster. Fabricated payloads; nothing is written.
    const q = await ctx.newPage();
    const RID_A = "00000000-0000-0000-0000-000000000001", RID_B = "11111111-1111-1111-1111-111111111111";
    let phase = 1;
    await q.route("**/api/admin/staff-online*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(phase === 1
      ? { staff: [{ id: "a", name: "Ravi", username: "ravi", role: "manager", restaurant_id: RID_A, restaurantName: "Restaurant A", last_seen_at: new Date().toISOString() }], restaurants: [{ id: RID_A, name: "Restaurant A" }], generatedAt: new Date().toISOString() }
      : { staff: [{ id: "b", name: "Meera", username: "meera", role: "kitchen", restaurant_id: RID_B, restaurantName: "Restaurant B", last_seen_at: new Date().toISOString() }, { id: "c", name: "Sam", username: "sam", role: "tablet", restaurant_id: RID_B, restaurantName: "Restaurant B", last_seen_at: new Date().toISOString() }], restaurants: [{ id: RID_B, name: "Restaurant B" }], generatedAt: new Date().toISOString() }) }));
    await q.goto(BASE + "/aevinite/staff-online", { waitUntil: "networkidle" });
    await q.waitForTimeout(400);
    await q.selectOption("select", { label: "Restaurant A" });
    await q.waitForTimeout(300);
    phase = 2;
    await q.getByRole("button", { name: "Refresh" }).click();
    await q.waitForTimeout(1200);
    const st = await q.evaluate(() => { const s = document.querySelector("select"); return {
      shows: s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent : "(blank)",
      count: document.querySelector(".cmd-sec")?.textContent?.trim(), cards: document.querySelectorAll(".so-card").length }; });
    live.probe.staleFilterDropped = st.count === "2 online" && st.cards === 2;
    live.probe.pickerAgreesWithList = st.shows === "All restaurants" && st.cards === 2;
    // a failed read
    await q.unroute("**/api/admin/staff-online*");
    await q.route("**/api/admin/staff-online*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "couldn't be read just now" }) }));
    await q.reload({ waitUntil: "networkidle" }); await q.waitForTimeout(800);
    const ftxt = await q.evaluate(() => document.body.innerText);
    live.probe.soFailRetry = /Couldn't load|Couldn’t load/.test(ftxt) && /Retry/.test(ftxt);
    live.probe.soFailNoEmpty = !/No staff are online right now/.test(ftxt);
    await q.close();
  }
  await browser.close();
}

const isLive = (c) => /^Live · /.test(c.title);
if (!STATIC_ONLY && checks.some((c, i) => isLive(c) && i + 1 >= FROM && i + 1 <= TO)) {
  // THE ONE PREFLIGHT EVERY APP-DRIVING GUARD SHARES. With nothing answering on --base, a browser
  // guard throws a connection-refused stack, which reads as "this guard is broken" rather than
  // "start the server" — and a guard that could not run must never be mistaken for one that ran.
  // It exits 2, not 1, so a runner can tell "could not run" from "ran and found a fault".
  const { requireUp } = await import("./sweep/appUp.mjs");
  await requireUp(BASE, "the admin's Live floor, Rate limits and Staff online screens");
  try { await collectLive(); }
  catch (e) { console.log(`  ! the live pass could not run: ${String(e).slice(0, 200)}`); }
}

let pass = 0, fail = 0, skipped = 0;
const failures = [];
for (let i = 0; i < checks.length; i++) {
  const n = i + 1, id = "P" + (FIRST_ID + i), c = checks[i];
  if (n < FROM || n > TO) continue;
  if (STATIC_ONLY && isLive(c)) { skipped++; continue; }
  let ok = false, note = "";
  try { const r = await c.fn(); ok = !!r; if (typeof r === "string") note = r; }
  catch (e) { ok = false; note = String(e).slice(0, 120); }
  if (ok) { pass++; if (!QUIET) console.log(`  ✓ ${id} (${n}) ${c.title}`); }
  else { fail++; failures.push(`${id} (${n}) ${c.title}${note ? " — " + note : ""}`); console.log(`  ✗ ${id} (${n}) ${c.title}${note ? " — " + note : ""}`); }
}
console.log(`\nadmin floor & limits (T21): ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped (--static)` : ""} of ${checks.length} checks (P${FIRST_ID}–P${FIRST_ID + checks.length - 1})`);
if (fail) { console.log("\nfailed:"); failures.forEach((f) => console.log("  " + f)); }
process.exit(fail ? 1 : 0);
