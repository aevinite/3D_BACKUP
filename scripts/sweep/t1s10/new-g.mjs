// scripts/sweep/t1s10/new-g.mjs — sweep #10 · T1 · the GUARD rows P170001–P170015: the checks this sweep added to
// scripts/verify-guest.mjs with its six fixes. verify:guest is run ONCE, static + live against my build, and each
// row passes when its check is present in the guard and did not fail. Each was also sabotaged both ways when it
// was written (see the commit of its item).
import { execFileSync } from "node:child_process";
import { R, ok, ROOT, BASE, src } from "./lib.mjs";
let out = null;
const run = () => { if (out === null) { try { out = execFileSync("node", ["scripts/verify-guest.mjs", "--base", BASE], { cwd: ROOT, encoding: "utf8", timeout: 900000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); } } return out; };
const ROWS = [
  ["P170001", "components/MenuView.tsx", "item 1: the scroll cues are keyed on the text the screen is drawn from"],
  ["P170002", "components/MenuView.tsx", "item 1, LIVE: a one-letter search on Aangan keeps its 'more this way' fade"],
  ["P170003", "components/MenuView.tsx", "item 1, LIVE: clearing a search gives the filter chips their fade back"],
  ["P170004", "lib/tenant.ts", "item 2: both restaurant lookups read the address the way the menu API reads it"],
  ["P170005", "lib/tenant.ts", "item 2, LIVE: a menu link with a trailing space lands on the menu"],
  ["P170006", "lib/tenant.ts", "item 2, LIVE: …and with a leading space"],
  ["P170007", "components/GuestNotFound.tsx", "item 2, LIVE: no dead end offers a way out that points at itself"],
  ["P170008", "components/FoodCard.tsx", "item 3: no hidden wrapper holds the veg mark"],
  ["P170009", "components/FoodCard.tsx", "item 3, LIVE: a screen reader hears one veg/non-veg mark per dish"],
  ["P170010", "components/FoodCard.tsx", "item 4: every card icon is hidden or inside a named button"],
  ["P170011", "components/FoodCard.tsx", "item 4, LIVE: no card's spoken name carries an icon-font glyph"],
  ["P170012", "lib/tenant.ts", "item 2 follow-up: an address no restaurant can have is refused before the database"],
  ["P170013", "lib/tenant.ts", "item 2 follow-up, LIVE: a null byte in the address gets the guest's 'isn't available', not the error screen"],
  ["P170014", "app/error.tsx", "item 5: neither error screen paints a restaurant's colour"],
  ["P170015", "components/MenuView.tsx", "item 6: a remembered search filters only while the search switch is on"],
  ["P170525", "components/Header.tsx", "item 7: the currency list never prints a code twice"],
  ["P170526", "components/Header.tsx", "item 7, LIVE: Burger Barn's currency list reads each currency once (no 'AED AED')"],
];
for (const [id, file, title] of ROWS) R(id, file, title, () => { const o = run(); const present = new RegExp(`check\\("${id}"|\\["${id}", "`).test(src("scripts/verify-guest.mjs")); const failed = o.includes(`[${id}]`); const passed = /✅ PASS/.test(o); return ok(present && !failed && passed, `verify:guest ${passed ? "PASS" : "FAIL"} (${(o.match(/\d+ passed, \d+ failed/) || [""])[0]}); this check ${present ? "present" : "MISSING"}, ${failed ? "failed" : "green"}`); }, "npm run verify:guest -- --base http://localhost:4401 (static + live), run once");
