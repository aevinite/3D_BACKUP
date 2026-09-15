// verify-guest-waits-for-its-restaurant.mjs
//
// THE RULE (owner, 2026-09-15, item 14): no guest screen reads one restaurant's settings for a
// diner standing in another.
//
// WHY IT EXISTS. `lib/restaurant-context` resolves the restaurant ASYNCHRONOUSLY. Its `id` used to
// start at restaurant #1 and stay "" for good on a failed lookup, and `useRestaurantId()` handed
// that raw value out — so for a few hundred milliseconds on every tenant page, and for ever after
// a failed lookup, EIGHT guest components asked #1 about a diner somewhere else: the basket, the
// waiter-call popup and its button, the order-confirm sheet, the live-order strip, the shared
// basket sync, the head's approve prompt, and the table bill. Measured on Spice Route: one
// settings read naming #1 per page load.
//
// That is the Aangan sticker fault in miniature — the widgets read #1's `sessionsEnabled` (ON) on
// a restaurant where it is OFF, so "+" opened the join-a-table gate instead of adding the dish and
// the basket stayed empty. A diner scanning the sticker on their own table could not order at all.
//
// THE SHAPE THAT HOLDS IT:
//   A. `useRestaurantId()` answers "" until the restaurant is settled — the rule lives in the hook,
//      not in a habit every caller has to remember.
//   B. every component that reads restaurant-keyed data through it refuses to act on "".
//   C. an empty restaurant asks NOBODY for feature switches, rather than firing a doomed read.
//   D. the two guest write routes still refuse an unknown restaurant, and their comments no longer
//      claim the client can never send one.
//
// Static — no key, no database, no running app, so it is safe in the PostToolUse hook.
//   node scripts/verify-guest-waits-for-its-restaurant.mjs
//   node scripts/verify-guest-waits-for-its-restaurant.mjs --self-test
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
// Strip LINE comments BEFORE block comments — a `/*` inside a `//` line otherwise swallows
// everything to the next `*/`, and this repo has lost 190 lines to that order twice.
function codeOnly(src) {
  const noLine = src.split("\n").map((l) => {
    let q = null, esc = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "/" && l[i + 1] === "/") return l.slice(0, i);
    }
    return l;
  }).join("\n");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}
