// T17 · re-run of EARLIER sweeps' rows whose subject is a file this terminal owns, and update
// each row's `result` IN PLACE in the ledger file where it lives.
//
// The ledger is keyed to sweep #6's territory split, so no single file is "mine": these rows are
// scattered across T12/T13/T14/T27/T29/T15/T16/T30/T20/T26/T11/T5/T8/T28. Rows about files I do
// NOT own are deliberately absent — another terminal is re-running those, and two terminals
// editing one row is how three ledger collisions have already happened.
//
// Every verdict below is one I actually established this run: by the suites in this folder
// (verify:owner-shell · report-checks · live · interact), by reading the file as it is today, or
// by driving it. Where a row asserts something this branch CHANGED, it is marked ✅ and the note
// says what superseded it — a row is never silently rewritten to match new code.
import fs from "node:fs";

const DIR = ".claude/sweep/LEDGER";
// id → [result, note]
const V = {};
const set = (ids, result, note) => { for (const id of ids.trim().split(/\s+/)) V[id] = [result, note]; };

const S = "verify:owner-shell (98 static checks, sabotage-tested)";
const L = "driven headless on port 4317 (scripts/sweep/t17/live.mjs, 304 rows)";
const I = "driven headless on port 4317 (scripts/sweep/t17/interact.mjs, 71 rows)";
const R = "scripts/sweep/t17/report-checks.mjs (89 rows, the document as a pure builder)";

// ── the shell: nav, crumb, switcher, skin, overlays ─────────────────────────────────────────────
set("P05695", "✅", "re-read the loop: `it.exact ? path === it.href : path === it.href || path.startsWith(it.href + \"/\")`, longest match wins. Still right, and still stricter than `isActive` a few lines below (which uses a bare startsWith) — no two owner routes are prefixes of each other today, so nothing is mis-labelled.");
set("P05702 P20817", "✅", `${S} §8 asserts all three by name (owner-xray-zones, owner-nav, owner-rest-switch) and goes red if any is removed. ${I}: on a 360px phone ☰ opens the drawer and hardware Back closes it WITHOUT leaving /owner/settings.`);
set("P05724 P20809 P40349 P06173 P06240", "✅", `${S} §5 requires both writers (the header toggle and Settings' Light/Dark) to write localStorage AND the cookie. ${I} measured it live: one tap → localStorage light, cookie light, and the next hard load paints light on its FIRST frame.`);
set("P05728", "✅", `${S} §6. ${I} measured the broadcast: exactly ONE \`lfh:owner-skin\` per tap (the T12 sweep's own fix for a double-fire holding), the embed's address unchanged, and the embedded editor's body class flipped to skin-light.`);
set("P05731 P20804 P40344", "✅", `${S} §11 now counts BOTH chips, not just one — a sabotage that changed one of the two used to pass. R20 holds: the chip says "Owner overview" and never the page name.`);
set("P05787 P21025", "✅", `${I}: picked a restaurant from the top switcher on Dashboard, Manager mode and Settings. Dashboard and Manager mode both stayed on their own address and the bar's pill changed to the restaurant's name; Settings correctly navigates (it does not re-scope in place). ${S} §11 asserts all three channels exist.`);
set("P05792 P20928", "✅", `${L}: on /owner/manager the ☰ burger is on screen and the sidebar is off-canvas (transform translateX(-295px)) at 1280 AND at 360. Still deliberate — but see item 6 in the T17 report: on the LAUNCHER there is no floor to give the screen to.`);
set("P05840 P05843", "✅", `${L}: at 1280 the crumb reads "Owner › Manager mode › <restaurant>"; at 360 it is display:none by design and the ☰ drawer is the way back (${I} drove exactly that).`);
set("P05845 P05846 P20929 P21024 P40037", "✅", `${I}: hard-loaded /owner/manager on a phone, tapped a launcher card, and the bar's crumb named the restaurant on the floor ("Owner › Manager mode › Pizza Palace") — so the child's rAF second emit still lands after the shell has attached its listener.`);
set("P05942 P21020 P06017 P06241", "✅", `${S} §5/§6 + ${L}: the shell's data-skin, the cookie, localStorage and the embed's \`?skin=\` all read the same value in all 24 page-load combinations.`);
set("P05945 P21022", "✅", "re-read the four emitters. Manager mode still emits twice (now + next frame) with the comment intact; the dashboard/reports/activity emitters still re-run when their data lands. Measured by driving a hard load, above.");

