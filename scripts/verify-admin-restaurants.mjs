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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
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
  want(/const openPanel = useCallback\(async \(r: \{ id: string; name: string; slug: string \}\)/.test(FLOOR),
    "every door goes through ONE opener that awaits the handle");
  want(/if \(!w\) setBlocked\(\{ rid: r\.id, name: r\.name, slug: r\.slug \}\);/.test(FLOOR),
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

// ── 4 · the retention card cannot overstate itself ─────────────────────────────────────────────
console.log("\n4. Settings: log retention is a DEFAULT, and it caps nothing");
want(!/applied to every restaurant/.test(strip(SET)),
  "the saved message no longer claims it was applied to every restaurant");
want(/default for every restaurant that hasn't chosen its own/.test(SET),
  "…it says it is the default for restaurants that have not chosen their own");
want(/platform default/.test(SET),
  "the card is titled as the platform DEFAULT");
want(!/1-month maximum/.test(SET),
  "the false '1-month maximum' claim is gone");
want(/3 months/.test(SET) && /does not cap it/.test(SET),
  "…and the screen says a restaurant's own choice goes to 3 months and is not capped by this");

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
  // Comments-stripped, so the migration's own explanation of what it REMOVED (which quotes the old
  // code) can never be mistaken for the code still being there.
  const mig342 = read("supabase/migrations/342_the_recycle_bin_stops_holding_the_door.sql")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  want(/CREATE OR REPLACE FUNCTION admin_purge_restaurant/i.test(mig342) && !/Retention lock/i.test(mig342),
    "migration 342 rewrites admin_purge_restaurant with no retention lock left in it");
  want(/never be purged/i.test(mig342) && /not in the recycle bin/i.test(mig342) && /already been purged/i.test(mig342),
    "migration 342 keeps the three rules that were never in question: not the default, not before binning, not twice");
  want(!/delete from (orders|order_items|sessions|payments|session_payments|credit_notes|invoice_events|deletion_audit)\b/i.test(mig342),
    "migration 342 still deletes no money — a sale can never disappear (COMPLIANCE-GUARDRAILS §3.0)");
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
console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — an admin screen is claiming something it does not do\n`
  : "\n✓ every admin screen still keeps the promise it prints on itself\n");
process.exit(failed ? 1 : 0);