let failed = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failed++; console.log(`  ✗ ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));

function run() {
  failed = 0;

  console.log("A. the rule lives in the hook, so no caller has to remember it");
  const ctx = codeOnly(read("lib/restaurant-context.tsx"));
  const hook = ctx.slice(ctx.indexOf("export function useRestaurantId"), ctx.indexOf("export function useRestaurantMeta"));
  check(/const \{ id, ready \} = useContext\(RestaurantContext\)/.test(hook) && /return ready \? id : ""/.test(hook),
    "useRestaurantId() answers the id only once the restaurant is settled");
  check(!/return useContext\(RestaurantContext\)\.id;/.test(hook),
    "…and never hands out the provisional one");
  check(/setId\(""\)/.test(ctx), "the provider still answers a failed lookup with 'we do not know'");
  check(/useRestaurantMeta/.test(codeOnly(read("components/RealtimeProvider.tsx"))) || /const scoped = rid \? /.test(codeOnly(read("components/RealtimeProvider.tsx"))),
    "…and the one caller that WANTS the provisional value handles it deliberately");

  console.log("B. every guest screen that reads restaurant-keyed data refuses to act on 'we do not know'");
  // Derived from the tree, never a typed list: a file that starts using the hook tomorrow is
  // checked tomorrow. A hand-written list is how a guard ends up narrower than its own comment.
  const files = readdirSync(join(ROOT, "components")).filter((f) => f.endsWith(".tsx")).map((f) => `components/${f}`);
  // BOTH shapes, because the ninth offender used the other one: `useRestaurantMeta()` hands back
  // the RAW id (that is its job — RealtimeProvider wants it), so a component reading restaurant-
  // keyed data through it has to do the waiting itself. Header did it in its effects and not on
  // its `useFeatures` line, and that single line was the last read naming #1 on a tenant page.
  const readers = [];
  for (const f of files) {
    const s = codeOnly(read(f));
    if (!/useRestaurantId\(\)|useRestaurantMeta\(\)/.test(s)) continue;
    if (!/(getSettings|useFeatures|getFeatures)\(/.test(s)) continue;
    readers.push(f);
  }
  check(readers.length > 0, `${readers.length} guest screen(s) read restaurant-keyed data through the hook`);
  for (const f of readers) {
    const s = codeOnly(read(f));
    // The rule, stated once instead of guessed per file:
    //   • a component that takes the id from `useRestaurantId()` is safe BY CONSTRUCTION for any
    //     hook it hands that id to — the hook already answers "" until the restaurant is settled;
    //   • a component that takes the RAW id from `useRestaurantMeta()` is doing the waiting
    //     itself, so a hook it hands that id to must be guarded on the line (`ready ? id : ""`);
    //   • and any `getSettings(...)` inside an effect must refuse to run before the id is known,
    //     whichever shape it used.
    const usesSettledHook = /useRestaurantId\(\)/.test(s);
    const takesRaw = /useRestaurantMeta\(\)/.test(s);
    const name = f.replace("components/", "");

    const featCall = /useFeatures\(([^)]*)\)/.exec(s);
    if (featCall) {
      const arg = featCall[1].trim();
      const safeArg = arg === "" || /useRestaurantId\(\)/.test(arg) || /\?/.test(arg) || (usesSettledHook && !takesRaw);
      check(safeArg, `${name}: its feature switches are asked about a restaurant we are sure of (useFeatures(${arg || "—"}))`);
    }
    if (/getSettings\(/.test(s)) {
      const guarded = /if \(!restaurantId\) return;/.test(s) || /if \(!ready\) return;/.test(s)
        || /if \(!restaurantReady \|\| !restaurantId\) return;/.test(s) || /const settledRestaurant = async/.test(s);
      check(guarded, `${name}: it does not read a restaurant's rules before it knows which restaurant`);
    }
  }

  console.log("C. an unknown restaurant asks nobody, rather than firing a doomed read");
  const feat = codeOnly(read("lib/features.ts"));
  check(/if \(!restaurantId\) return \{ \.\.\.FEATURE_DEFAULTS \} as FeatureMap;/.test(feat),
    "getFeatures answers the defaults for an unknown restaurant instead of reading");
  check(/if \(!restaurantId\) return;/.test(feat.slice(feat.indexOf("export function useFeatures"))),
    "…and the hook subscribes to nothing while the restaurant is unknown");

  console.log("D. the server still refuses what the client must never send");
  for (const r of ["app/api/guest/place-order/route.ts", "app/api/guest/call-waiter/route.ts"]) {
    const raw = read(r);
    check(/unknown_restaurant/.test(raw), `${r.split("/").slice(-2)[0]}: an unknown restaurant is still refused`);
    check(!/always\n\s*\/\/ returns a real id/.test(raw) && !/is never undefined — and every call site/.test(raw),
      `${r.split("/").slice(-2)[0]}: its comment no longer claims the client can never send one`);
  }
  return failed;
}

console.log("verify:guest-restaurant — no guest screen reads the wrong restaurant's settings\n");
let bad = run();

if (process.argv.includes("--self-test")) {
  console.log("\nSELF-TEST — each sabotage must turn this guard red");
  const bends = [
    ["the hook handing out the provisional id again", "lib/restaurant-context.tsx", (t) => t.replace('return ready ? id : "";', "return id;")],
    ["the basket acting before it knows its restaurant", "components/CartPanel.tsx", (t) => t.replace("if (!restaurantId) return;\n", "")],
    ["the table bill acting before it knows its restaurant", "components/SessionTableBill.tsx", (t) => t.replace("if (!restaurantId) return;\n", "")],
    ["an unknown restaurant firing a feature read again", "lib/features.ts", (t) => t.replace("if (!restaurantId) return { ...FEATURE_DEFAULTS } as FeatureMap;\n", "")],
    ["the header asking #1 about another restaurant's switches", "components/Header.tsx", (t) => t.replace('useFeatures(ready ? restaurantId : "")', "useFeatures(restaurantId)")],
  ];
  for (const [what, file, bend] of bends) {
    const p = join(ROOT, file), src = readFileSync(p, "utf8");
    const bent = bend(src);
    if (bent === src) { console.log(`  ✗ ${what}: the sabotage matched nothing — this guard is testing itself against code that has moved`); bad++; continue; }
    writeFileSync(p, bent);
    const before = console.log; console.log = () => {};
    let n; try { n = run(); } finally { console.log = before; writeFileSync(p, src); }
    n > 0 ? console.log(`  ✓ ${what} → ${n} check(s) red`) : (console.log(`  ✗ ${what} → still green, so this guard would not catch it`), bad++);
  }
  bad += run();
}

console.log(bad ? `\n✗ ${bad} check(s) failed` : "\n✓ every guest screen waits until it knows which restaurant it is on");
process.exit(bad ? 1 : 0);
