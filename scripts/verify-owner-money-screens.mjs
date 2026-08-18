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
