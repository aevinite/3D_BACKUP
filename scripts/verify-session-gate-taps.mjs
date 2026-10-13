// verify-session-gate-taps.mjs — guards the rules about the guest's table sheet
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
//   G. "WE DON'T KNOW WHICH RESTAURANT" IS NEVER TURNED BACK INTO RESTAURANT #1.
//      lib/restaurant-context answers a failed lookup with an empty id and `ready:false`, on
//      purpose, after a fault the owner called "very imp" — guessing #1 puts a diner's order on
//      another restaurant's floor. This sheet undid that in FIVE places spelled
//      `ridRef.current || DEFAULT_RESTAURANT_ID`, and neither it nor the card waited for `ready`,
//      so the id's opening value (#1) was also used while a /r/<slug> lookup was in flight.
//
//   F. THE MID-MEAL BLOCK STILL BLOCKS, AND STILL LETS GO.
//      A table with food in flight refuses to be left — right, and it must stay. But it decided
//      that purely from "is any dish unserved", so a restaurant that never marks dishes served
//      blocked every table for ever. It now expires against the NEWEST order's age, and both
//      halves must hold: the block, and the expiry.
//
//   E. EVERY SCREEN THIS SHEET DECLARES IS BOTH DRAWN AND REACHABLE, AND NOBODY REACHES THE FLOOR
//      AS "Someone". Two dead screens were once deleted from this file for reading as live, so a
//      declared step with no render branch, or a render branch nothing can set, is a fault. And
//      the waiter-request path must not send a nameless request: the owner's NAME-FIRST rule
//      (2026-06-17) is why the pending list shows a person.
//
//   D. A TAP NEVER SITS IN SILENCE WHILE THE FIRST READ RUNS.
//      Every screen this sheet can show is behind `setOpen(true)`. For "order" and "call" — which
//      always open the sheet anyway — that must happen BEFORE the settings read, or the tap shows
//      nothing at all until it answers (measured: nothing at 3s or 8s). And that read must have a
//      deadline of its own, because getSettings() has none: a database that is up but silent
//      otherwise parks the flow with no way out. "connect" stays silent on purpose.
//
//   C. THE LINE THAT SAYS WHY A TAP WAS REFUSED IS READABLE IN BOTH SKINS.
//      Five screens render `note` and all five carried an inline `color:#fca5a5`. MEASURED on the
//      rendered page: 8.7:1 on the dark card, 1.9:1 on the light one — pale pink on white. A
//      hard-coded hex cannot follow the skin, which the admin console already records in its own
//      words. The sheet must use the class, and the class must have a light-skin override placed
//      BELOW its base rule (a later rule of equal weight is what wins).
//
//   H. A DINER IS TOLD TO CHECK THEIR INTERNET ONLY WHEN THEIR PHONE IS REALLY OFFLINE (sweep #10 T4
//      item 1; owner 2026-10-13 "make sure this never happens"). Was: A BUSY RESTAURANT IS NEVER BLAMED
//      ON THE DINER'S WIFI.
//      lib/session.ts turns a saturated restaurant database into the code `timed_out` precisely so
//      a diner whose phone is fine is not sent off to fix their wifi during the restaurant's own
//      busy hour. afterLocation() honoured it; joining a table as its head, asking to join one,
//      re-checking a table you are already at, and the first read of the restaurant's rules did
//      not — all five said "check your internet" whatever had happened. Every sentence in the sheet
//      that tells a diner to check their internet must now sit behind a test that rules out "it
//      was us".
//
//   I. ONE FAILED READ OF THE RESTAURANT'S SWITCH IS ASKED AGAIN, NEVER TAKEN AS "OFF" FOR THE VISIT
//      (sweep #10 T4, item 2). The table card, the host's "let them in" prompt, the shared basket
//      and the live table bill each read "are table sessions on here?" once, and a failed read left
//      the answer at false until the diner reloaded. lib/tableConnection.ts → watchSessionsSwitch()
//      asks again on a widening wait; this section RUNS it against a read that fails twice, and
//      checks all four components use it (the basket, which already re-ticks, leaves it unknown).
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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "components/SessionGate.tsx";
const CARD = "components/SessionStatusWidget.tsx";

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
  // isSafeInteger, not isInteger: above 2^53-1 the canonicalising below would hand back digits
  // nobody typed, and `tableCount` is 0 — so the range test is skipped — until settings load.
  check(/Number\.isSafeInteger\(num\)/.test(shared), "…and refuses a number too big for a phone to hold exactly, before it canonicalises one");
  check(!/Number\.isInteger\(num\)/.test(shared), "…so the weaker whole-number test cannot come back in its place");
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
  // Derived, not a typed number: count the screens that render `note` and require every one of
  // them to carry the class. A hard-coded "at least 5" quietly stops meaning anything the moment a
  // sixth screen is added — which happened in this same branch (item 8).
  const noteLines = code.split("\n").filter((l) => /\{note && <p/.test(l));
  const bare = noteLines.filter((l) => !/sg-note-bad/.test(l));
  check(noteLines.length > 0 && bare.length === 0,
    `all ${noteLines.length} screen(s) that render a refusal use the skin-aware class${bare.length ? ` (${bare.length} do not)` : ""}`);
  // …and the two the basket carried, found by the same measurement (item 6).
  const cart = readFileSync(join(ROOT, "components/CartPanel.tsx"), "utf8");
  const cartRed = (cart.match(/#fca5a5/g) || []).length;
  check(cartRed === 0, `the basket paints no guest-facing line with that dark-skin-only hex either (${cartRed} found)`);
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const base = css.indexOf(".sg-note-bad {");
  const light = css.indexOf('[data-theme="light"] .sg-note-bad');
  check(base > -1, "the class has a base rule");
  check(light > -1, "the class has a light-skin override");
  check(base > -1 && light > base, `the override sits BELOW its base, so it actually wins (base ${base}, override ${light})`);
  for (const cls of ["guest-ink-bad", "guest-chip-bad"]) {
    const b = css.indexOf(`.${cls} {`), l = css.indexOf(`[data-theme="light"] .${cls}`);
    check(b > -1 && l > b, `.${cls} has a light-skin override, placed below its base (base ${b}, override ${l})`);
  }

  console.log("D. a tap answers at once, and the first read cannot run for ever");
  const onDo = code.slice(code.indexOf("const onDo = async (e: Event)"), code.indexOf("window.addEventListener(\"lfh:session-do\", onDo)"));
  const opensFirst = onDo.indexOf('if (detail.action !== "connect") { setOpen(true); setStep("working"); }');
  const reads = onDo.indexOf("await Promise.race([");
  check(opensFirst > -1, "order and call open the waiting screen before anything is read");
  check(opensFirst > -1 && reads > opensFirst, `…and that happens BEFORE the read, which is the whole point (open at ${opensFirst}, read at ${reads})`);
  check(/SETTINGS_DEADLINE_MS = \d+/.test(onDo), "the settings read has a deadline of its own");
  check(/getSettings\(rid\),\s*\n\s*new Promise<never>/.test(onDo), "…applied by racing it, not by hoping");
  check(!/setOpen\(true\); setStep\("working"\); \}\s*\n?\s*if \(detail\.action === "connect"\)/.test(onDo) && /detail\.action !== "connect"/.test(onDo),
    "…and `connect` still says nothing, so a diner already at their table gets no pop-up");

  console.log("E. every screen is drawn and reachable, and no request reaches the floor nameless");
  const decl = /type Step =([\s\S]*?);\n/.exec(code);
  const steps = decl ? [...decl[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((x) => x !== "idle") : [];
  check(steps.length > 0, `${steps.length} screen(s) declared besides "idle"`);
  const noRender = steps.filter((x) => !new RegExp(`step === "${x}" &&`).test(code));
  const noSetter = steps.filter((x) => !new RegExp(`setStep\\("${x}"\\)|\\? "${x}" :|: "${x}"\\)`).test(code));
  check(noRender.length === 0, `every declared screen is drawn${noRender.length ? `: ${noRender} is not` : ""}`);
  check(noSetter.length === 0, `every declared screen can be reached${noSetter.length ? `: nothing sets ${noSetter}` : ""}`);
  const req = bodyOf(code, "const doRequest = async (type:");
  check(!!req && /if \(!who && type === "access"\) \{[^}]*setStep\("access_name"\); return; \}/.test(req),
    "a waiter request with no name anywhere asks for one instead of reaching the floor as \"Someone\"");
  check(!!req && req.indexOf('setStep("access_name")') < req.indexOf("await requestAccess("),
    "…and it asks BEFORE the request is sent, not after");
  const open = bodyOf(code, "const doRequestOpen = async ()");
  check(!!open && /if \(!name\.trim\(\)\) \{ setNote\(/.test(open), "the open-my-table request still refuses without a name too");

  console.log("F. the mid-meal block still blocks, and now lets go when the meal is long over");
  const card = codeOnly(readFileSync(join(ROOT, CARD), "utf8"));
  check(/orderActive \? setBlocked\(true\) : doChange\(\)/.test(card) && /orderActive \? setBlocked\(true\) : setConfirming\(true\)/.test(card),
    "both Change table and Leave still go to the refusal while food is in flight");
  check(/sItems\.some\(\(i\) => i\.status !== "served"\)/.test(card), "…and it is still unserved food that decides that");
  // The check that matters most, and the one this guard did NOT have until its own self-test
  // caught it: the expiry has to REACH the answer. A stale-food test computed and then never
  // used reads exactly like a working one.
  check(/setOrderActive\(sItems\.some\(\(i\) => i\.status !== "served"\) && !foodIsStale\)/.test(card),
    "…and the expiry actually reaches the answer, rather than being computed and ignored");
  const ms = /const STALE_MEAL_MS = (\d+) \* 60_000;/.exec(card);
  check(!!ms, "the block has a named expiry rather than lasting for ever");
  check(!!ms && Number(ms[1]) >= 60, `…and it is ${ms ? ms[1] : "?"} minutes, well past any real service window for a dish still coming`);
  check(/newestOrderAt > 0 && Date\.now\(\) - newestOrderAt > STALE_MEAL_MS/.test(card),
    "…measured from the NEWEST order, so a party that just ordered again is still mid-meal");
  check(/const foodIsStale = newestOrderAt > 0/.test(card),
    "…and an unreadable time keeps the block, so 'I could not tell' falls on the safe side");
  check(/Your order stays with the table for the bill/.test(card),
    "…and leaving still says plainly that the food stays with the bill, which is why letting go is safe");

  console.log("G. an unknown restaurant is never quietly turned into restaurant #1");
  const subs = code.split("\n").filter((l) => /\|\| DEFAULT_RESTAURANT_ID/.test(l));
  check(subs.length === 0, `no line in the sheet substitutes restaurant #1 for an unknown one (${subs.length} found)`);
  check(/const \{ name: restaurantName, ready: restaurantReady \} = useRestaurantMeta\(\)/.test(code),
    "the sheet takes the settled flag from the provider, not just the id");
  check(/const settledRestaurant = async \(\): Promise<string \| null> =>/.test(code),
    "…and has one place that waits for it to settle");
  check(/if \(!settledRid\) \{/.test(code), "…and refuses honestly when it never settles, rather than guessing");
  check(/const rid = settledRid;/.test(code), "…so the rules it reads are THIS restaurant's");
  check(/const rid = ridRef\.current;\n/.test(code) || /const rid = ridRef\.current;/.test(code),
    "…and an order is placed against the real restaurant, never a substituted one");
  const cardSrc2 = codeOnly(readFileSync(join(ROOT, CARD), "utf8"));
  check(/const \{ id: restaurantId, ready: restaurantReady \} = useRestaurantMeta\(\)/.test(cardSrc2),
    "the card takes the settled flag too");
  check(/if \(!restaurantReady \|\| !restaurantId\) return;/.test(cardSrc2),
    "…and asks nothing, and publishes nothing, until the restaurant is known");
  check(/\}, \[restaurantId, restaurantReady\]\);/.test(cardSrc2),
    "…and wakes up the moment it becomes known, so this is a wait and not a refusal");

  console.log("H. a diner is told to check their internet ONLY when their phone is really offline");
  // (item 1, and the owner 2026-10-13: "make sure this never happens".) Every sentence the sheet can
  // show about not reaching the restaurant comes from reachNote(), and only its "phone" branch — which
  // is reached only on POSITIVE evidence of an offline phone — may name the internet.
  const words = /internet|wi-?fi|your connection|your signal/gi;
  const mentions = [...code.matchAll(words)].map((m) => m.index);
  const outsidePhone = mentions.filter((i) => { const before = code.slice(Math.max(0, i - 160), i);
    return !/if \(fault === "phone"\) return `[^`]*$/.test(before) && !/netFault === "phone" \? "(fa-)?$/.test(before); });
  check(mentions.length > 0 && outsidePhone.length === 0,
    `no sentence in the sheet names the diner's internet except the offline-phone one${outsidePhone.length ? ` (${outsidePhone.length} elsewhere: ${outsidePhone.map((i) => JSON.stringify(code.slice(i - 40, i + 20))).join(" | ")})` : ""}`);
  // …and the screen it lands on says the same: the wifi mark and "Connection trouble" ONLY for an
  // offline phone, and every way onto that screen says whose fault it is first.
  check(/fa-\$\{netFault === "phone" \? "fa-wifi"|netFault === "phone" \? "fa-wifi"/.test(code) && /\{netFault === "phone" \? "Connection trouble" :/.test(code),
    "the 'couldn't reach' screen shows the wifi mark and 'Connection trouble' only when the phone is offline");
  const opens = (code.match(/setStep\("net_error"\)/g) || []).length;
  const said = (code.match(/setNetFault\([^)]*\)\)?; setNote\(/g) || []).length;
  check(opens > 0 && said >= opens, `every way onto that screen sets whose fault it is first (${said} verdict(s) for ${opens} opening(s), plus Retry)`);
  check(/const faultOfAnswer = \(r: \{ ok: boolean; reason\?: string \}\): Fault =>\s*\n\s*isSessionTimeout\(r\) \? "ours" : isPhoneOffline\(r\) \? "phone" : "unknown";/.test(code),
    "the verdict asks 'was it the restaurant?' FIRST, then 'is the phone offline?', and anything else is 'unknown'");
  const rn = (code.match(/const reachNote = [\s\S]*?\n\};/) || [""])[0];
  const unknownLine = rn.split("\n").find((l) => /return `We couldn't reach/.test(l)) || "";
  check(!!unknownLine && !words.test(unknownLine), "…and the 'unknown' sentence blames nobody");
  const head = bodyOf(code, "const joinAsHead = useCallback(async ()");
  const guest = bodyOf(code, "const doJoinAsGuest = async (preset?: string)");
  check(!!head && /if \(!r\.ok\) \{ setTableInput\(p\.table\); setNote\(joinFailedNote\(r\)\);/.test(head), "opening a table as its head words a failed join through the verdict");
  check(!!guest && /if \(!r\.ok\) \{ setNote\(joinFailedNote\(r\)\); setStep\("guest_name"\);/.test(guest), "…and so does asking to join someone else's table");
  const ready = bodyOf(code, "const ensureReadyAndAct = useCallback(async ()");
  check(!!ready && /setNote\(reachNote\(faultOfAnswer\(state\), \{ spotSafe: true \}\)\);/.test(ready), "re-checking a table you are already at uses it too (and says the spot is safe)");
  const after = bodyOf(code, "const afterLocation = useCallback(async ()");
  check(!!after && /setNote\(reachNote\(faultOfAnswer\(st\)\)\);/.test(after), "…and so does checking whether the table is open");
  check(/const settingsFailedNote = \(err: unknown, again: boolean\): string => reachNote\(faultOfError\(err\), \{ again \}\);/.test(code)
    && /if \(msg === "settings_timed_out" \|\| isDbUnreachable\(err\)\) return "ours";/.test(code), "the rules read tells our deadline and a silent database ('ours') apart from an offline phone");
  check((code.match(/setNote\(settingsFailedNote\(err, (true|false)\)\)/g) || []).length === 2, "…and both places that read those rules use it (opening the sheet, and Retry)");
  return failed;
}

const src = readFileSync(join(ROOT, FILE), "utf8");
console.log(`verify:session-gate — ${FILE}\n`);
let bad = run(src);

if (process.argv.includes("--self-test")) {
  console.log("\nSELF-TEST — each sabotage must turn this guard red");
  // Section F reads a SECOND file, so it is sabotaged on disk and put straight back. A guard that
  // only ever self-tests the file it was born in stops proving anything the day it grows.
  const cardPath = join(ROOT, CARD);
  const cardSrc = readFileSync(cardPath, "utf8");
  // lib/table.ts is a THIRD file this guard now defends, so it gets sabotaged on disk too.
  const tablePath = join(ROOT, "lib/table.ts");
  const tableSrc = readFileSync(tablePath, "utf8");
  for (const [what, bend] of [
    ["the safe-number test weakened back to isInteger", (t) => t.replace("Number.isSafeInteger(num)", "Number.isInteger(num)")],
  ]) {
    const bent = bend(tableSrc);
    if (bent === tableSrc) { console.log(`  ✗ ${what}: the sabotage matched nothing`); bad++; continue; }
    writeFileSync(tablePath, bent);
    const before = console.log; console.log = () => {};
    let n; try { n = run(src); } finally { console.log = before; writeFileSync(tablePath, tableSrc); }
    if (n > 0) console.log(`  ✓ ${what} → ${n} check(s) red`);
    else { console.log(`  ✗ ${what} → still green`); bad++; }
  }
  for (const [what, bend] of [
    ["the mid-meal block made permanent again", (t) => t.replace(" && !foodIsStale", "")],
    ["the card acting before it knows which restaurant it is on", (t) => t.replace("if (!restaurantReady || !restaurantId) return;\n", "")],
    ["the expiry stretched past any honest meal", (t) => t.replace("const STALE_MEAL_MS = 90 * 60_000;", "const STALE_MEAL_MS = 30 * 60_000;").replace("> STALE_MEAL_MS", "> STALE_MEAL_MS").replace("const STALE_MEAL_MS = 30 * 60_000;", "const STALE_MEAL_MS = 5 * 60_000;")],
    ["the refusal itself removed from both buttons", (t) => t.replace("orderActive ? setBlocked(true) : doChange()", "doChange()")],
  ]) {
    const bent = bend(cardSrc);
    if (bent === cardSrc) { console.log(`  ✗ ${what}: the sabotage matched nothing — this guard is testing itself against code that has moved`); bad++; continue; }
    writeFileSync(cardPath, bent);
    const before = console.log; console.log = () => {};
    let n;
    try { n = run(src); } finally { console.log = before; writeFileSync(cardPath, cardSrc); }
    if (n > 0) console.log(`  ✓ ${what} → ${n} check(s) red`);
    else { console.log(`  ✗ ${what} → still green, so this guard would not catch it`); bad++; }
  }
  const sabotage = [
    ["the name screen set on a closed sheet", (s) => s.replace('setNote(""); setOpen(true); setStep("nickname");', 'setNote(""); setStep("nickname");')],
    ["the sheet growing its own copy of the rules again", (s) => s.replace("const check = validateTable(tableInput,", "const t = tableInput.trim(); if (!/^\\d+$/.test(t)) { setNote(\"no\"); return; }\n    const check = validateTable(tableInput,")],
    ["the checker's value computed and then ignored", (s) => s.replace("rememberTable(check.value);", "rememberTable(tableInput);")],
    ["a refusal painted back in the dark-skin-only red", (s) => s.replace('className="sg-sub sg-note-bad"', 'className="sg-sub" style={{ color: "#fca5a5" }}')],
    ["the waiting screen moved back behind the read", (s) => s.replace('if (detail.action !== "connect") { setOpen(true); setStep("working"); }\n', "")],
    ["the deadline taken off the first read", (s) => s.replace("const s = await Promise.race([", "const s = await Promise.resolve().then(() => [")],
    ["a nameless waiter request let through to the floor", (s) => s.replace('if (!who && type === "access") { setNote(""); setOpen(true); setStep("access_name"); return; }\n', "")],
    ["a screen declared but never drawn", (s) => s.replace('| "nickname" | "access_name" |', '| "nickname" | "access_name" | "ghost_screen" |')],
    ["restaurant #1 substituted for an unknown one again", (s) => s.replace("const rid = settledRid;", "const rid = settledRid || DEFAULT_RESTAURANT_ID;")],
    ["a failed head-join blamed on the diner's wifi again", (s) => s.replace("setTableInput(p.table); setNote(joinFailedNote(r));", "setTableInput(p.table); setNote(\"Couldn't reach the restaurant's system — check your internet and try again.\");")],
    ["a failed rejoin blamed on the wifi whatever happened", (s) => s.replace("setNote(reachNote(faultOfAnswer(state), { spotSafe: true }));", "setNote(\"We can't reach the restaurant's system right now — check your internet and retry.\");")],
    ["the 'unknown' verdict blaming the internet again", (s) => s.replace("return `We couldn't reach the restaurant's system just now.${safe} Please try again in a moment.`;", "return `We can't reach the restaurant's system — check your internet.${safe}`;")],
    ["the busy screen wearing the wifi mark for everyone again", (s) => s.replace('netFault === "phone" ? "fa-wifi" : netFault === "ours" ? "fa-hourglass-half" : "fa-circle-exclamation"', '"fa-wifi"')],
    ["an unrecognised failure treated as an offline phone", (s) => s.replace('isSessionTimeout(r) ? "ours" : isPhoneOffline(r) ? "phone" : "unknown";', 'isSessionTimeout(r) ? "ours" : "phone";')],
    ["the rules read's failure worded without asking whose it was", (s) => s.replace("setNote(settingsFailedNote(err, true));", "setNote(\"Still can't reach the restaurant's system — check your internet and try again.\");")],
  ];
  for (const [what, bend] of sabotage) {
    const bent = bend(src);
    if (bent === src) { console.log(`  ✗ ${what}: the sabotage matched nothing — this guard is testing itself against code that has moved`); bad++; continue; }
    const before = console.log; console.log = () => {};
    const n = run(bent);
    console.log = before;
    if (n > 0) console.log(`  ✓ ${what} → ${n} check(s) red`);
    else { console.log(`  ✗ ${what} → still green, so this guard would not catch it`); bad++; }
  }
  run(src); // leave the real result printed last
}

// ── I. the restaurant's switch is asked until it is answered ────────────────────────────────────────
// Static half: every widget that reads the switch goes through the retrying reader (or, for the
// basket, leaves a failed read UNKNOWN so its next tick asks again) — and none swallows a failure
// into "off". Behavioural half: the real watchSessionsSwitch, bundled with a fake getSettings that
// fails twice and then answers, under a clock that runs every wait at once.
const WIDGETS = ["components/SessionStatusWidget.tsx", "components/SessionOwner.tsx", "components/SessionTableBill.tsx"];
function sectionIStatic(read) {
  let n = 0; const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { n++; console.log(`  ✗ ${m}`); } };
  for (const f of WIDGETS) {
    const c = codeOnly(read(f));
    ok(/watchSessionsSwitch\(restaurantId,/.test(c), `${f} asks the switch through the retrying reader`);
    ok(!/getSettings\(restaurantId\)/.test(c), `…and no longer makes a one-shot read of its own`);
    ok(/stopSwitch\(\)/.test(c), `…and stops the retry when it goes away`);
  }
  const cart = codeOnly(read("components/SessionCartSync.tsx"));
  ok(/catch \{ return; \}/.test(cart) && !/catch \{ enabled\.current = false; \}/.test(cart),
    "the shared basket leaves a failed read unknown, so its next tick asks again, instead of caching 'off'");
  const tc = codeOnly(read("lib/tableConnection.ts"));
  ok(/export function watchSessionsSwitch\(/.test(tc), "the retrying reader exists in lib/tableConnection.ts");
  ok(/SWITCH_RETRY_MS\[attempt\] \?\? RT_BACKUP_MS/.test(tc), "…widening, then settling on the shared 60-second backstop (never faster)");
  ok(/0\.75 \+ Math\.random\(\) \* 0\.5/.test(tc), "…jittered, so a room full of phones does not come back on one beat");
  return n;
}
async function sectionIRun(tcSource) {
  let n = 0; const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { n++; console.log(`  ✗ ${m}`); } };
  const esbuild = (await import("esbuild")).default;
  const cache = join(ROOT, "node_modules/.cache"); mkdirSync(cache, { recursive: true });
  const stub = join(cache, "vsg-menu-stub.mjs");
  writeFileSync(stub, `export let calls = 0; export let failFirst = 2;
export function reset(k) { calls = 0; failFirst = k; }
export function getSettings(rid) { calls++; return calls <= failFirst ? Promise.reject(new Error("statement timeout")) : Promise.resolve({ sessionsEnabled: true, rid }); }`);
  // The two neighbours it imports are stood in for too: the real ones reach the browser's storage
  // and the database client, and this check is about the retry, nothing else.
  const nb = join(cache, "vsg-neighbours.mjs");
  writeFileSync(nb, "export const getStoredSession = () => null; export const getScannedTable = () => ''; export const RT_BACKUP_MS = 60000;");
  const out = join(cache, "vsg-tableConnection.cjs");
  await esbuild.build({ stdin: { contents: tcSource, resolveDir: join(ROOT, "lib"), loader: "ts", sourcefile: "tableConnection.ts" },
    bundle: true, platform: "node", format: "cjs", outfile: out, logLevel: "silent",
    plugins: [{ name: "stand-ins", setup(b) {
      b.onResolve({ filter: /^\.\/menu$/ }, () => ({ path: stub }));
      b.onResolve({ filter: /^\.\/(session|table|orderStatus)$/ }, () => ({ path: nb }));
    } }] });
  const req = createRequire(import.meta.url); delete req.cache[out];
  const mod = req(out);
  // A clock that runs every wait at once, and remembers how long each one was meant to be.
  const realST = globalThis.setTimeout; const waits = [];
  globalThis.setTimeout = (fn, ms) => { waits.push(ms); return realST(fn, 0); };
  try {
    const answers = []; let firstFail = 0;
    await new Promise((resolve) => {
      const stop = mod.watchSessionsSwitch("rid-1", (s) => { answers.push(s); stop(); resolve(); }, () => { firstFail++; });
      realST(resolve, 3000);
    });
    ok(answers.length === 1 && answers[0].sessionsEnabled === true, `a read that fails twice is answered on the third ask (${answers.length} answer(s))`);
    ok(firstFail === 1, `…and the caller hears about the failure ONCE, not once per attempt (${firstFail})`);
    ok(waits.length === 2 && waits[0] >= 1500 && waits[0] <= 2500 && waits[1] >= 3750 && waits[1] <= 6250,
      `…after a widening, jittered wait (${waits.map((w) => w + "ms").join(", ")})`);
    // stopping it really stops it
    waits.length = 0; let late = 0;
    const stop2 = mod.watchSessionsSwitch("rid-2", () => { late++; });
    stop2();
    await new Promise((r) => realST(r, 50));
    ok(late === 0, "…and a reader stopped before it answered never calls back");
  } catch (e) { ok(false, `the reader could not be run: ${e && e.message}`); }
  finally { globalThis.setTimeout = realST; }
  return n;
}
{
  const readDisk = (f) => readFileSync(join(ROOT, f), "utf8");
  console.log("\nI. one failed read of the restaurant's switch is asked again, never taken as 'off'");
  bad += sectionIStatic(readDisk);
  bad += await sectionIRun(readDisk("lib/tableConnection.ts"));
  if (process.argv.includes("--self-test")) {
    console.log("\nSELF-TEST (section I)");
    const tcSrc = readDisk("lib/tableConnection.ts");
    const quiet = async (fn) => { const b = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = b; } };
    const bentRetry = tcSrc.replace("timer = setTimeout(() => { timer = null; if (alive) ask(); }, Math.round(wait * (0.75 + Math.random() * 0.5)));", "void wait;");
    if (bentRetry === tcSrc) { console.log("  ✗ sabotage 'the retry removed' matched nothing"); bad++; }
    else { const r = await quiet(() => sectionIRun(bentRetry)); if (r > 0) console.log(`  ✓ the retry removed → ${r} check(s) red`); else { console.log("  ✗ the retry removed → still green"); bad++; } }
    for (const [what, file, from, to] of [
      ["the card back to a one-shot read", "components/SessionStatusWidget.tsx", "watchSessionsSwitch(restaurantId,", "oneShot(restaurantId,"],
      ["the basket caching 'off' on a blip again", "components/SessionCartSync.tsx", "catch { return; }", "catch { enabled.current = false; }"],
    ]) {
      const orig = readDisk(file); const bent = orig.replace(from, to);
      if (bent === orig) { console.log(`  ✗ sabotage '${what}' matched nothing`); bad++; continue; }
      const r = await quiet(() => sectionIStatic((f) => (f === file ? bent : readDisk(f))));
      if (r > 0) console.log(`  ✓ ${what} → ${r} check(s) red`); else { console.log(`  ✗ ${what} → still green`); bad++; }
    }
  }
}

console.log(bad ? `\n✗ ${bad} check(s) failed` : "\n✓ every screen the sheet puts up can be seen, the floor gets the table number it knows, and a failed read is asked again");
process.exit(bad ? 1 : 0);