// ── /owner/menu, the server page ────────────────────────────────────────────────────────────────
set("P06001 P06248", "✅", `${S} §9 asserts \`mergeOwnerEntitlements(r.owner_entitlements).menu !== false\` on the server, and goes red if it is removed. Hiding is still not the only guard.`);
set("P06002", "✅", "SUPERSEDED BY A DECISION, NOT BROKEN. The \"not switched on — ask your administrator\" card this row watched was DELETED on 2026-08-31 under R36 (*\"owner can't know which option are not given to them\"*); the page now `redirect(\"/owner\")`. So the row's letter is unsatisfiable and its spirit — the editor must never render for an owner whose Menu is off — is intact: `if (!selected) redirect(\"/owner\")` still precedes the `<OwnerMenuEditor>` return. Do not re-file the card.");
set("P06003 P06004", "✅", "re-read: `selected = qRid && ids.includes(qRid) ? qRid : (ids[0] || \"\")`, and `ids` is derived from the entitled, owned set. The admin branch still reads the row by that id and renders only if the row exists.");
set("P06005 P06006", "✅", `SUPERSEDED BY ITEM 3 OF THIS RUN, and P06006 was the fault. The picker was ordered by "the entitled-id order", which is whatever PostgREST returned for an \`.in()\` with no \`order by\` — so \`ids[0]\`, i.e. WHICH restaurant's menu opens, was not repeatable. It is now \`byName()\`-sorted (components/owner/ownerRestaurantSort.ts) and measured 16/16 identical. "Every id gets a name or a safe fallback" still holds ("Restaurant").`);
set("P06007 P06242", "✅", `${S} §5 pins the cookie read to the shell's own default in both pages; dark is still the default and nothing forces light.`);
set("P06008 P06009", "✅", `${S} §9 measures the position of the gate against the position of the first \`sb.from(\`: the caller is identified first, and the admin branch still demands BOTH the act-as cookie and \`tokenIsValid\`.`);
set("P06010 P06021", "✅", `${S} §9 asserts \`let couldntRead\` and its render branch by name. Still the one owner screen that answers "I couldn't ask" separately from "it is switched off".`);
set("P06011 P06012 P06013 P06014 P06221 P06222", "✅", `${S} §9: columns named, no \`select("*")\`, every read scoped by id, and the read still sits inside \`if (owned.length)\`.`);
set("P06015 P06016", "✅", `${S} §9 asserts \`await searchParams\` and \`await cookies()\` in both server pages.`);
set("P06018 P06019", "✅", "re-read both branches; `selected` is only ever an id present in `restaurants`, and `!selected` returns before the editor.");
set("P06020 P06023", "✅", "still a server component (no `\"use client\"`), re-resolved per request, so a stale `?rid=` cannot outlive an entitlement change.");
set("P06022", "✅", "re-read: `enabledOwnedRestaurantIds` still throws `OwnedLookupFailed` rather than shortening, and `app/owner/layout.tsx` still runs before the page — so the throw is caught upstream and the owner meets the reconnect card, not a crash.");
set("P06024", "✅", "grepped: no `console.` in the file and no cookie name inside a template string.");
set("P06025", "✅", "the empty-state screen this row was about is gone (P06002). The card that remains — the failed-read one — heads itself `adm-page-h`, which app/globals.css really declares. Its wrapper `adm-page` is declared nowhere, but that class carries no styling anywhere in the repo and the heading inside it is styled, so nothing renders wrong; recorded here so it is not re-filed as a fault.");
set("P06213 P06214", "✅", "re-read: the page renders only the picker and the embed, adds no switch of its own, and OwnerMenuEditor's note about needing a panel save is intact.");
set("P06223", "✅", "STILL ONE READ, and this row records the fix. `entitledSubset` is no longer called here at all — the page asks for `id, name, owner_entitlements` in a single trip and filters in JS. Item 2 of this run removed a column from the Manager-mode page's equivalent read for the same reason.");
set("P06237", "✅", `${S} §7 asserts the imperative mount by name in both embeds and that neither renders a JSX <iframe>. ${I} measured it: opening the floor changed history.length by 1, not 2, and Back returned to the launcher instead of blanking it.`);
set("P06239", "✅", `${S} §5 walks all twelve files and fails if any of them names \`lfh_theme\` or \`lfh_panel_theme\`. None does.`);

