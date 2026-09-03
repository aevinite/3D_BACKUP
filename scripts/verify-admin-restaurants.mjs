// verify:admin-restaurants — the admin's Restaurants, Owners, Settings, Billing, Recycle bin and
// platform Floor keep the promises they print on screen.
//
// WHERE THIS BITES: Admin console (/aevinite) → Restaurants · Owners · Settings · Billing & plans ·
// Recycle bin · Live floor, plus the settings cards those screens embed on Access & permissions.
//
// WHY IT EXISTS. Sweep #6 T16 found four faults there, and every one of them was a screen quietly
// disagreeing with what the code underneath actually does:
//
//   1. A control labelled "Saves on its own" lost its value when its Access row was collapsed,
//      when a second pick followed inside 600 ms, or when Discard was pressed - one shared debounce
//      timer, cleared on unmount.
//   2. A restaurant whose owner is suspended or in the recycle bin read as having NO owner, in the
//      list AND in the Owner card, because /api/admin/restaurants only lists ACTIVE owners.
//   3. Tapping a restaurant on the platform floor did nothing and said nothing when the browser
//      blocked the pop-up - the helper returns null exactly so a caller can say so.
//   4. The platform log-retention card claimed it applied to "every restaurant" with a "1-month
//      maximum". Migration 157 makes it a DEFAULT, and the manager panel still offers 3 months.
//
// Every check below is one of those, or one of the standing rules those screens have to hold.
// STATIC: it reads seven files. No browser, no database, nothing to clean up.
//
//   node scripts/verify-admin-restaurants.mjs
//   node scripts/verify-admin-restaurants.mjs <root>    # another checkout / worktree
import { readFileSync, readdirSync } from "node:fs";
import { repoRootFrom } from "./sweep/repoRoot.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The repo to scan: the first argument that really IS one, else the repo this file lives in.
// It used to be plain `process.argv[2]`, so `-- --base http://localhost:4228` — which every
// sweep lane passes to every guard — made this scan a folder called "--base" and exit 1.
// (T28, sweep #7, 2026-08-29; the same fault as verify:test-safety's, in eight more guards.)
const ROOT = repoRootFrom(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
// Comments and on-screen PROSE both contain the words these checks hunt for ("earnings", "sales",
// "payments"), so a naive grep flags this file's own explanations. Strip line comments, block
// comments and JSX comments before any wording check.
const strip = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
let failed = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); failed++; };
const want = (cond, m) => (cond ? ok(m) : bad(m));

const REST = read("app/aevinite/restaurants/page.tsx");
const OWN = read("app/aevinite/owners/page.tsx");
const SET = read("app/aevinite/settings/page.tsx");
const BILL = read("app/aevinite/billing/page.tsx");
const BIN = read("app/aevinite/recycle/page.tsx");
const FLOOR = read("app/aevinite/floor/page.tsx");
const CARD = read("components/admin/RestaurantSettings.tsx");

console.log('\nAdmin console: does each screen still do what it says on itself?');

