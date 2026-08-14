// verify-parcel-home.mjs — a parcel has ONE home, and that home appears and disappears by itself.
//
// THE RULE (owner, 2026-08-14): "Below the table, the parcel will not show. Parcel will only show
// in the platform thing. So whenever their parcel is on, the platform thing will definitely be on.
// If the parcel and Swiggy and all that are off, the platform menu will automatically disappear."
//
// Two halves, and each can quietly rot on its own:
//   1. the manager FLOOR must not grow a parcel strip again. It had one from 2026-08-02 to
//      2026-08-14 and it was a reasonable-looking idea both times, so the guard is the thing that
//      stops a third attempt;
//   2. the 🛵 Platform / 🥡 Parcels tab must be shown when EITHER module is effective and hidden
//      when both are off — and, when it hides, it must move a manager who is standing on it, or
//      they are left looking at a tab that no longer exists.
// The second half is also what makes the first half safe: taking parcels off the floor is only
// acceptable because the tab that carries them cannot be missing.
//
// Read-only and offline. `npm run verify:parcel-home`
import { readFileSync, existsSync } from "node:fs";

const ROOT = process.cwd();
let pass = true;
const ok = (m, d = "") => console.log(`  ok   ${m}${d ? " — " + d : ""}`);
const bad = (m, d = "") => { pass = false; console.log(`  FAIL ${m}${d ? " — " + d : ""}`); };
const check = (m, cond, why = "") => (cond ? ok(m) : bad(m, why));
const read = (rel) => (existsSync(`${ROOT}/${rel}`) ? readFileSync(`${ROOT}/${rel}`, "utf8") : "");

console.log("\nA PARCEL LIVES ON THE PLATFORM TAB, AND ONLY THERE\n");

const app = read("public/panels/editor/app.js");
const css = read("public/panels/editor/style.css");
check("the manager panel was found", app.length > 1000);

// ── 1 · nothing parcel-shaped is rendered under the tables ──────────────────────────────────
const floorHtml = app.slice(app.indexOf("function floorHtml()"), app.indexOf("function patchFloorTiles("));
check("floorHtml() draws no parcel strip", !/parcelStrip|pcstrip|pctile/.test(floorHtml),
  "the floor is for tables; a parcel has no table and belongs on the Platform tab");
check("no parcel-tile builder is left behind", !/function parcelTileHtml\s*\(/.test(app),
  "a builder nothing calls reads as live wiring to the next person");
check("no parcel-tile click handler is left on the floor", !/data-parcel-tile/.test(app),
  "a handler for markup that no longer exists");
check("the strip's stylesheet went with it", !/^\s*\.pcstrip\s*\{/m.test(css) && !/^\s*\.ftile\.pctile\s*\{/m.test(css),
  "dead CSS that would silently style a re-added strip");

// ── 2 · the tab shows itself when either module is on, and hides when neither is ────────────
const sync = app.slice(app.indexOf("function syncPlatformTab()"), app.indexOf("function syncPlatformTab()") + 1600);
check("syncPlatformTab() exists", sync.length > 100);
check("it reads BOTH modules", /platformModuleOn\(\)/.test(sync) && /parcelModuleOn\(\)/.test(sync),
  "parcels and delivery platforms are separate modules (mig 259) — either one is a reason to show the tab");
check("either module alone shows the tab", /\(\s*platEff\s*\|\|\s*parcelEff\s*\)/.test(sync),
  "a restaurant that only takes counter parcels must still get the tab");
check("with both off the tab is hidden", /btn\.hidden\s*=\s*!show/.test(sync));
check("…and a manager standing on it is moved off", /if\s*\(!show\s*&&\s*state\.tab\s*===\s*"platform"\)\s*setTab\(/.test(sync),
  "hiding the tab while it is the open tab leaves someone on a screen that no longer exists");

// ── 3 · the floor still gets told a parcel is waiting ───────────────────────────────────────
check("the tab keeps a live count on its badge", /function updatePlatformBadge\(\)[\s\S]{0,320}platformBadge/.test(app),
  "with the strip gone, this badge is the only thing that tells someone on the floor a parcel is waiting");
check("the badge counts only live parcels/orders", /status !== "handed_over" && o\.status !== "cancelled"/.test(app));

// ── 4 · a parcel is still fully workable where it does live ─────────────────────────────────
check("the Platform board still opens a parcel", /openParcelTile\(c\.dataset\.platOpen\)/.test(app));
check("parcel numbering still exists for it", /function todaysParcels\(\)/.test(app)
  && /businessDayStartMs\(\)/.test(app.slice(app.indexOf("function todaysParcels()"), app.indexOf("function todaysParcels()") + 700)),
  "Parcel 3 must stay Parcel 3 for the whole business day, which starts at 05:00 and not midnight");

console.log(pass
  ? "\n✅ PASS — parcels are on the Platform tab only, and that tab comes and goes with its modules"
  : "\n❌ FAIL — a parcel is either back on the floor or has nowhere to live");
process.exit(pass ? 0 : 1);
