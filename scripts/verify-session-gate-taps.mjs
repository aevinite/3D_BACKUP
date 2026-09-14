// verify-session-gate-taps.mjs — guards two rules about the guest's table sheet
// (components/SessionGate.tsx), both found by driving it in sweep #9, terminal 4.
//
//   A. A SCREEN IS NEVER SET ON A SHEET NOBODY CAN SEE.
//      `act()` can be reached with the sheet CLOSED — the "connect" fast-path in onDo calls it
//      directly so a diner already in an open, approved session adds a dish with no pop-up. Any
//      branch in act() that puts a SCREEN up must therefore open the sheet in the same breath.
//      It did not, for the name screen, and the measured result was a tap that vanished: no sheet,
//      no toast, and `lfh:session-done` never fired, so the Add-to-cart gate kept holding the dish
//      for ever. Reachable on a real phone through the pre-session-scoping name value that
//      getNickname() deliberately treats as "no name".
//
//   C. THE LINE THAT SAYS WHY A TAP WAS REFUSED IS READABLE IN BOTH SKINS.
//      Five screens render `note` and all five carried an inline `color:#fca5a5`. MEASURED on the
//      rendered page: 8.7:1 on the dark card, 1.9:1 on the light one — pale pink on white. A
//      hard-coded hex cannot follow the skin, which the admin console already records in its own
//      words. The sheet must use the class, and the class must have a light-skin override placed
//      BELOW its base rule (a later rule of equal weight is what wins).
//
//   B. THE TABLE NUMBER THAT LEAVES ANY OF THE THREE DOORS IS THE ONE THE FLOOR USES.
//      A table's identity everywhere is its NUMBER, kept as text and compared with `=`
//      (migration 131's own header; lfh_table_status does `WHERE table_number = ...`). "007"
//      passes the digits test and the 1..tableCount range test and then matches nothing, so the
//      diner is parked on "your table isn't open yet" while their real table is open, and a
//      waiter is called to a table that does not exist.
//      Three doors ask for a table number — the basket's Place Order, the waiter-call popup and
//      this sheet — and there must be exactly ONE checker behind all three (owner's standing "a
//      new way replaces the old one"). The sheet kept a private copy until sweep #9, which is why
//      the same fix had to be made twice. So: the shared checker canonicalises, every caller uses
//      the value it hands back, and the sheet holds no second copy of the rules.
//
// Static — no key, no database, no running app, so it is safe in the PostToolUse hook.
//   node scripts/verify-session-gate-taps.mjs
//   node scripts/verify-session-gate-taps.mjs --self-test   # proves each check can go red
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "components/SessionGate.tsx";

// Strip LINE comments BEFORE block comments. A `/*` sitting inside a `//` line otherwise swallows
// everything to the next `*/` — this repo has lost 190 lines to that exact order twice.
function codeOnly(src) {
  const noLine = src.split("\n").map((l) => {
    let quote = null, esc = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "/" && l[i + 1] === "/") return l.slice(0, i);
    }
    return l;
  }).join("\n");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}

// The body of one named arrow/function declaration, brace-matched.
function bodyOf(code, header) {
  const i = code.indexOf(header);
  if (i < 0) return null;
  const open = code.indexOf("{", i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === "{") depth++;
    else if (code[j] === "}") { depth--; if (depth === 0) return code.slice(open, j + 1); }
  }
  return null;
}

