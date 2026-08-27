#!/usr/bin/env node
// verify:admin-health — the permanent regression check for the ADMIN's health, logs, issues
// and limits screens (sweep #6, terminal 17, 2026-08-19).
//
// Every assertion below is a problem that was FOUND on these screens and fixed. They are all
// static reads of the source — no server, no database, no browser — so this stays fast enough to
// run as a hook and can never leave a row behind.
//
// The one rule most of them serve: A PAGE THAT COULD NOT ASK MUST NOT SAY "ALL CLEAR". Four of
// the eight screens drew a green empty state over a failed read.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const A = "app/aevinite";
const REPAIR = read(`${A}/repair/page.tsx`);
const LOGS = read(`${A}/logs/page.tsx`);
const LIMITS = read(`${A}/rate-limits/page.tsx`);
const HEALTH = read(`${A}/health/page.tsx`);
const ONLINE = read(`${A}/staff-online/page.tsx`);
const USAGE = read(`${A}/usage/page.tsx`);
const ISSUES = read(`${A}/issues/page.tsx`);
const ATTENTION = read(`${A}/attention/page.tsx`);
const RL_ROUTE = read("app/api/admin/rate-limits/route.ts");
// Sweep #7 items 7, 10 and 11 reach into three more files. They are READ here, never written:
// this guard is a static read of the source and nothing else.
const CUSTLOG = read("app/api/admin/custlog/route.ts");
const API_A = read("scripts/verify-admin-api-a.mjs");
const HEALTH_ROUTE = read("app/api/admin/health/route.ts");
const RESOLVE_ROUTE = read("app/api/admin/resolve-error/route.ts");

const fails = [];
const ok = (cond, id, msg) => { if (!cond) fails.push(`${id}  ${msg}`); };

// ── 1 · the Repair hub must record a failed read, not fall through to its green cards ─────────
ok(/failed\.push\("problems"\)/.test(REPAIR), "P08001",
  "repair: the error feed's failure is no longer recorded — a failed read will draw the green 'All clear' again");
ok(/failed\.push\("rate limits"\)/.test(REPAIR), "P08002",
  "repair: the rate-limit feed's failure is no longer recorded — a failed read will draw the green all-clear again");