// ── /owner/settings ─────────────────────────────────────────────────────────────────────────────
set("P06165 P06167 P06168", "✅", "re-read: the pin is read once in the `useState` initializer (a pure read — nothing is rendered from it, so no hydration divergence), and `scp` is appended to both the GET and the POST.");
set("P06194", "✅", `${S} §10 now derives the sidebar's gated \`ent:\` keys and requires a chip for every one of them (modules excluded, which is the documented split), plus the specific "Guest ratings — in Feedback & complaints" wording the owner asked for on 2026-09-01. Measured on screen: 9 chips for a two-restaurant owner with everything on.`);
set("P06198", "✅", "grepped: `modules` is still in the type and rendered by nothing. Owners configure no features.");
set("P06199", "✅", `${L} asserts the sub-line's words on screen in all 8 Settings combinations: "Taxes, branding and billing are managed for you by Aevidine."`);
set("P06367", "✅", `${L}: /owner/settings answers 200 for both roles at both sizes in both skins, with Appearance, Change password and What's enabled all on screen, no page error and no leaked code text.`);
set("P06396 P06399 P06400 P06403 P06404", "✅", "screenshots re-taken at 1280×900 and 360×780 dpr3, light and dark, and READ: the cards read Appearance → Kitchen printing → Change password → What's enabled → Your restaurants; every chip and label legible in both skins; the chips wrap; both skin buttons fully visible at 360.");
set("P06397", "✅", `${I}: the active skin carries \`aria-pressed="true"\`, so it is marked by more than colour.`);
set("P06398", "✅", "SUPERSEDED BY R36 (owner, 2026-08-18). There is no ✗ on this card any more and there must not be — the card lists only what is ON. The ✓ chips are legible in both skins (screenshots read this run).");
set("P06401", "✅", "screenshot read at 1280 light: all three password boxes render as outlined fields with visible placeholder text, not white on white.");
set("P06402", "✅", "screenshot read at 360 dark: the form and its three boxes fit 360px with no sideways scroll (measured scrollWidth 360 = clientWidth 360).");
set("P06405", "✅", "re-read the branch: `err` renders a card bordered `--adm-danger` with the sentence and a \"Try again\" button that calls `load()`. Not re-forced live this run — the row is a rendering claim about a branch that has not changed, and forcing it needs a request-blocking fixture; ⏭ would be dishonest for a branch that IS present, so this is recorded as a read.");
set("P06447 P06448 P06449 P06450", "✅", `${I} drove all four end to end: Settings' Light tap repainted the console, stored light in localStorage AND the cookie, the dashboard opened light on its first frame, and \`lfh_theme\` stayed null throughout.`);
set("P06451", "✅", "STILL TRUE, and worth the detail so nobody panics at it: `lfh_panel_theme` DOES appear in localStorage after visiting /owner/menu — the embedded panel loads public/panels/theme.js in its own head and that script materialises the staff default (\"light\") on boot, as it does for the manager panel itself. What this row asserts is unaffected and was measured both ways: with the console on light the key is \"light\"; switching the console to DARK leaves it \"light\". The owner's choice never reaches the staff panels' remembered theme.");
set("P21101 P21211 P21213 P21358 P21376 P21384 P21398", "✅", "`npm run verify:owner-s7` re-run in full: 300 passed, 0 failed. (It went red once during this run — for `verify:owner-s7` P21278, and because MY new import path contained the word \"Order\". The check was right; the file was renamed to ownerRestaurantSort.ts and a note added so nobody renames it back.)");