let failed = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failed++; console.log(`  ✗ ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));

function run(src) {
  failed = 0;
  const code = codeOnly(src);

  console.log("A. a screen act() puts up is a screen the diner can see");
  const act = bodyOf(code, "const act = useCallback(async ()");
  if (!act) { fail("could not find act() — this guard names a function that has moved"); return failed; }
  // Every step act() can set directly. "working" is exempt: both paths that set it either close
  // the sheet or re-open it themselves on a refusal, which the next check proves.
  const SCREENS = [...act.matchAll(/setStep\("([a-z_]+)"\)/g)].map((m) => m[1]);
  check(SCREENS.length > 0, `act() sets ${SCREENS.length} screen(s) directly: ${SCREENS.join(", ") || "none"}`);
  for (const s of SCREENS) {
    if (s === "working") continue; // a waiting screen, not one the diner must act on
    const line = act.split("\n").find((l) => l.includes(`setStep("${s}")`)) || "";
    check(/setOpen\(true\)/.test(line), `act() opens the sheet in the same breath as the "${s}" screen`);
  }
  // The two refusal branches that already had to learn this, so nobody "tidies" them away.
  const blocked = act.split("\n").filter((l) => /setStep\("blocked"\)/.test(l));
  check(blocked.length > 0 && blocked.every((l) => /setOpen\(true\)/.test(l)),
    `every "blocked" screen in act() opens the sheet (${blocked.length} branch(es))`);
  const place = bodyOf(code, "const placeOrderNow = useCallback(async ()");
  const placeBlocked = (place || "").split("\n").filter((l) => /setStep\("blocked"\)/.test(l));
  check(placeBlocked.length > 0 && placeBlocked.every((l) => /setOpen\(true\)/.test(l)),
    `every "blocked" screen on the order path opens the sheet (${placeBlocked.length} branch(es))`);
  // …and the fast-path this whole rule exists for is still there, so the guard still guards something.
  check(/if \(state\.ok && sObj\?\.status === "open" && member\?\.approved\) \{ await act\(\); return; \}/.test(code),
    "the silent connect fast-path still calls act() with the sheet closed — the reason rule A exists");

  console.log("B. one checker behind all three doors, and it hands back a number the floor knows");
  const shared = codeOnly(readFileSync(join(ROOT, "lib/table.ts"), "utf8"));
  // the shared checker still enforces the two rules, and now canonicalises
  check(/\/\^\\d\+\$\/\.test\(value\)/.test(shared), "the shared checker still refuses anything that is not all digits");
  check(/tableCount > 0 && num > tableCount/.test(shared), "…and still refuses a number above the restaurant's own table count");
  check(/return \{ ok: true, value: String\(num\) \};/.test(shared), "…and hands back the CANONICAL number, so \"007\" leaves as \"7\"");
  check(!/return \{ ok: true, value \};/.test(shared), "…and never hands back the raw text it was given");
  // the sheet delegates instead of keeping a copy
  const submit = bodyOf(code, "const submitTable = ()");
  if (!submit) { fail("could not find submitTable() — this guard names a function that has moved"); return failed; }
  check(/validateTable\(tableInput,/.test(submit), "the table sheet asks the shared checker rather than testing the number itself");
  check(!/\/\^\\d\+\$\/\.test/.test(submit), "…and keeps no private digits-only copy of that rule");
  check(!/> max/.test(submit) && !/tableCount \|\| 0\);?$/.test(submit.split("\n").filter((l) => /> max/.test(l)).join("")), "…and keeps no private range copy of that rule");
  check(/table: check\.value/.test(submit) && /rememberTable\(check\.value\)/.test(submit), "…and passes on the value the checker handed back, not the raw text");
  // every OTHER door uses the value too, or canonicalising here would be pointless
  for (const f of ["components/CartPanel.tsx", "components/ChefPopup.tsx"]) {
    const other = codeOnly(readFileSync(join(ROOT, f), "utf8"));
    const calls = (other.match(/validateTable\(/g) || []).length;
    // The raw box lives in state as `tableNumber` / `tableDraft`; the checker's answer is taken
    // into a local (`tableTrim`) or used as `check.value`. Only the RAW names are a fault here —
    // an alias for `check.value` is not one, and reading it as one is how a guard cries wolf.
    const raws = other.split("\n").filter((l) => /(table|p_table):\s*(tableNumber|tableDraft)\b/.test(l));
    check(calls > 0, `${f} asks the shared checker (${calls} call(s))`);
    check(raws.length === 0, `${f} hands on the checker's value, never the raw box (${raws.length} raw use(s))`);
  }

  console.log("C. the refusal line is readable on the light card too");
  const inlineRed = (src.match(/style=\{\{ color: "#fca5a5" \}\}/g) || []).length;
  check(inlineRed === 0, `no screen in the sheet paints its refusal with a dark-skin-only hex (${inlineRed} found)`);
  const notes = (code.match(/className="sg-sub sg-note-bad"/g) || []).length;
  check(notes >= 5, `every screen that renders a refusal uses the skin-aware class (${notes} of 5)`);
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const base = css.indexOf(".sg-note-bad {");
  const light = css.indexOf('[data-theme="light"] .sg-note-bad');
  check(base > -1, "the class has a base rule");
  check(light > -1, "the class has a light-skin override");
  check(base > -1 && light > base, `the override sits BELOW its base, so it actually wins (base ${base}, override ${light})`);
  return failed;
}

const src = readFileSync(join(ROOT, FILE), "utf8");
console.log(`verify:session-gate — ${FILE}\n`);
let bad = run(src);

if (process.argv.includes("--self-test")) {
  console.log("\nSELF-TEST — each sabotage must turn this guard red");
  const sabotage = [
    ["the name screen set on a closed sheet", (s) => s.replace('setNote(""); setOpen(true); setStep("nickname");', 'setNote(""); setStep("nickname");')],
    ["the sheet growing its own copy of the rules again", (s) => s.replace("const check = validateTable(tableInput,", "const t = tableInput.trim(); if (!/^\\d+$/.test(t)) { setNote(\"no\"); return; }\n    const check = validateTable(tableInput,")],
    ["the checker's value computed and then ignored", (s) => s.replace("rememberTable(check.value);", "rememberTable(tableInput);")],
    ["a refusal painted back in the dark-skin-only red", (s) => s.replace('className="sg-sub sg-note-bad"', 'className="sg-sub" style={{ color: "#fca5a5" }}')],
  ];
  for (const [what, bend] of sabotage) {
    const bent = bend(src);
    if (bent === src) { console.log(`  ✗ ${what}: the sabotage matched nothing — this guard is testing itself against code that has moved`); bad++; continue; }
    const before = console.log; console.log = () => {};
    const n = run(bent);
    console.log = before;
    n > 0 ? console.log(`  ✓ ${what} → ${n} check(s) red`) : (console.log(`  ✗ ${what} → still green, so this guard would not catch it`), bad++);
  }
  run(src); // leave the real result printed last
}

console.log(bad ? `\n✗ ${bad} check(s) failed` : "\n✓ every screen the sheet puts up can be seen, and the floor gets the table number it knows");
process.exit(bad ? 1 : 0);
