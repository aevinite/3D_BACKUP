// verify-owner-money-screens.mjs — the owner's Customers, Pay Later, Complaints, Inventory and
// Manager-mode screens keep the promises the SERVER already makes for them.
//
//   node scripts/verify-owner-money-screens.mjs        # static source checks, no DB, no login
//
// WHY THIS EXISTS (sweep 6 · terminal 14, 2026-08-18)
// Every fault this file guards had the same shape: the API did the careful thing — a true
// head-count, a `moduleOff` flag, a `partial` list, a `?refresh=1` escape hatch — and the SCREEN
// quietly ignored it. Nothing failed, nothing logged, and the owner was shown a number that was
// simply out of date or a sentence that was simply untrue. A code comment cannot stop that coming
// back; a check that reads the page's own source can.
//
// Each rule is one entry in RULES, so a single change can be reverted on its own without taking the
// rest of the file with it.
import fs from "node:fs";
import path from "node:path";

const read = (f) => { try { return fs.readFileSync(path.resolve(f), "utf8"); } catch { return null; } };
let fail = 0, pass = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };

const CUSTOMERS = "app/owner/customers/page.tsx";
const KHATA = "app/owner/khata/page.tsx";
const ISSUES = "app/owner/issues/page.tsx";
const INVENTORY = "app/owner/inventory/page.tsx";
const MANAGER = "app/owner/manager/page.tsx";
const PANEL_MGR = "public/panels/editor/app.js";
const PANEL_TAB = "public/panels/tablet/app.js";
const INV_ROUTE = "app/api/owner/inventory/route.ts";
const INV_UI = "components/owner/OwnerInventory.tsx";