// ── /owner/manager + the embeds ─────────────────────────────────────────────────────────────────
set("P06673 P21764 P47691", "✅", `${S} §5 + ${L}: read from the \`aevidine_skin\` cookie, defaulting dark, in both server pages, and never from \`lfh_theme\`.`);
set("P06696 P06991", "✅", "re-read: still ONE engine. Both embeds point at `/panels/editor/index.html` — Manager mode with `?ownermode=1`, Menu with `?menuonly=1` — so there is no second implementation to drift.");
set("P06700 P06970 P21946 P22085 P47783 P48636", "✅", `${I} measured the live path: one tap of the header toggle, one broadcast, the frame's address UNCHANGED, and the frame's own body class flipped. No reload, no refetch.`);
set("P06806 P21867 P48375", "✅", `${L}: for the single-restaurant owner /owner/manager renders the floor iframe (\`ownermode=1\`) straight away; for the two-restaurant owner it renders the launcher. Both at 1280 and 360, both skins.`);
set("P06905 P06906 P06907 P22013 P22014 P22015 P47670", "✅", "screenshots re-read at 1280: the manager panel's own header sits under the cockpit's, the floor takes the full width, and no print prompt appears anywhere in the cockpit.");
set("P06908 P06909 P22016 P47672", "✅", "screenshots re-read at 360 dpr3: the floor is readable, nothing is cut off, and measured scrollWidth 360 = clientWidth 360.");
set("P06910 P22017 P47674", "✅", `${L}: on the light skin the embedded floor is light too — the shell's own background reads rgb(246,247,249) and the frame is born \`skin=light\`.`);
set("P22018", "✅", "re-read: no print-helper prompt is rendered by anything in this territory, and none appeared in any of the 24 driven page loads.");
set("P06956 P22081 P47778", "✅", "re-read `editorScope`: the embed echoes `?rid` and the editor route validates it against the owner's estate, so a write from Manager mode is attributed to the OWNER. No shadow manager account.");
set("P06961", "✅", `${S} §10 + re-read of OwnerShell's \`ent: "khata_book"\`: the Pay Later row is still gated on the module being effective, so it cannot appear as a dead section.`);
set("P06964 P47424", "✅", `${S} §9 asserts \`entitledSubset(…, "manager_mode")\` on the server and §3 that BOTH branches of the page (real owner and admin act-as) sort their list. Removing the entitlement check makes the guard red.`);
set("P47421 P48401 P47784", "✅", `${S} §11 asserts \`if (!on && (!adminViewing || simulated)) return null\` by name — a withheld section disappears for the real owner and is only tinted for the admin, and OwnerShell is still the one place that decides.`);
set("P47313 P48365", "⏭", "still not drivable on this stack, and honestly so: it needs a real owner with NO entitled restaurant for Manager mode, and switching `manager_mode` off for a restaurant this sweep's other terminals are also reading is a write I will not make. The branch itself was re-read and `verify:owner-shell` §9 now asserts the `redirect(\"/owner\")` that this row is about, statically.");
set("P47343", "✅", "re-driven: the embedded floor offers no kitchen-ticket print control inside the owner cockpit.");
set("P47407 P21953", "✅", "re-driven `?rid=not-a-uuid` on /owner/manager as the two-restaurant owner: the page ignores it (the id is not in the owner's set) and renders the launcher. No redirect, no error.");
set("P48491", "✅", "re-read line 1: no `\"use client\"`. Still a server component.");
set("P48545", "✅", "grepped: the Manager-mode page has no timer of its own; the embed owns its polling.");
set("P48668 P48670 P48671", "✅", `${L} walked all three: /owner/menu, /owner/settings and /owner/manager answer on their own addresses for both roles, both sizes, both skins.`);
set("P48762", "✅ not ours", "unchanged: the console error this row records is on the LIVE site's /owner/menu and belongs to the deployed build, not to this territory's source. Re-checked locally across 24 page loads: no console error on /owner/menu in any of them.");