ok(/setProblemsErr\(/.test(REPAIR) && /problemsErr \?/.test(REPAIR), "P08001",
  "repair: problemsErr is not consulted before the problems empty state");
ok(/setRlErr\(/.test(REPAIR) && /rlErr \?/.test(REPAIR), "P08002",
  "repair: rlErr is not consulted before the rate-limit empty state");
ok(/rp-unread/.test(REPAIR), "P08001",
  "repair: the 'couldn't read this' block is gone");
ok(/problemsErr \? "—"/.test(REPAIR), "P08001",
  "repair: the problems pill shows a confident number again when the feed failed");
// every `if (x.ok) set...` in loadHub must have an else that records the failure
{
  const hub = REPAIR.slice(REPAIR.indexOf("const loadHub"), REPAIR.indexOf("useEffect(() => { loadHub(); }"));
  const bare = [...hub.matchAll(/^\s*if \((\w+)\.ok\)(?![\s\S]{0,400}?else)/gm)].map((m) => m[1]);
  ok(bare.length === 0, "P08001",
    `repair: loadHub has ${bare.length} feed(s) whose failure is silently ignored (${bare.join(", ")})`);
}

// ── 2 · a capped feed must say it is capped ───────────────────────────────────────────────────
ok(/const ERROR_FEED_LIMIT = 50;/.test(REPAIR), "P08009", "repair: ERROR_FEED_LIMIT is gone");
ok(/errors\.length >= ERROR_FEED_LIMIT/.test(REPAIR), "P08009",
  "repair: the problem board no longer says when it is only showing the newest reports");
ok(/const FEED_LIMIT = 200;/.test(LOGS), "P08064", "logs: FEED_LIMIT is gone");
ok(/function FeedCap\(/.test(LOGS), "P08064", "logs: the 'showing the latest N' notice is gone");
ok(/capped=\{\(ops\?\.length \?\? 0\) >= FEED_LIMIT\}/.test(LOGS), "P08064",
  "logs: the Operations feed no longer reports being capped");
ok(/capped=\{\(aud\?\.length \?\? 0\) >= FEED_LIMIT\}/.test(LOGS), "P08065",
  "logs: the Audit feed no longer reports being capped");
ok(!/limit=200/.test(LOGS), "P08064",
  "logs: a hard-coded limit=200 is back — it must come from FEED_LIMIT so the cap notice can never disagree with the query");

// ── 3 · one restaurant picker must mean the WHOLE Repair page ─────────────────────────────────
ok(/const scopedIssues = rid \? issues\.filter\(\(i\) => i\.restaurant_id === rid\) : issues;/.test(REPAIR), "P08013",
  "repair: complaints are platform-wide again while the banner says 'Showing <name> only'");
ok(/const atRisk = \(att\?\.atRisk \|\| \[\]\)\.filter\(\(r\) => !rid \|\| r\.id === rid\)/.test(REPAIR), "P08014",
  "repair: the at-risk list ignores the restaurant picker again");
ok(/const onboarding = \(att\?\.onboarding \|\| \[\]\)\.filter\(\(r\) => !rid \|\| r\.id === rid\)/.test(REPAIR), "P08014",
  "repair: the onboarding list ignores the restaurant picker again");
ok(!/att\.atRisk\.map|att\.onboarding\.map/.test(REPAIR), "P08014",
  "repair: an at-risk list is rendering the unscoped array again");
ok(/raised by staff &amp; owners · \{scopedName \|\| "all restaurants"\}/.test(REPAIR), "P08018",
  "repair: the complaints caption claims 'all restaurants' regardless of the picker");

// ── 4 · a section icon must glow for what is ON SCREEN ────────────────────────────────────────
ok(/color: rlErr \? "var\(--adm-warn\)" : shownRlHits\.length \?/.test(REPAIR), "P08017",
  "repair: the rate-limit gauge is coloured from the platform-wide count again");
ok(/someone hit a wall · \{scopedName \|\| "all restaurants"\}/.test(REPAIR), "P08016",
  "repair: the rate-limit caption claims 'all restaurants' regardless of the picker");

// ── 5 · the page must point at controls where they actually are ───────────────────────────────
ok(!/in the tools below to tag it/.test(REPAIR), "P08022",
  "repair: 'Report a problem' points at the restaurant picker 'in the tools below' — it lives at the TOP of the page");

// ── 6 · a deep link fires ONE query, not two ──────────────────────────────────────────────────
ok(/const \[seeded, setSeeded\] = useState\(false\);/.test(LOGS), "P08066",
  "logs: the seeded gate is gone — a deep link will fetch unscoped rows and then fetch again");
ok(/if \(!seeded\) return;/.test(LOGS), "P08066",
  "logs: the tab load effect no longer waits for the URL to be read");

// ── 7 · the Rate limits page must not draw four all-clears over a failed read ─────────────────
ok(/const \[loadErr, setLoadErr\] = useState\(""\);/.test(LIMITS), "P08111",
  "rate limits: the failed-load state is gone — the page will show four green empty states again");
{
  const n = (LIMITS.match(/loadErr \? unread/g) || []).length;
  ok(n >= 4, "P08111",
    `rate limits: only ${n} of the four sections check loadErr before their empty state (need 4: hits, rules, requests, blocked)`);
}
ok(/rl-unread/.test(LIMITS), "P08111", "rate limits: the 'couldn't read this' block is gone");

// ── 8 · the admin-login alert must offer the kind answer as well as the harsh one ─────────────
ok(/const clearHit = async/.test(LIMITS), "P08115",
  "rate limits: 'Let them try again' is gone — the note at the bottom of 'The limits' promises it");
ok(/Let them try again/.test(LIMITS), "P08115", "rate limits: the 'Let them try again' button label is gone");
ok(/action: "clear"/.test(LIMITS), "P08116",
  "rate limits: 'Let them try again' no longer calls the server's clear action");
ok(/action === "clear"/.test(RL_ROUTE), "P08116",
  "the server no longer has the clear action the two screens call (this is a HANDOFF, not this page's fix)");
ok(/Let them try again/.test(REPAIR), "P08480",
  "repair: the same alert lost its 'Let them try again' answer — the two screens must offer the same actions");

// ── 9 · a failed health check is not a check in progress ──────────────────────────────────────
ok(/h === null && err \?/.test(HEALTH), "P08141",
  "health: a failed check falls through to 'Checking…' again");
ok(/Couldn&apos;t check/.test(HEALTH), "P08141", "health: the 'couldn't check' state is gone");

// ── 10 · a 3D dish with no file must say whose menu it is on ──────────────────────────────────
ok(/const restaurantName = \(id: string\)/.test(HEALTH), "P08149",
  "health: the restaurant-name lookup for 3D-broken dishes is gone");
ok(/\{restaurantName\(d\.restaurantId\)\}/.test(HEALTH), "P08149",
  "health: a 3D-broken dish no longer names its restaurant, so there is nothing to act on");

// ── 11 · a note is not a warning ──────────────────────────────────────────────────────────────
ok(/\.so-snap \{[^}]*color: var\(--muted\)/.test(ONLINE), "P08174",
  "staff online: the 'Manual — press Refresh' note is drawn in the warning colour again — it is always up");
ok(!/\.so-snap \{[^}]*--adm-warn/.test(ONLINE), "P08174",
  "staff online: the 'press Refresh' note uses the warning token again");

// ── 12 · "…" means loading; a failed read must not sit on it ──────────────────────────────────
ok(/const blank = err \? "—" : "…";/.test(USAGE), "P08187",
  "usage: the four headline numbers sit on '…' for ever after a failed read again");

// ── 13 · a two-column key -> value list must fit a phone ──────────────────────────────────────
ok(/adm-logwrap hx-kv/.test(HEALTH), "P08378",
  "health: the key->value tables lost their hx-kv tag — on a phone their numbers go off-screen");
{
  const n = (HEALTH.match(/adm-logwrap hx-kv/g) || []).length;
  ok(n >= 3, "P08378", `health: only ${n} of the 3 key->value tables are tagged hx-kv`);
}
ok(/\.hx-kv \.adm-logrow \{ min-width: 0;/.test(HEALTH), "P08378",
  "health: the rule that lets a key->value list fit a phone is gone");

// ── 14 · a warning bar that is always up is not a warning ─────────────────────────────────────
// THE RULE IS UNCHANGED; THE PLACE IT LIVES MOVED (2026-08-20). System health was rebuilt after the
// owner said he could not read it, and the standalone amber bar this phase was written against is
// gone — it said the same thing as the "Staff screens" row in the new check list, so it was one
// fact wearing two coats, and the coat was a warning triangle. The three things this phase actually
// protects are all still true and still worth failing over, so they are checked where they now live:
//   · the warning is driven by NEVER-SEEN panels, not by every quiet one;
//   · "quiet" is described as the ordinary fact it is;
//   · the old always-up wording has not come back.
ok(/never signed into/.test(HEALTH), "P08156",
  "health: the never-signed-into warning is gone — the only panel state that is wrong at any hour");
ok(/needsYou: neverSeen > 0/.test(HEALTH), "P08156",
  "health: the staff-screens warning no longer keys on never-seen panels — it would be up on every load");
ok(/x\.status === "never"/.test(HEALTH) && /x\.status === "offline"/.test(HEALTH), "P08156",
  "health: the panel counts no longer separate 'never signed into' from 'quiet for an hour'");
ok(/which is normal/.test(HEALTH), "P08156",
  "health: a quiet panel is no longer described as normal — that is what made the old bar cry wolf");
ok(!/quiet or never seen — a device or login may be down/.test(HEALTH), "P08156",
  "health: the old always-up wording is back");

// ── 15 · the usage strip on a phone ───────────────────────────────────────────────────────────
ok(/\.rev-strip \.cell:nth-child\(odd\)/.test(USAGE), "P08421",
  "usage: the phone layout for the stat strip is gone — four numbers stack one per row with a stray rule");

// ── standing rules for this territory (not tied to one fix) ───────────────────────────────────
ok(/redirect\("\/aevinite\/repair#complaints"\)/.test(ISSUES), "P08196",
  "the retired Tickets URL no longer lands on the complaints section");
ok(/redirect\("\/aevinite\/repair#at-risk"\)/.test(ATTENTION), "P08199",
  "the retired At-risk URL no longer lands on the at-risk section");
ok(/id="complaints"/.test(REPAIR), "P08198", "repair: the #complaints anchor the redirect points at is gone");
ok(/id="at-risk"/.test(REPAIR), "P08200", "repair: the #at-risk anchor the redirect points at is gone");
ok(/id="rate-limits"/.test(REPAIR), "P08137", "repair: the #rate-limits anchor the Rate limits page links to is gone");
ok(/id={`rule-\$\{r\.key\}`}/.test(LIMITS), "P08027",
  "rate limits: a rule row lost its #rule-<key> anchor, so 'Change rate limit' from the Repair hub lands nowhere");
// no earnings anywhere in this territory (the admin sees no food money)
for (const [name, src] of [["repair", REPAIR], ["rate-limits", LIMITS], ["health", HEALTH], ["staff-online", ONLINE], ["usage", USAGE]]) {
  ok(!/₹|\binr\(/.test(src), "P08273", `${name}: a money figure appeared on an admin screen that must show none`);
}
// no page in this territory may poll faster than the 60s backstop
for (const [name, src] of [["repair", REPAIR], ["logs", LOGS], ["rate-limits", LIMITS], ["health", HEALTH], ["usage", USAGE]]) {
  for (const m of src.matchAll(/setInterval\([^,]+,\s*(\d+)\s*\)/g)) {
    ok(Number(m[1]) >= 60000, "P08203", `${name}: a ${m[1]}ms polling timer — nothing here may poll faster than the 60s backstop`);
  }
  for (const m of src.matchAll(/useActiveAutoRefresh\([^,]+,\s*(\d+)/g)) {
    ok(Number(m[1]) >= 60000, "P08203", `${name}: auto-refresh set to ${m[1]}ms — the floor is 60000`);
  }
}
// every list read this territory makes must be bounded
ok(/limit=\$\{ERROR_FEED_LIMIT\}/.test(REPAIR), "P08202", "repair: the error feed lost its limit");
ok(/limit=\$\{FEED_LIMIT\}/.test(LOGS), "P08202", "logs: a feed lost its limit");

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SWEEP #7 (terminal 17, 2026-08-27) — six more, each one watched happening on the running app.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// ── 16 · the Repair status strip must fail the way its sections do ────────────────────────────
// With the complaints feed unreachable the pill read a confident "0 open complaints", and "need
// attention" sat on the still-loading "…" for ever — two inches from the "problems open" pill,
// which correctly showed "—". Neither failure reached the "couldn't read …" line either.
ok(/failed\.push\("complaints"\)/.test(REPAIR), "P23117",
  "repair: a failed complaints read is no longer named in the 'couldn't read' line under the counts");
ok(/failed\.push\("account health"\)/.test(REPAIR), "P23118",
  "repair: a failed account-health read is no longer named in the 'couldn't read' line under the counts");
ok(/issuesErr \? "—"/.test(REPAIR), "P23119",
  "repair: the open-complaints pill shows a number again when its feed failed — a reassuring zero");
ok(/attErr \? "—"/.test(REPAIR), "P23120",
  "repair: the need-attention pill no longer shows '—' when its feed failed");

// ── 17 · one definition of "the same problem", client and server ──────────────────────────────
// /api/admin/resolve-error groups by the shared errorSig(); the Logs page compared the message
// text character for character, so "Mark resolved" cleared nine rows on the server and struck
// through only the ones that matched letter for letter.
ok(/from "@\/lib\/errorSignature"/.test(LOGS), "P23131",
  "logs: the shared error signature is no longer imported — the local group test will drift from the server's again");
ok(/errorSig\(x\.detail\) === wantSig/.test(LOGS), "P23132",
  "logs: markResolved compares message text directly again — it will leave a group's twins red after the server clears them");
ok(!/\(x\.detail \?\? null\) === \(a\.detail \?\? null\)/.test(LOGS), "P23132",
  "logs: the old character-for-character detail comparison is back in markResolved");

// ── 18 · a report set to "come back later" is MARKED on the one screen that shows everything ──
// /api/admin/oplog ships `snoozed_until` for exactly this; nothing read it, so eight reports the
// admin had told to come back tomorrow sat in the same full red as a live unhandled crash.
ok(/snoozed_until/.test(LOGS), "P23141",
  "logs: `snoozed_until` is unread again — a waiting report looks identical to a live unhandled one");
ok(/Waiting · back/.test(LOGS), "P23142", "logs: the 'Waiting · back …' chip on a snoozed error row is gone");
ok(/function backIn\(/.test(LOGS), "P23143",
  "logs: backIn() is gone — timeAgo() only looks backwards and prints 'just now' for a future date");
ok(/const showRed = isErr && !isResolved && !waitingUntil/.test(LOGS), "P23144",
  "logs: a waiting report is drawn in full red again, which is what made it indistinguishable from a live one");

// ── 19 · the waiting COUNT on the Repair hub says whose it is ─────────────────────────────────
// The board asks for its problems unscoped, so the server's waiting count is always platform-wide.
// It printed 8 under a banner reading "Showing My Little French House only." — 7 were hers.
ok(/scopedName \? " across all restaurants" : ""/.test(REPAIR), "P23151",
  "repair: the waiting-reports line no longer says the count is platform-wide while one restaurant is chosen");

// ── 20 · the "Already fixed" list obeys the picker its own button obeys ───────────────────────
// The list showed every restaurant's records under "Showing X only", counted all of them as X's,
// and "Forget all" — which sends the restaurant id — then forgot fewer and said so.
ok(/const scopedMemories = rid \?/.test(REPAIR), "P23161",
  "repair: the already-fixed list ignores the restaurant picker again, while its Forget-all button obeys it");
ok(/m\.restaurant_id === rid \|\| m\.restaurant_id === null/.test(REPAIR), "P23162",
  "repair: the already-fixed filter no longer matches the DELETE route's scope (this restaurant + the platform-wide ones)");
ok(!/All \{memories\.length\} record/.test(REPAIR), "P23163",
  "repair: the already-fixed heading counts every restaurant's records again");
ok(/\{scopedMemories\.map\(/.test(REPAIR), "P23164", "repair: the already-fixed list renders the unscoped array again");

// ── 21 · System health's panel grid agrees with its own legend ────────────────────────────────
// The legend calls Quiet "normal when a restaurant is closed" and the check row calls it normal
// too — and the dot painted all 28 of them in the danger colour, the same red as the 3 that
// genuinely need him. Same family as R42/R43: a warning that is always up is not a warning.
ok(/offline: \{ c: "var\(--muted\)", t: "Quiet" \}/.test(HEALTH), "P23171",
  "health: a quiet panel is drawn in the alarm colour again, for a state this page's own legend calls normal");
ok(/never: \{ c: "var\(--adm-danger\)", t: "Never seen" \}/.test(HEALTH), "P23172",
  "health: 'Never seen' lost the danger colour — it is the one panel state the page says is genuinely unfinished");

// ── 22 · a banned guest's phone number does not ride along to a screen that never shows it ────
// `blocklist` holds ten columns and the Customers tab renders six. Two of the four it never
// showed were `unban_phone` / `unban_requested_at` — the number a banned guest leaves when asking
// to be let back in. The old allowance in verify:admin-api-a said "no money column", which was
// never the whole rule. Both halves are asserted: the read names its columns, AND the spent
// allowance stays gone, because leaving one behind is how a select("*") creeps back in.
ok(!/\.select\(\s*["'`]\*/.test(CUSTLOG), "P23601",
  "custlog: the blocklist read is back to select(*) — it ships four columns the screen never renders");
ok(/unban_phone/.test(CUSTLOG) && !/select\([^)]*unban_phone/.test(CUSTLOG), "P23602",
  "custlog: the note explaining why unban_phone is NOT fetched is gone, or it is being fetched again");
ok(!/"app\/api\/admin\/custlog\/route\.ts":/.test(API_A), "P23603",
  "the spent select(*) allowance for custlog is back in verify-admin-api-a — that file must stay named");
if (fails.length) {
  console.error(`\n✖ verify:admin-health — ${fails.length} regression${fails.length === 1 ? "" : "s"} on the admin's health, logs & limits screens:\n`);
  for (const f of fails) console.error("   " + f);
  console.error("\n   Each line names the ledger phase (.claude/sweep/LEDGER/T17.md) that found it.\n");
  process.exit(1);
}
console.log("✓ verify:admin-health — the admin's health, logs, issues & limits screens still hold their 21 fixes");