// { item, file, say, must: [RegExp], mustNot: [RegExp] }
const RULES = [
  {
    item: 1, file: CUSTOMERS,
    say: "Refresh recounts the guest tiles live, and so does an erase",
    must: [
      /force \? "refresh=1" : ""/,                       // the page can ask for a live recount
      /onClick=\{\(\) => load\(true\)\}[\s\S]{0,120}Refresh/, // …and the Refresh button asks for one
      /await load\(true\);/,                              // …and so does a successful erase
    ],
  },
  {
    item: 2, file: CUSTOMERS,
    // The sequence counter is what makes closing-while-loading stick: without it the reply that is
    // already in flight sets `detail` again and the drawer re-opens on top of the owner. (It would
    // also stop two guests' replies crossing, but that path is not reachable through this screen —
    // the drawer is modal and covers the table from the same tick. Measured, not assumed.)
    say: "closing the guest record works while it is still loading",
    must: [
      /const closeDetail = useCallback\(\(\) => \{[\s\S]{0,220}setDetailBusy\(false\);/, // close clears the LOADING state too
      /const mine = \+\+detailSeq\.current;/,                                            // every open is sequenced
      /if \(mine !== detailSeq\.current\) return;/,                                      // a stale reply never renders
      /useBackClose\("owner-customer-detail", !!detail \|\| detailBusy, closeDetail\)/,   // Back uses it
      /onClick=\{closeDetail\} role="dialog"/,                                           // the backdrop uses it
    ],
    mustNot: [
      /onClick=\{\(\) => setDetail\(null\)\}/,     // no way of closing may clear only half the state
    ],
  },
  {
    item: 3, file: ISSUES,
    say: "the complaints badge is the server's own count, and both lists say when they are capped",
    must: [
      /const openCount = openSrv \?\? shownOpen;/,   // the server's head-count wins
      /typeof j\.openCount === "number" \? j\.openCount : null/,
      /const ratingsCapped =/,                       // the ratings list admits its cap
      /const issuesCapped =/,                        // …and so does the complaints list
      /Showing the \$\{ratingsShown\} most recent of/,
      /Showing the \{ISSUES_PAGE\} most recent complaints/,
    ],
    mustNot: [
      // the badge must never go back to counting the page it happens to hold
      /const openCount = \(issues \|\| \[\]\)\.filter/,
    ],
  },
  {
    // ITEM 4 WAS REVERTED ON HIS WORD (2026-08-18) — see docs/REJECTED-IDEAS.md R31. The rule is
    // inverted on purpose: the page must NEVER hide itself or claim Pay Later is off, so this now
    // guards the absence rather than the presence.
    item: 4, file: KHATA,
    say: "Pay Later never hides itself or claims the feature is off (R31)",
    must: [/REJECTED \(owner, 2026-08-18\)[\s\S]{0,900}R31/],
    mustNot: [/setModuleOff/, /Pay Later isn&apos;t enabled/],
  },
  {
    item: 5, file: CUSTOMERS,
    say: "Customers shows the \"couldn't read this\" note the route sends",
    must: [
      /import \{ partialNote \} from "@\/lib\/partialRead"/,
      /setPartial\(Array\.isArray\(j\.partial\) \? j\.partial : \[\]\)/,
      /partialNote\(partial\)/,
    ],
  },
  {
    item: 5, file: ISSUES,
    say: "Feedback & complaints shows the same note, from either tab",
    must: [
      /import \{ partialNote \} from "@\/lib\/partialRead"/,
      /setRPartial\(Array\.isArray\(j\.partial\)/,
      /setIPartial\(Array\.isArray\(j\.partial\)/,
      /partialNote\(partial\)/,
    ],
  },
  {
    item: 6, file: KHATA,
    say: "a Pay Later search that finds nobody says whether it searched the whole book",
    must: [/No one matches that search among the \$\{shown\.showing/],
  },
  {
    item: 9, file: INVENTORY,
    say: "the inventory module check is ONE read for the whole estate, not one per restaurant",
    must: [/inventoryEffectiveByRid\(ids\)/],
    mustNot: [/for \(const id of ids\).*inventoryLadder/],
  },
  {
    item: 10, file: KHATA,
    say: "an old tab is coloured by its age",
    must: [/const OldestTab = /, /d >= 60 \? "var\(--adm-danger/, /<OldestTab iso=\{c\.oldestKhataAt\} \/>/],
  },
  {
    // ── HE ASKED FOR THIS ONE BY NAME (owner, 2026-08-18) ────────────────────────────────────────
    // "if the pay later is off, while time of pay — UPI, cash and pay later option — at that time
    // when pay later is off, the pay later option should not be shown. Check that also."
    // Checked live on 2026-08-18 and it is correct: Green Bowl (module off) offers Pay Later
    // nowhere, French House (module on) does. It was fixed on 2026-08-02 and had been right since.
    // Guarded now so it cannot drift back — it already drifted once, when Pay Later stopped sharing
    // table_tags_* and this check was left reading the old columns.
    item: 14, file: PANEL_MGR,
    say: "manager panel: the pay-later payment button is gated on the pay-later module, not on table tags",
    must: [
      /function khataOn\(\)[\s\S]{0,260}s\.khata_allowed === true/,          // its own ladder
      /flag === "khata" \? khataOn\(\) : tableTagsOn\(\)/,                     // …used by the gate
      /khata: tagActionAllowed\("khata"\)/,                                    // …fed into the modal
      /opts\.khata \? `<button[\s\S]{0,200}Pay Later<\/button>` : ""/,        // …and the button obeys it
    ],
  },
  {
    item: 14, file: PANEL_TAB,
    say: "waiter tablet: the same, on its own copy",
    must: [
      /function tabletKhataOn\(\)[\s\S]{0,200}s\.khata_allowed === true/,
      /khata: tabletKhataOn\(\) && tshow\("tablet_khata"\)/,
      /opts\.khata \? `<button[\s\S]{0,600}Pay Later<\/button>` : ""/,
    ],
  },
  // ── ITEM 16 · `--border` IS A WHOLE BORDER, NOT A COLOUR ──────────────────────────────────────
  // `app/globals.css` declares `--border: 1px solid #1d2430`, so `1px solid var(--border)` expands
  // to `1px solid 1px solid #1d2430` — invalid, and thrown away by the browser. Measured 2026-08-18:
  // the customers table's row separator computed to `0px none`, the ratings bar track to
  // `rgba(0,0,0,0)`, and the EMPTY half of every star row to the same amber as the filled half — so
  // every rating on the Feedback screen drew five gold stars and a 1★ complaint looked like a 5★
  // compliment. `aria-label` said "1 out of 5" throughout, which is why no text check ever caught it.
  // `--border-c` is the declared COLOUR. These three files may not use the shorthand as one.
  ...[CUSTOMERS, KHATA, ISSUES].map((file) => ({
    item: 16, file,
    say: `${file.split("/")[2]}: no colour is taken from --border (it is a whole border, not a colour)`,
    mustNot: [
      /(?:border(?:-top|-bottom|-left|-right)?|borderTop|borderBottom|borderLeft|borderRight|border):\s*"?\d+px solid var\(--border[,)]/,
      /(?:background|color):\s*"var\(--border[,)]/,
      /color-mix\([^)]*var\(--border[,)]/,
    ],
  })),
  {
    // ── ITEM 15 · ONE BOX PER RESTAURANT (owner, 2026-08-18) ──────────────────────────────────────
    // "when there are two or more restaurant, it should show boxes of restaurants… it should not
    // load every time, so that egress can be saved… everything should be in the back end
    // calculating… it should not take time to load."
    // All four promises are checkable from the source, so all four are checked.
    item: 15, file: INV_ROUTE,
    say: "the estate roll-up is one cached backend pass, using the same summary the detail screen uses",
    must: [
      /sp\.get\("estate"\) === "1"/,
      /cachedOwnerPayload\(\{[\s\S]{0,300}key: `investate:v\d+:/,      // …cached, so a normal open is one row read
      /rd\(`sum:\$\{rid\}`, \(\) => sb\.rpc\("lfh_inv_report_summary"/, // …the SAME function the detail screen uses
      /for \(let i = 0; i < live\.length; i \+= 6\)/,                   // …in parallel chunks, never a full fan-out
      /if \(r\.unread\) return t;/,                                     // …and a figure nobody read is never summed
    ],
  },
  {
    item: 15, file: INV_UI,
    say: "the estate screen draws a box per restaurant and its totals come from those same boxes",
    must: [
      /where === "estate"/,
      /est\.totals\.stockValue/,
      /setRid\(r\.rid\); setData\(null\); setWhere\("one"\)/,   // a box opens that restaurant
      /if \(estInFlight\.current && !force\) return;/,           // never two estate reads at once
      /Couldn&apos;t read this one/,                              // an unread box says so instead of showing zero
    ],
    mustNot: [
      /<span className="k">/,   // the label must be a block, or it runs into its own value
      />\s*All restaurants\s*\n?\s*<\/button>/,  // must not repeat the shell's own nav wording
    ],
  },
  {
    // ── ITEM 17 · THE INSIDE OF ONE RESTAURANT (owner, 2026-08-18) ────────────────────────────────
    // "make a good UI also for the owner of inventory management and all that. and all correct UI.
    //  Like, every number should match and all that stuff."
    // The three things that were actually wrong were all about trust: raw database dates on screen,
    // cards headed with a count and no money so nothing tied back to the tile above, and capped
    // lists that never said they were capped. Each card's total now comes from the SUMMARY — the
    // database's figure for the month — never from adding up the rows the card happens to hold.
    item: 17, file: INV_UI,
    say: "inside a restaurant: every card carries the database's own total, and dates read as words",
    must: [
      /const shortDate = /,                       // …and it is used, per the mustNot below
      /title="Wasted" total=\{s\.waste\}/,
      /title="Expenses by kind" total=\{s\.expenses\}/,
      /title="Expense book" total=\{s\.expenses\}/,
      /title="Bills & cash buys" total=\{s\.purchases\}/,
      /Running low \(\$\{s\.lowCount\}\)/,        // the count is the database's, not the list length
      /data\.expenses\.length >= \(data\.caps\?\.expenses \?\? 300\)/,   // a capped list says so
      /\(s\.purchasesCount \?\? data\.purchases\.length\) !== data\.purchases\.length/,
    ],
    mustNot: [
      /\{e\.expense_date\}/,   // a raw ISO date must never reach the screen
      /\{p\.bill_date\}/,
    ],
  },
  {
    item: 17, file: INV_ROUTE,
    say: "…and the route sends the true month counts, with a cache key that moves when the shape does",
    must: [
      /purchasesCount: Number\(sum\.purchases_count \|\| 0\)/,
      /wasteCount: Number\(sum\.waste_count \|\| 0\)/,
      /caps: \{ expenses: 300, purchases: 100, low: 500, negative: 50 \}/,
      /key: `inv:v2:/,     // bump this whenever the payload shape changes — v1 snapshots served the
                           // old shape for hours and the new "showing N of M" line never appeared
    ],
  },
  {
    // ── ITEM 18 · NOTHING BEFORE THE CACHE THAT DOES NOT HAVE TO BE ──────────────────────────────
    // "it should not load every time, so that egress can be saved… it should not take time to load."
    // Which restaurants have stock switched on, and what they are called, were answered on the way
    // PAST the cache — two round-trips paid on every open, including the ones served from the
    // snapshot in a single row read. Both answers are already inside the stored payload, so both
    // belong inside `compute`. Measured: the median cached open fell from 1362ms to ~420ms.
    item: 18, file: INV_ROUTE,
    say: "an already-computed estate open costs a row read, not a settings read and a names read",
    must: [
      /compute: async \(\) => \{[\s\S]{0,400}const eff = await inventoryEffectiveByRid\(ids\);/,
      /compute: async \(\) => \{[\s\S]{0,900}const names = await restaurantNames\(live\);/,
      /key: `investate:v2:\$\{scopeKeyOf\(null, !!scope\.all, ids\)\}/,   // keyed on the whole scope
    ],
  },
  {
    item: 7, file: MANAGER,
    say: "the Manager-mode fallback heading uses a class the stylesheet defines",
    must: [/className="adm-page-h">Manager mode/],
    mustNot: [/className="adm-page-title"/],   // declared in no stylesheet — see app/globals.css
  },
];

console.log("The owner's money screens must use what the server already tells them\n");

for (const r of RULES) {
  const src = read(r.file);
  if (src === null) { bad(`item ${r.item}: ${r.file} not found (if it moved, update this guard)`); continue; }
  const missing = (r.must || []).filter((re) => !re.test(src));
  const present = (r.mustNot || []).filter((re) => re.test(src));
  if (!missing.length && !present.length) ok(`item ${r.item} · ${r.say}`);
  else {
    bad(`item ${r.item} · ${r.say}`);
    for (const re of missing) console.log(`        missing in ${r.file}: ${re}`);
    for (const re of present) console.log(`        must not appear in ${r.file}: ${re}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail
  ? "\n❌ FAIL — a screen has stopped using something the server takes trouble to send it."
  : "\n✅ PASS — every screen uses what its route sends.");
process.exit(fail ? 1 : 0);