// ── 1 · "Saves on its own" has to actually save ────────────────────────────────────────────────
console.log("\n1. Access → an embedded settings card: a discrete pick cannot be lost");
want(/const pending = useRef\(new Map</.test(CARD),
  "the auto-save keeps ONE PENDING WRITE PER KEY (a single shared timer let the second pick cancel the first)");
want(!/const autoTimer = useRef<number \| null>/.test(CARD),
  "the single shared `autoTimer` is gone");
want(/const autoSaveNow = \(k: string, v: unknown\) =>/.test(CARD),
  "there is an IMMEDIATE path for a select / radio / switch (one decision, one write)");
{
  // Every discrete control must use the immediate path, or a collapsed row eats the pick.
  const discrete = [
    [/onChange=\{\(e\) => \{ const n = Number\(e\.target\.value\); if \(!Number\.isFinite\(n\)\) return; set\(k, n\); autoSaveNow\(k, n\)/, "the number PICKER (tables per row)"],
    [/if \(opts\.auto\) autoSaveNow\(k, !on\)/, "an auto-saving SWITCH"],
    [/onChange=\{\(\) => \{ set\(k, o\.value\); autoSaveNow\(k, o\.value\); \}\}/, "a pick-one CHOICE CARD (GST mode, MRP, which screen prints)"],
  ];
  for (const [re, what] of discrete) want(re.test(CARD), `${what} saves immediately`);
}
{
  // The unmount cleanup must FLUSH what it owes, not clear it and walk away.
  const cleanup = CARD.match(/useEffect\(\(\) => \{[\s\S]{0,1600}?\}, \[postSetting\]\);/);
  want(!!cleanup && /postSetting\(k, v, true\)/.test(cleanup[0]),
    "leaving the row FLUSHES a pending write to the server instead of dropping it");
  want(!!cleanup && /keepalive/.test(CARD),
    "…and that last write is sent with keepalive, so it survives the unmount");
}
want(/const discard = \(\) => \{[\s\S]{0,400}?cancelPending\(\);/.test(CARD),
  "Discard CANCELS a pending auto-save (it used to be overtaken and write the discarded value)");
want(/if \(!alive\.current\) return;/.test(CARD),
  "a write that lands after the card is gone updates no state");

// ── 1a · the word under the control is the only report, so it has to be true ──────────────────
console.log("\n1a. Access → a self-saving control reports itself honestly, with no button");
want(/\{done \? "✓ Saved" : saving \? "Saving…" : "Saves on its own"\}/.test(CARD),
  "the line has three states: Saves on its own → Saving… → ✓ Saved");
want((CARD.match(/savedHint\(k\)/g) || []).length === 3,
  "…and ONE hint serves the number picker, the switch and the choice cards, so they cannot drift apart");
want(/const done = autoSaved === k;/.test(CARD) && /setAutoSaved\(k\);/.test(CARD)
  && CARD.indexOf("setAutoSaved(k);") > CARD.indexOf("if (!r.ok) throw new Error"),
  "\"✓ Saved\" is set only AFTER the server answered ok — never optimistically");
want(/KEYS\.filter\(\(k\) => !selfSaving\[k\] &&/.test(CARD),
  "a key a self-saving control owns is kept OUT of the Save bar, so no button appears beside it");
want(/setDraft\(\(x\) => \(\{ \.\.\.x, \[k\]: base\[k\] \}\)\);/.test(CARD)
  && /the setting was put back/.test(CARD),
  "a REFUSED save puts the control back on the stored value and says so");
{
  // A ref used as a liveness flag is a ONE-SHOT unless it is re-armed: React remounts every
  // component in development, and the first unmount left this false for good — so every state
  // update after a save was skipped and none of the three states above did anything.
  const eff = CARD.match(/useEffect\(\(\) => \{[\s\S]{0,1400}?\}, \[postSetting\]\);/);
  want(!!eff && /alive\.current = true;/.test(eff[0]) && /alive\.current = false;/.test(eff[0]),
    "the liveness ref is set TRUE on every mount, not only false on unmount (a remount used to kill it for good)");
}

// ── 1b · a brand-new restaurant's settings card must not lock itself on the first open ─────────
console.log("\n1b. Access → a settings card on a JUST-CREATED restaurant loads");
want(/let j = await fetchOnce\(\);/.test(CARD) && /await new Promise\(\(r\) => setTimeout\(r, 700\)\);\s*\n\s*j = await fetchOnce\(\);/.test(CARD),
  "the load retries ONCE before locking the form (the first load mints the QR codes and two cards racing makes one 500)");
want(/if \(j\.error \|\| !j\.settings\) \{ setLoadErr\(true\); return; \}/.test(CARD),
  "…and a second failure still locks the card and still says so, so a real outage is not hidden");

// ── 2 · an owner who cannot sign in is still an owner ──────────────────────────────────────────
console.log("\n2. Restaurants: a suspended or binned owner must not read as no owner");
want(/owners\.find\(\(o\) => o\.id === r\.ownerUserId\)/.test(REST),
  "the list's Owner column resolves the ASSIGNED id, not just the name the API could resolve");
want(/assigned · not active/.test(REST),
  "…and says 'assigned · not active' rather than the same '—' a genuinely ownerless restaurant shows");
want(/const assignedUnknown = !!sel && !owners\.some\(\(o\) => o\.id === sel\)/.test(REST),
  "the Owner card knows when its assignee is missing from the (active-only) options");
want(/\{assignedUnknown && <option value=\{sel\}>/.test(REST),
  "…and renders a real option for them, so the box can never display '— no owner —' instead");
want(/suspended or in the recycle bin/.test(REST),
  "…and explains where that owner actually is");

// ── 3 · a tap on the platform floor must never vanish ─────────────────────────────────────────
console.log("\n3. Live floor: opening a restaurant either opens it or says why not");
{
  const raw = FLOOR.match(/onClick=\{\(\) => openRestaurantPanel\(/g) || [];
  want(raw.length === 0,
    "no door on this page throws away the window handle (the helper returns null on a blocked pop-up)");
  // Shape-tolerant on purpose: sweep #7 item 8 ADDED `active` to what travels with a blocked
  // restaurant, and an exact-shape regex turned that widening into a red guard. What matters is
  // that there is ONE awaited opener and that a null handle opens the card.
  want(/const openPanel = useCallback\(async \(r: \{ id: string; name: string; slug: string[^}]*\}\)/.test(FLOOR),
    "every door goes through ONE opener that awaits the handle");
  want(/if \(!w\) setBlocked\(\{ rid: r\.id, name: r\.name, slug: r\.slug/.test(FLOOR),
    "…and a null handle opens the card that gets him in anyway (see 3a)");
  want(/catch \(e\) \{\s*toast\(/.test(FLOOR),
    "…and a thrown error is reported too, never swallowed");
  const doors = (FLOOR.match(/onClick=\{\(\) => openPanel\(r\)\}/g) || []).length;
  want(doors >= 4, `all ${doors} restaurant doors use it (expected at least 4)`);
}

// ── 3a · a blocked tab is not a locked door ───────────────────────────────────────────────────
console.log("\n3a. Live floor: a blocked new tab still gets the admin in");
want(/function BlockedDoor\(/.test(FLOOR),
  "a blocked pop-up opens a card, not a bare refusal toast");
want(!/allow pop-ups for this site/.test(strip(FLOOR)),
  "…and the old \"allow pop-ups, then tap again\" wording is gone (the admin reaches every restaurant)");
want(/nothing else is in the way/.test(FLOOR),
  "…the card says nothing is stopping him");
want(/api\/admin\/act-as\/go\?rid=\$\{encodeURIComponent\(r\.rid\)\}/.test(FLOOR),
  "…it offers the manager panel IN THIS TAB, which needs no pop-up at all");
want(/\/aevinite\/restaurants\?focus=\$\{encodeURIComponent\(r\.slug\)\}/.test(FLOOR)
  && /go to its details &amp; settings/.test(FLOOR),
  "…and the line at the bottom goes to that restaurant's details & settings");
want(/useAdminModal\(ref, "adm-floor-blocked", onClose\)/.test(FLOOR),
  "…and it is a real dialog: Escape, phone Back, focus trap, scroll lock");

// ── 3b · a tile must stay inside its own square, whatever the label turns out to be ───────────
console.log("\n3b. Live floor: a label that is not a table number cannot smear over its neighbours");
want(/const long = String\(t\.n\)\.length > 3;/.test(FLOOR),
  "a tile knows when its label is longer than the square was built for");
want(/long \? "…" \+ String\(t\.n\)\.slice\(-2\)/.test(FLOOR),
  "…and shows a shortened form with a leading ellipsis, never a value pretending to be whole");
want(/overflow: "hidden",\s*\n\s*\.\.\.\(long \? \{ fontSize: 7 \} : null\)/.test(FLOOR),
  "…and the square clips, so nothing can ever bleed into the tile beside it again");
want(/title=\{`Table \$\{t\.n\}/.test(FLOOR),
  "…while the FULL label stays in the tooltip, so nothing is lost");

// ── 4 · the retention card must describe what the code ACTUALLY does ───────────────────────────
// THIS CARD HAS BEEN WRONG IN BOTH DIRECTIONS, AND SO WAS THIS PHASE (rewritten 2026-08-21).
//
// First the screen claimed a "1-month MAXIMUM" applied "to every restaurant" — it enforced no
// maximum at all. The T16 sweep over-corrected it to "the default for every restaurant that hasn't
// chosen its own", and THIS PHASE WAS WRITTEN TO ENFORCE THAT WORDING — which is also untrue:
// POST /api/admin/settings ends in `update(patch).not("restaurant_id","is",null)`, so saving here
// rewrites EVERY restaurant's window on the spot, including the ones that had chosen. PR #1076
// corrected the screen to say exactly that and added the lock; this phase was left behind asserting
// the retired wording, so it had been RED on a clean main ever since — which is worse than no check,
// because a real regression here arrives as more of the same noise.
//
// So the checks now hang off the CODE, not off a remembered sentence: the claim on screen and the
// write in the route have to agree, whichever way the wording goes next.
console.log("\n4. Settings: the log-retention card says what the code actually does");
const SET_ROUTE = read("app/api/admin/settings/route.ts");
// The fact everything else depends on: saving really does write every restaurant.
want(/\.update\(patch\)\.not\("restaurant_id", "is", null\)/.test(SET_ROUTE),
  "saving retention still writes EVERY restaurant (the sentence on screen depends on this)");
want(/applies the window to every restaurant straight away/.test(strip(SET)),
  "…and the card says so, in those words");
// The two claims that were each false in their turn. Neither may come back.
want(!/1-month maximum/.test(SET),
  "the false '1-month maximum' cap claim has not come back");
want(!/hasn't chosen its own/.test(strip(SET)),
  "…nor the false 'only a default for restaurants that haven't chosen' claim");
// His ask for the lock (2026-08-21): a lock the restaurant can SEE, not a hidden platform cap.
want(/retention_lock/.test(SET_ROUTE) && /Lock this for every restaurant/.test(SET),
  "the lock exists and is offered on the card");
want(/return NextResponse\.json\(\{ ok: true, retentionLock: lockWrote \}\)/.test(SET_ROUTE),
  "…and toggling the lock RETURNS before the retention write, so it never rewrites the windows as a side effect");

// ── 5 · a part-failed multi-attach must not lie about what landed ──────────────────────────────
console.log("\n5. Owners: attaching several restaurants reports what really happened");
{
  const fn = OWN.match(/const assignRestaurants = async[\s\S]{0,900}?\n  \};/);
  want(!!fn, "assignRestaurants owns its own loop (not run(), which skips the refresh on a throw)");
  want(!!fn && /onChanged\(\);/.test(fn[0]), "…and refreshes the pane whether or not one attach failed");
  want(!!fn && /Attached \$\{done\} of \$\{ids\.length\}/.test(fn[0]), "…and says how many of how many landed");
}

// ── 6 · the guest link on the create form is the real address ──────────────────────────────────
console.log("\n6. Restaurants → New restaurant: the previewed guest link is the one that will exist");
want(/takenSlugs: string\[\]/.test(REST), "the create card is given the slugs already in use");
want(/for \(let i = 2; slugTaken\.has\(slugPreview\); i\+\+\)/.test(REST),
  "…and applies the SAME numeric-suffix loop the create route applies");
want(/slugSuffixed/.test(REST), "…and says so on screen when the typed name had to be suffixed");

// ── 6b · the create form asks the one question that matters, and states the rest ───────────────
console.log("\n6b. Restaurants → New restaurant: no question that decides nothing");
{
  // Scoped to the create form: "Manager panel" is a legitimate DOOR label on a restaurant's own
  // detail page, and that door is exactly the thing the admin still needs.
  const form = (strip(REST).match(/function NewRestaurant\([\s\S]*?\n\}/) || [""])[0];
  want(!/NR_PANELS/.test(strip(REST)) && !/Manager panel|Kitchen display|Waiter tablet|Owner dashboard/.test(form),
    "the four panel switches are gone from the create form — they decided no panel, only which starter logins were minted");
}
want(/const STARTER_LOGINS: Record<string, boolean> = \{ manager: true, kitchen: true, tablet: true, owner: false \}/.test(REST),
  "…replaced by a FIXED set: a login for each of the three staff screens");
want(/owner: false/.test(REST) && /an owner is a person/i.test(REST),
  "…and NO owner login, so no placeholder primary owner is planted on a new restaurant");
want(!/nr-preset/.test(strip(REST)) && !/My saved setup/.test(strip(REST)),
  "the saved-setup dropdown went with them (it chose between two presets of one switch)");
want(!/Turn on at least one panel/.test(strip(REST)),
  "…and a create can no longer be refused over a panel choice that changes no panel");
want(/All four staff apps/.test(REST) && /No owner yet/.test(REST) && /The standard permissions/.test(REST),
  "the form STATES what a restaurant starts with instead of pretending to ask");
want(/Start with a sample menu/.test(REST),
  "the one real choice — a sample menu or an empty one — survives");

// ── 7 · the admin's own income figure names what it counted ────────────────────────────────────
console.log("\n7. Billing & plans: 'Collected this year' cannot silently omit money");
want(/otherCollected/.test(BILL), "non-rupee payments are totalled per currency from the rows on screen");
want(/not counted above/.test(BILL), "…and named under the tile when there are any");

// ── 7b · what a table rename does to the PAPER (owner rule, 2026-07-29) ───────────────────────
console.log("\n7b. Table setting: the card describes what a rename really does");
want(!/bills\s*&amp;\s*QR codes keep the number|bills and QR codes keep the number/.test(CARD),
  "the card no longer claims a bill keeps the table NUMBER when a table has been renamed");
want(/what the bill and the kitchen ticket print/.test(CARD),
  "…it says the name is what the bill and the kitchen ticket print (PRs #547/#548)");
want(/QR code keeps the number/.test(CARD),
  "…and that the QR code alone keeps the number, which is the half that was already true");

// ── 8 · a declaration that loses to another rule is a declaration that does nothing ───────────
console.log("\n8. Phone polish the code already asked for");
want(/\.adx \.floor-gate \.floor-gate-btn \{[^}]*min-height: 44px/.test(FLOOR),
  "the floor gate's only button keeps its own 44px floor (a one-class selector lost to the platform's 40px)");
want(!/width: "min\(96vw/.test(BILL) && /width: "min\(100%, 560px\)"/.test(BILL),
  "the billing editor's card is inset by its wrapper's padding instead of poking off a 360px screen");
want(!/min\(96vw/.test(OWN),
  "…and so is every dialog on the owners page");

// ── STANDING RULES these screens have to keep ─────────────────────────────────────────────────
console.log("\nStanding rules");
{
  // The admin console shows NO restaurant earnings. The platform floor is the screen most likely
  // to grow one, since it already counts orders, bills and cancellations.
  // CODE only, not prose: a money figure needs a formatter or a money-bearing field name.
  const money = /₹|style: "currency"|Intl\.NumberFormat|\b(total_amount|grand_total|net_sales|revenue|gmv|earnings)\b/i;
  want(!money.test(strip(FLOOR)), "the platform floor still shows no restaurant money of any kind");
  want(!money.test(strip(REST)), "the restaurants list and detail still show no restaurant money");
  want(!money.test(strip(OWN)), "the owners roster still shows no restaurant money");
}
{
  // The four backend-only flags stay invisible in every UI.
  const hidden = ["verification", "aggregators", "gst_invoice"];
  const files = { REST, OWN, SET, BILL, BIN, FLOOR, CARD };
  const leak = [];
  for (const [n, src] of Object.entries(files)) for (const f of hidden) if (new RegExp(`["'\`]${f}["'\`]`).test(src)) leak.push(`${n}:${f}`);
  want(leak.length === 0, `the backend-only feature flags appear in none of these screens${leak.length ? " — " + leak.join(", ") : ""}`);
}
want(/const DEFAULT_RID = "00000000-0000-0000-0000-000000000001"/.test(REST)
  && read("app/api/admin/restaurants/route.ts").includes("00000000-0000-0000-0000-000000000001"),
  "the page and the route agree on which restaurant can never be deleted");
want(!/window\.confirm|window\.prompt/.test(OWN),
  "the owners page still uses on-theme dialogs, never a browser confirm/prompt (owner, 2026-07-26)");
want(/data-owner=\{o\.username\}/.test(BIN),
  "a recycle-bin owner row still carries the data-owner hook a checker acts on");
// ── THE RECYCLE BIN'S RULES, AFTER THE 90-DAY WAIT WAS REMOVED (owner, 2026-08-20) ─────────────
// The old check here asserted the OPPOSITE — that the bin locks a permanent removal behind a
// retention date. He removed that lock deliberately, so this now guards the rails that DID survive,
// which is where the safety actually lived all along.
want(!/Purge locked until|purgeEligibleAt|days? left/i.test(BIN),
  "the recycle bin no longer counts down to a permission — the 90-day wait is gone (owner, 2026-08-20)");
want(/RETENTION_DAYS = 0/.test(read("app/api/admin/restaurants/route.ts"))
  && /RETENTION_DAYS = 0/.test(read("app/api/admin/owners/route.ts")),
  "both purge routes agree there is no waiting period");
{
  // Comments-stripped, so a migration's own explanation of what it REMOVED (which quotes the old
  // code) can never be mistaken for the code still being there.
  const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const mig342 = strip(read("supabase/migrations/342_the_recycle_bin_stops_holding_the_door.sql"));
  want(/CREATE OR REPLACE FUNCTION admin_purge_restaurant/i.test(mig342) && !/Retention lock/i.test(mig342),
    "migration 342 rewrites admin_purge_restaurant with no retention lock left in it");

  // ── THE MONEY CHECK FOLLOWS THE PURGE THAT SHIPS, NOT MIGRATION 342 (2026-08-21) ────────────
  // This block used to read 342's text for all three checks. admin_purge_restaurant has been
  // rewritten twice since — 345 added the operational tables, 346 the printing setup — so from 345
  // onwards the promise printed in docs/COMPLIANCE-GUARDRAILS.md §3 ("guarded by
  // verify:admin-restaurants") was not the promise being checked: a later rewrite could have added
  // `delete from orders` and this stayed green. The RULES check stays on 342, which is where the
  // owner's 2026-08-20 decision was made; the MONEY check moves to the newest definition, which is
  // the only one that can actually erase anything.
  const purgeMigs = readdirSync(join(ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql") && /FUNCTION\s+(public\.)?admin_purge_restaurant/i.test(read(`supabase/migrations/${f}`)))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const livePurge = purgeMigs.at(-1);
  want(!!livePurge && parseInt(livePurge, 10) >= 342,
    `the newest migration defining admin_purge_restaurant was found (${livePurge || "none"})`);
  const rules342 = /never be purged/i.test(mig342) && /not in the recycle bin/i.test(mig342) && /already been purged/i.test(mig342);
  want(rules342,
    "migration 342 keeps the three rules that were never in question: not the default, not before binning, not twice");
  const MONEY = ["orders", "order_items", "sessions", "payments", "session_payments",
                 "credit_notes", "invoice_events", "deletion_audit", "bill_chain"];
  const liveBody = strip(read(`supabase/migrations/${livePurge}`));
  const kills = MONEY.filter((t) => new RegExp(`delete\\s+from\\s+${t}\\b`, "i").test(liveBody));
  want(kills.length === 0,
    `the purge that ships (${livePurge}) deletes no money — a sale can never disappear (COMPLIANCE-GUARDRAILS §3.0)${kills.length ? ` — but it deletes ${kills.join(", ")}` : ""}`);
}
want(/nameMatches/.test(BIN) && /Type <b/.test(BIN),
  "a permanent removal still demands the exact name typed — that is what stops an accident now");
want(/wantBackup/.test(BIN) && /restaurants\/export/.test(BIN),
  "a permanent removal still offers to download the full backup first");
want(/bills, invoices, payments and the removals record are kept/.test(BIN),
  "the bin still states out loud that removing a restaurant does not erase its sales");
// ── SEEING INSIDE A BINNED THING, AND WALKING INTO IT (owner, 2026-08-20) ──────────────────────
want(/bin_detail=/.test(BIN),
  "a bin row can be opened to see what is actually inside it");
want(/openRestaurantPanel\(/.test(BIN),
  "a bin row can open the restaurant's own panels — the 'visit there panel too' ask");
want(/openRestaurantPanel\([^)]*true\)/.test(BIN),
  "the bin passes the fromBin opt-in, without which act-as still refuses a binned restaurant");
{
  // The clash question, not a silent rename. Both halves: the server must ANSWER 409 + conflict,
  // and the screen must OPEN a chooser rather than swallowing it.
  const RR = read("app/api/admin/restaurants/route.ts");
  want(/conflict: \{/.test(RR) && /status: 409/.test(RR),
    "restoring a restaurant whose web address was taken asks instead of renaming it silently");
  want(!/renamed = slug;\s*$/m.test(RR),
    "the old silent auto-rename on restore is gone");
  want(/SlugClashDialog/.test(BIN) && /Change name & restore/.test(BIN),
    "the bin shows the two ways out he named: close, or change the name and restore");
}
{
  // Precise version of "it cannot make a sale disappear": every endpoint this screen calls.
  const calls = [...strip(BIN).matchAll(/fetch\(\s*[`"']([^`"'?]+)/g)].map((m) => m[1]);
  const allowed = ["/api/admin/restaurants", "/api/admin/owners", "/api/admin/restaurants/export"];
  const stray = calls.filter((c) => !allowed.includes(c));
  want(stray.length === 0,
    `the recycle bin calls only the restaurant/owner bin endpoints${stray.length ? " — stray: " + stray.join(", ") : ""}`);
}
want(/clampPerRow|FLOOR_PER_ROW_MIN, FLOOR_PER_ROW_MAX/.test(CARD),
  "tables per row is still bounded by lib/floorLayout, not a free number box");
want(/Admin only:/.test(CARD) && /table QR links at all/.test(CARD),
  "the QR card still says out loud that it is the only place table codes live");

{
  // ── the three round-3 fixes (2026-08-20) ────────────────────────────────────────────────────
  // A locked field must not need a tooltip to be readable. The name was clipped with an ellipsis
  // and the only way to read it was a native title — which always draws down-and-right, onto the
  // Role picker (owner, with a screenshot). Both halves are guarded: no clipping, name-first title.
  const USERS = read("app/aevinite/users/page.tsx");
  const lockedBox = (USERS.match(/\{scopedName \? \([\s\S]{0,1400}?\n {10}\) : \(/) || [""])[0];
  want(!/whiteSpace: "nowrap"/.test(lockedBox) && !/textOverflow: "ellipsis"/.test(lockedBox),
    "the locked Restaurant field shows the whole name instead of clipping it with an ellipsis");
  want(/title=\{`\$\{scopedName\}/.test(lockedBox),
    "…and its tooltip LEADS with the restaurant name, not with the reason it is locked");

  // The QR minting race that handed onboarding a locked settings card. A pkey clash means the
  // other request already minted that table — it must be ignored, never re-minted and retried.
  const SET = read("app/api/admin/restaurants/settings/route.ts");
  want(/onConflict: "restaurant_id,table_number", ignoreDuplicates: true/.test(SET),
    "a table QR code that another request already minted is accepted, not treated as a failure");
  want(/\.in\("table_number", stillMissing\)/.test(SET),
    "…and the loser of that race re-reads only the rows it lacks, never the whole table");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SWEEP #7, T16 (2026-08-27) — eleven more places where a screen said one thing and did another.
// Each `want` below is one numbered item from that run's report; reverting the fix turns it red.
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Comments quote the OLD wording on purpose, so these read against the comment-stripped source:
// an obituary must never be able to fail the check that killed the thing it describes.
const noComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const RESTn = noComments(REST), OWNn = noComments(OWN), BINn = noComments(BIN), FLOORn = noComments(FLOOR);

console.log("\n11. Owners: one delete must not disable every button on the next person");
{
  // `busy` is the PAGE's state, shared by the roster and the detail pane. doDelete() released it
  // only in its catch, so a delete that WORKED left it true for good: the admin picked the next
  // owner and Rename, Reset password, Suspend, Assign restaurant, Make primary and Remove were all
  // greyed out, with nothing saying why. Only a reload cleared it. (item 1.)
  const del = (OWN.match(/async function doDelete\(\)[\s\S]*?\n  \}/) || [""])[0];
  const inFinally = /finally \{ setBusy\(false\); \}/.test(del);
  const outsideCatch = /setBusy\(false\)/.test(del.replace(/catch\s*\([^)]*\)\s*\{[^}]*\}/g, ""));
  want(inFinally || outsideCatch,
    "a SUCCESSFUL owner delete hands `busy` back, so the next owner's buttons still work");
  want(/busy=\{busy\} setBusy=\{setBusy\}/.test(OWN),
    "…and `busy` really is the page-wide flag those buttons read (which is why it matters)");
}

console.log("\n12. Deleting says what the recycle bin actually does (migration 342 removed the wait)");
{
  // All three read "recycle bin for 90 days … only after that can it be permanently removed".
  // The owner removed that wait on 2026-08-20 and mig 342 dropped the database's half of it, so
  // the sentence promised three months of safety that nothing enforces — read at the moment
  // somebody deletes a paying client's restaurant. (item 2.)
  want(!/90 days/.test(RESTn),
    "the restaurant Danger zone no longer promises a 90-day protection window");
  want(!/(restorable|restored) for 90 days/i.test(OWNn) && !/only after 90 days/i.test(OWNn),
    "…and neither does the Owners danger zone or its delete dialog");
  want(/there is no waiting period/i.test(BINn),
    "…and the recycle bin still states the truth they now agree with");
}

console.log("\n13. Billing: money the platform collected is either counted or named");
{
  // A currency stored as "inr" fell through BOTH halves: the server's total matched "INR"
  // exactly, and the page upper-cased before asking "is it something else?" — so it was neither
  // added up nor listed under "not counted above", while the row itself still printed ₹. (item 3.)
  want(/const canon = \(c: string \| null \| undefined\) => \(c \|\| "INR"\)\.trim\(\)\.toUpperCase\(\) \|\| "INR";/.test(BILL),
    "the currency is folded to one canonical form before anything is compared");
  want(/const byCurrency = \(rows \|\| \[\]\)\.reduce/.test(BILL) && /canon\(r\.currency\)/.test(BILL),
    "…and ONE grouping pass produces both the rupee total and the excluded list");
  want(/money\(rupeesCollected, "INR"\)/.test(BILL),
    "…so the tile is summed from the same rows the table shows, and cannot disagree with them");
  want(/currency: currency\.trim\(\)\.toUpperCase\(\) \|\| "INR"/.test(BILL),
    "…and the editor sends a normalised code, so no new row can be stored in the broken shape");
}

console.log("\n14. A control that promises a default falls back to it");
{
  // "nothing set = 4", but clearing the box left "" in table_seats and the route's
  // Math.round(Number("")) → 0 → clamp(1..30) stored ONE seat. (item 4.)
  want(/const settleSeat = \(t: number, v: string\) => \{[\s\S]{0,300}delete next\[String\(t\)\];/.test(CARD),
    "clearing a table's seat box REMOVES its entry, so the readers fall back to 4");
  want(/onBlur=\{\(e\) => settleSeat\(t, e\.target\.value\)\}/.test(CARD),
    "…on blur, so the box can be emptied and retyped without refilling under the cursor");
}

console.log("\n15. An owner you just created is never missing from the list");
{
  // Only "Done" called onCreated(), which is what reloads the roster. Escape, phone Back and the
  // scrim just hid the card — so a created owner was absent until a reload. (item 5.)
  want(/const close = \(\) => \{ if \(reveal\) onCreated\(reveal\.id\); else onClose\(\); \};/.test(OWN),
    "every exit from the New-owner dialog reports a created owner");
  want(/useAdminModal\(dialogRef, "admin-new-owner", close\)/.test(OWN),
    "…including Escape and the phone Back button");
  want(/<div onClick=\{close\} style=\{\{ position: "fixed", inset: 0, background: "rgba\(2,6,16,0\.66\)", backdropFilter: "blur\(2px\)"/.test(OWN),
    "…and a tap on the scrim");
}

console.log("\n16. A refused ticket change says why instead of quietly undoing itself");
{
  // The chip flipped optimistically and a refusal called load(), which put it back with no
  // reason given — a tap that appeared to work and then reversed. (item 6.)
  const st = (REST.match(/const setStatus = async[\s\S]*?\n  \};/) || [""])[0];
  want(/const refused = \(why: string\) => \{[\s\S]{0,400}setNote\(/.test(st),
    "a refusal is captured with the server's own reason");
  want((REST.match(/\{refusalNote\}/g) || []).length === 2,
    "…and rendered in BOTH shapes of the Tickets card, compact and full");
}

console.log("\n17. A blocked tab takes the admin in — it never tells him to change his browser");
{
  // The owner ruled on this wording for the platform floor on 2026-08-20: "admin has access to
  // everything, so it shouldn't be 'you can't access the restaurant' — it should take you to the
  // restaurant". Five places still said "allow pop-ups for this site". (item 7.)
  want(!/allow pop-ups for this site/i.test(RESTn) && !/allow pop-ups for this site/i.test(BINn)
    && !/allow pop-ups for this site/i.test(FLOORn),
    "no screen in this territory answers a blocked tab with a browser-settings instruction");
  want(/const hereHref = \(path: string\) =>\s*`\/api\/admin\/act-as\/go\?rid=/.test(REST),
    "the restaurant's Enter card offers the SAME panel in this tab (an ordinary navigation)");
  want(/function BlockedHere\(/.test(BIN) && /hereHref\(r\.id, p\.to, \{ bin: true \}\)/.test(BIN),
    "…and the recycle bin does too, carrying its bin=1 opt-in");
  want(!/setInsideErr\("Your browser blocked/.test(BIN),
    "…and the bin's blocked-tab message no longer lands in the slot whose Retry re-reads the counts");
  want(/function BlockedDoor/.test(FLOOR),
    "…and the platform floor's own card, which set the pattern, is still there");
}

console.log("\n18. …and that card never offers a guest menu that is switched off");
{
  // A suspended restaurant's guest menu is offline; the card offered it anyway. (item 8.)
  want(/const \[blocked, setBlocked\] = useState<\{ rid: string; name: string; slug: string; active: boolean \} \| null>/.test(FLOOR),
    "the platform floor's blocked-tab card knows whether the restaurant is live");
  want(/Guest menu offline/.test(FLOOR),
    "…and says so instead of linking to a menu that will refuse");
}

console.log("\n19. The QR sheet names any table it could not print");
{
  // A table with no code was skipped and the sheet came out one QR short, silently. (item 9.)
  want(/const missing: number\[\] = \[\];/.test(CARD) && /missing\.push\(t\); continue;/.test(CARD),
    "the print sheet records the tables it had no code for");
  want(/if \(missing\.length\) \{[\s\S]{0,300}setErr\(/.test(CARD),
    "…and names them afterwards instead of printing a short sheet in silence");
  want(!/is HANDOFF H3/.test(CARD),
    "…and the note beside it no longer asks for the route upsert that already shipped");
}

console.log("\n20. Billing: a refused payment delete is said beside the payment rows");
{
  // It used to land next to "Add payment", a section up and often off-screen. (item 10.)
  const del = (BILL.match(/const deletePayment = async[\s\S]*?\n  \};/) || [""])[0];
  want(/setHistMsg\(/.test(del), "the delete result has its own line");
  want(BILL.indexOf("Payment history") < BILL.indexOf("{histMsg && ("),
    "…rendered under the Payment history heading, where the bin the admin pressed is");
}

console.log("\n21. The recycle bin carries no permission flag that can only say yes");
{
  // `canPurge` was always true after mig 342 and read by nothing — a dead permission beside a
  // permanent delete is the kind of thing a later reader wires back up. (item 11.)
  want(!/canPurge: boolean/.test(BIN), "`canPurge` is gone from both bin row types");
  want(/daysHeld: number/.test(BIN), "…while `daysHeld`, which is a fact rather than a permission, stays");
}


console.log("\n22. Suspend is described by what it actually stops");
{
  // The suspended line said "the guest menu is offline AND STAFF CAN'T LOG IN". That is the
  // recycle BIN's behaviour: soft_delete writes deleted_at and /api/panel-login refuses on it.
  // Suspend writes only `restaurants.active`, which the tenant resolver reads for the GUEST menu
  // — nothing on the staff sign-in path reads it. (item 12.)
  want(!/The guest menu is offline and staff can't log in/.test(RESTn),
    "the suspended-state line no longer claims suspending stops the restaurant's own staff signing in");
  want(/Its own staff can still sign in to their panels/.test(REST),
    "…and says what suspend really does, and which step does stop them");
  const LOGIN = read("app/api/panel-login/route.ts");
  want(/isRestaurantDeleted\(/.test(LOGIN) && !/\.active\b[^)]*restaurant/.test(LOGIN),
    "…which is still true of the sign-in path: it refuses a BINNED restaurant, and reads no `active` flag");
  want(/staff can&apos;t log in/.test(REST) || /staff can't log in/.test(REST),
    "…and the DELETE paragraph, where that sentence IS true, still carries it");
}


console.log("\n23. The reused-address notice says what really happened to the previous occupant");
{
  // It said "until it went to the recycle bin on <date>". A previous occupant may have been
  // REMOVED FOR GOOD since, and that sentence then sent the admin looking for it in a bin it is
  // not in. The date the server sends is when it left, which is true either way. (item 13.)
  want(!/until it went to the\s*\n?\s*recycle bin on/.test(REST),
    "the notice no longer says the previous occupant is sitting in the recycle bin");
  want(/removed on \{new Date\(done\.reusedAddress\.binnedOn\)/.test(REST),
    "…it says it was removed on that date, which holds whether it was binned or removed for good");
}


console.log("\n24. The health chips clear when the lit one is tapped again");
{
  // It used to set the same filter again, so the only way back to the whole list was to find the
  // "All" chip — while the KPI tiles on Owners, the other filter row in this console, have
  // toggled back since they were built. Nothing was unreachable; the two rows behaved
  // differently. (item 15.)
  want(/setHealthFilter\(\(cur\) => \(cur === key && key !== "all" \? "all" : key\)\)/.test(REST),
    "tapping the lit health chip goes back to All");
  want(/key !== "all"/.test(REST),
    "…and the All chip itself is excluded, so tapping lit-All stays All rather than flipping");
  want(/aria-pressed=\{on\}/.test(REST),
    "…and each chip reports its pressed state, the way the Owners tiles already do");
  // the row it is being made consistent WITH must still behave that way
  want(/const setF = \(f: Filter\) => setFilter\(\(cur\) => \(cur === f \? "all" : f\)\)/.test(OWN),
    "…and the Owners KPI tiles, the pattern this follows, still toggle back too");
}


console.log("\n25. Billing: a typed amount is a NUMBER or it is refused — never invented");
{
  // The old parser stripped every character that was not a digit, a dot or a minus and took what
  // was left: "abc" and "₹" became 0, and "x1y2" became 12. None reached the route's own refusal,
  // because that only fires when the parse returns null — so a typo was stored as a ₹0 (comped)
  // or ₹12 plan and the screen said "Saved." (item 16.)
  const BAPI = read("app/api/admin/billing/route.ts");
  want(/const cleaned = String\(v\)\.trim\(\)\.replace\(\/\[\\s,\]\/g, ""\)\.replace\(\/\^\[₹\$€£\]\/, ""\);/.test(BAPI),
    "the route strips only what is typed AROUND a number — spaces, thousands separators, a currency symbol");
  want(/if \(!\/\^-\?\\d\+\(\\\.\\d\+\)\?\$\/\.test\(cleaned\)\) return null;/.test(BAPI),
    "…and then requires what is left to BE a number, instead of taking whatever survived");
  want(!/Number\(String\(v\)\.replace\(\/\[\^0-9\.-\]\/g, ""\)\)/.test(BAPI),
    "…and the strip-everything-else parse is gone");
  want(/Amount isn't a valid number/.test(BAPI),
    "…so the refusal it was always meant to reach can actually fire");
  want(/A plan can be 0 \(free\/comped\)/.test(BAPI),
    "…while a DELIBERATE 0 is still allowed, which is why a typo landing on 0 was invisible");
  // the same rule on the payment box, which had the same shape
  const BPAGE = read("app/aevinite/billing/page.tsx");
  want(/const cleaned = String\(payAmount\)\.trim\(\)\.replace\(\/\[\\s,\]\/g, ""\)/.test(BPAGE),
    "…and the Add-a-payment box parses by the same rule, so it cannot record a ₹12 typo either");
  want(!/Number\(String\(payAmount\)\.replace\(\/\[\^0-9\.-\]\/g, ""\)\)/.test(BPAGE),
    "…and its strip-everything-else parse is gone too");
}

console.log("\n26. Every platform-wide read behind these screens has a ceiling");
{
  // The sibling billing route was bounded on 2026-08-04 with the reasoning "one row per restaurant
  // makes it small today, but it grows with exactly the number this product is built to increase".
  // Four reads in the restaurants route were left without one. Egress is this product's cost.
  // (item 17.)
  // ── TWO FAULTS IN THIS CHECK ITSELF, BOTH FOUND 2026-09-03 ──────────────────────────────────
  // (a) `.range()` IS A CEILING. This was written when every bounded read here ended in `.limit()`.
  //     On 2026-08-31 the four reads in restaurants/route.ts moved onto lib/pageAll (the long note
  //     at that call site records it: T16 wanted `.limit(2000)`, T20 wanted paging, PAGING WON), so
  //     the check went red over code that is MORE bounded than what it demanded — pageAll caps at
  //     PAGE_ALL_MAX (50,000) and REFUSES past it, where `.limit()` silently truncates. All the
  //     while verify-read-guards.mjs:353 was praising those same reads for paging, so two guards
  //     disagreed about one file and the product was right either way. The rule is "has a ceiling",
  //     not "spells it `.limit(`" — so `.range(` counts, the vocabulary verify-scoped-reads.mjs
  //     already settled on (its BOUND, line 161). Paging cannot work without `.range()`, so naming
  //     the helpers too would add nothing: `pageAll` sits BEFORE `.from(` and never lands in `q`.
  // (b) THE WINDOW USED TO BORROW THE NEXT READ'S CEILING, which is how (a) stayed hidden. `q` ran
  //     to the first `;`, and a Promise.all of reads has none until the last one closes — so one
  //     read's 400 characters swallowed its neighbours. Deleting `.limit(2000)` from billing's
  //     `plans` read was invisible: the window picked up the `.limit(5000)` on the `yearPayments`
  //     line below it and called plans bounded. Stopping at the next `.from("` keeps each read
  //     answering for itself. Re-check by DELETING a `.limit()` here — this must go red.
  const unbounded = [];
  for (const f of [
    "app/api/admin/restaurants/route.ts", "app/api/admin/restaurants/settings/route.ts",
    "app/api/admin/restaurants/export/route.ts", "app/api/admin/owners/route.ts",
    "app/api/admin/cancelled-today/route.ts", "app/api/admin/maintenance/route.ts",
    "app/api/admin/billing/route.ts", "app/api/admin/floor/route.ts",
  ]) {
    const src = read(f);
    for (const m of src.matchAll(/\.from\("([a-z_]+)"\)([\s\S]{0,400}?)(?=;|\.from\("|\n\s*(?:const|let|if|return|await|\}))/g)) {
      const q = m[2];
      if (!/\.select\(/.test(q)) continue;
      if (/\.limit\(|\.range\(|maybeSingle\(\)|\.single\(\)|count:|head: true/.test(q)) continue;
      if (/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(q)) continue;
      unbounded.push(f.split("/").slice(-2).join("/") + " · " + m[1]);
    }
  }
  want(unbounded.length === 0,
    unbounded.length === 0
      ? "every list read behind the admin's restaurants, owners, billing, bin and floor is bounded"
      : "unbounded list read(s): " + unbounded.join(", "));
}

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — an admin screen is claiming something it does not do\n`
  : "\n✓ every admin screen still keeps the promise it prints on itself\n");
process.exit(failed ? 1 : 0);