// ── shared components ───────────────────────────────────────────────────────────────────────────
set("P13359 P13362 P13390 P13391 P13392", "✅", "re-read every user-facing string in the three files this run touched. All English, all staff-facing surfaces (no `lib/i18n.ts` obligation), and the new strings added this run are English too.");
set("P14035 P14187 P43975", "✅", "`npm run verify:ui` re-run: passed, including its one-writer check. CLAUDE.md's light-mode paragraph is still factually right about `aevidine_skin` on the owner console.");
set("P14188", "✅", "`npm run typecheck` passes and every one of the eight components is imported by something. `ownerRestaurantSort.ts` joins them this run, imported by three call sites.");
set("P14249 P07467 P06446 P06158 P06208", "✅", `${S} §8 asserts \`pageHosted: true\` (the owner's profile is a real page, so it registers NO back layer — two layers made the first Back press dead). Re-read \`can\`: pin, signIn, role, visitAsPerson and accessLink are all false, so the owner is offered no control the route cannot honour, and \`patch()\` still sends \`X-LFH-Expect\`.`);
set("P07472", "✅", "re-read OwnerShell's `sectionOn` beside `entitledSubset()`: a switched-off owner page disappears from the nav AND is refused by the page. Both halves asserted statically now.");
set("P14438", "✅", `${S} §10 asserts \`/print-setup.html\` is reachable from the Settings screen, and ${L} sees the four guide buttons on screen in every combination.`);
set("P22896 P22897 P22898", "✅", "re-read `useAnimatedValue`: `fromRef` still holds the last displayed value so a later snapshot counts from it and not from 0; `fromRef.current === value` still short-circuits; `cancelAnimationFrame(rafRef.current)` still runs in the cleanup.");
set("P14816 P14846 P14847 P14873", "✅ confirmed", `${L}: /owner/settings and /owner/manager both answer with real content and zero page errors for both roles at 1280×900 and 360×780 dpr3, and the light skin genuinely paints the console light — measured on the SHELL's own background (rgb(246,247,249)), which is the documented way, not on \`document.body\`.`);
set("P29990", "✅ captured", "re-photographed this run at 1280×900 and 360×780, light and dark, into .claude/sweep/shots/T17/ — and the launcher shot is the evidence for items 1 and 2 of the T17 report.");
set("P47269", "✅", `${S} §10 asserts \`printing && printing.restaurantId === p.restaurant_id\` by name, so a printing row can never again borrow another restaurant's printer. Sabotage-tested.`);
set("P25023 P25030 P09850 P09851", "✅", `${L} + screenshots read: /owner/settings renders with no leaked code text, and the Appearance toggle shows Light and Dark with the active one marked by \`aria-pressed\`, driven by \`aevidine_skin\`.`);
set("P12692 P12707", "✅", `${S} §5: one skin key, dark still the default, \`lfh_theme\` untouched.`);
set("P12925", "✅", "screenshot re-read in both skins: the sidebar brand mark's ink is legible on the emerald accent.");
set("P05431 P46226", "✅", `${I} drove it rather than reading it: the console's own light/dark control writes \`aevidine_skin\` and \`lfh_theme\` stays null.`);
set("P05460", "✅", "unchanged — `.owx-scrollx` still scrolls sideways inside itself rather than moving the page; measured scrollWidth = clientWidth on the document at 360 for all three of my pages.");
set("P94798 P94799 P01840", "✅", "re-driven: no offline strip appears on /owner/menu or /owner/manager while online, in any of the 24 page loads.");
set("P62300 P62369 P99449 P99478", "✅", "re-read + re-driven: the owner console's skin arrives by postMessage and never in the iframe `src` (only the born value is there), and Manager mode embeds the same editor document, showing the floor.");
set("P36548", "✅", "`npm run verify:owner-territory` re-run: passed. It is still pinned to a token in `app/owner/menu/page.tsx` that this run did not remove.");

// ── apply ───────────────────────────────────────────────────────────────────────────────────────
// SPLIT ON A REAL PIPE, NOT AN ESCAPED ONE.
//
// Many existing rows quote code in their `how to verify` column, and a `||` in that code is
// written `\|\|` so markdown does not read it as a column break. A naive `line.split("|")`
// counts those as boundaries — so the result column moves, and writing to a fixed index
// overwrites the middle of somebody's code quote and truncates the rest of the row. That is
// exactly what happened to T14's P47421 (`read \`if (!on && (!adminViewing \|\| simulated))
// return null\``) on the first attempt, and it is silent: the row still looks like a row.
const cells = (line) => line.split(/(?<!\\)\|/);
const join = (cs) => cs.join("|");

// Walk UP from a row to the header of the table it is actually in, and return the index of that
// table's `result` column.
//
// THE NEAREST HEADER, FOUND BY ITS SEPARATOR — not "the nearest line containing the word id".
// Two traps, both hit for real while writing this:
//   · the ledgers do not share a column layout. T12/T13/T14/T15/T20/… are
//     `| id | check | how to verify | result | note |` (5 data columns); T16's are
//     `| id | what | result | note |` (4). Writing the result into a fixed position put it into
//     T16's NOTE column and printed the tick twice — three rows mangled, caught only by counting
//     fields against origin/main.
//   · some ledgers ALSO carry narrative tables that quote a phase id in their first cell, e.g.
//     T13's `| row | what it was | why it was missed |`. Those are prose, not phase rows, and
//     writing a result into them would invent a column. So the header is located by the markdown
//     SEPARATOR (`|---|`) directly beneath it, which every table has and no data row can fake, and
//     a table whose header has no `result` column is refused rather than guessed at.
function resultCol(lines, at) {
  for (let i = at; i >= 0; i--) {
    if (!/^\|/.test(lines[i])) continue;
    if (!/^\|[\s:-]*-[\s|:-]*\|?\s*$/.test(lines[i])) continue;       // a |---|---| separator
    const header = cells(lines[i - 1] || "").map((c) => c.trim().toLowerCase());
    const k = header.findIndex((c) => c === "result" || c === "outcome");
    return k > 0 ? k : -1;                                              // this table, or refuse
  }
  return -1;
}

const files = fs.readdirSync(DIR).filter((f) => /^T\d+\.md$/.test(f) && f !== "T17.md");
let done = 0; const skipped = []; const notFound = new Set(Object.keys(V));
for (const f of files) {
  const p = `${DIR}/${f}`;
  const lines = fs.readFileSync(p, "utf8").split("\n");
  let touched = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*(P\d{5,6})\s*\|/);
    if (!m || !V[m[1]]) continue;
    const [result, note] = V[m[1]];
    // NOT EVERY LEDGER HAS THE SAME COLUMNS, and assuming they do corrupts rows silently.
    // T12/T13/T14/… are `| id | what | how | result | note |` (5 data columns) but T16's are
    // `| id | what | result | note |` (4). Writing the result into position 4 regardless put it
    // into T16's NOTE column and duplicated the tick — three rows mangled, caught only by counting
    // fields against origin/main. So: find the row's OWN header and locate the result column by
    // NAME, per file, and refuse the row if the header cannot be read.
    const cols = cells(lines[i]);
    const ri = resultCol(lines, i), ni = ri + 1;
    if (ri < 0 || cols.length < ni + 1) { skipped.push(`${f}:${i + 1} ${m[1]} (could not locate the result column)`); continue; }
    cols[ri] = ` ${result} `;
    cols[ni] = ` ${note.replace(/\|/g, "\\|")} `;
    lines[i] = join(cols.slice(0, ni + 1)) + "|";
    touched = true; done++; notFound.delete(m[1]);
  }
  if (touched) fs.writeFileSync(p, lines.join("\n"));
}
console.log(`updated ${done} rows in place across ${files.length} ledger files`);
if (skipped.length) { console.log("SKIPPED (left untouched rather than guessed):"); skipped.forEach((x) => console.log("  " + x)); }
if (notFound.size) console.log(`ids I named but could not find (bad id in this script, not a missing row): ${[...notFound].join(" ")}`);
