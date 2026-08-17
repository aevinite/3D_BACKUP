// verify-owner-panel.mjs — "does the owner's cockpit tell him the truth about itself?"
//
//   npm run verify:owner-panel
//
// WHY THIS FILE EXISTS (sweep #6, terminal 13, 2026-08-17)
//
// Eight faults were found on the owner's three self-service screens — Menu, Team, Settings — and
// every one of them was the same shape: the screen SAID something that was not what had actually
// happened. It claimed a setting was off when a query had failed; it refused a change and erased
// the sentence explaining why; it drew a picker with nothing in it and told the owner to pick; it
// listed "the sections switched on for you" while leaving three of them out and naming two after
// screens that no longer exist.
//
// None of that is visible to a type-checker, and `verify:owner-clash` reported green throughout —
// it can see that a refusal is READ from the response, but not that the reload one line later
// clears it before a frame is painted. So these are the checks that would have caught them.
//
// Deliberately STATIC (no server, no database, no login): it must be safe to run in any lane of a
// parallel sweep, cost nothing, and never be able to trip a rate limit or raise an alert. Where a
// check genuinely needs a browser, the manual method is written into the ledger row instead
// (.claude/sweep/LEDGER/T13.md) rather than invented differently by the next reader.
//
// Companion guard: scripts/verify-owner-clash.mjs proves the owner panel SENDS an expectation and
// that the server refuses a stale write. This file proves the refusal reaches the owner's eyes.
import fs from "node:fs";
import path from "node:path";

let fail = 0, pass = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const read = (f) => { try { return fs.readFileSync(path.resolve(f), "utf8"); } catch { return null; } };
// Every one of these checks is about what the CODE does, and each fault here is documented in a
// long comment right beside its fix — comments that quote the old broken call order and name the
// helpers that were removed. Matching against them would make this guard pass or fail on prose.
// So: strip comments first, and decode the JSX entities the real sentences are written with
// (`isn&apos;t`), because the string a person reads on screen is the string being asserted.
const code = (s) => String(s || "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
const plain = (s) => String(s || "").replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&rsquo;/g, "’");

const ROSTER = "app/owner/staff/page.tsx";
const PERSON = "app/owner/staff/[id]/page.tsx";
const SETTINGS = "app/owner/settings/page.tsx";
const MENU = "app/owner/menu/page.tsx";

console.log("The owner's cockpit — Menu, Team, Settings\n");

// ── 1 · THE LOSER OF A CLASH IS ACTUALLY TOLD ────────────────────────────────────────────────
// The roster's inline rename reloads the list after a refusal (it must — the row has to show the
// value that really landed). `load()` ends its success path with `setErr(null)`, so if the message
// is set BEFORE that reload it is wiped before anyone sees it. Measured 2026-08-17: a real 409
// carrying `clash.plain` produced zero error banners in the DOM. Order matters, and only order.
{
  const src = read(ROSTER);
  if (!src) bad(`${ROSTER} not found (if it moved, update this guard)`);
  else {
    // `load()` must still be the thing that clears the banner on a good load — that is correct,
    // and it is what makes the ordering below load-bearing rather than incidental.
    if (/setErr\(null\)/.test(code(src))) ok("load() still clears the banner when the roster loads cleanly");
    else bad("load() no longer clears the banner — if that moved, re-check the ordering rule below");

    // Isolate saveEdit's catch block and require: await load() BEFORE the message is set.
    const bare = code(src);
    const fnStart = bare.indexOf("async function saveEdit");
    const fn = fnStart > -1 ? bare.slice(fnStart) : "";
    const nextFn = fn.indexOf("async function", 1);
    const body = fn.slice(0, nextFn > -1 ? nextFn : 4000);
    const catchIdx = body.indexOf("catch");
    const tail = catchIdx > -1 ? body.slice(catchIdx) : "";
    const loadAt = tail.indexOf("await load()");
    const errAt = tail.search(/setErr\(/);
    if (loadAt > -1 && errAt > -1 && loadAt < errAt) {
      ok("a refused rename refreshes FIRST and then says why — the sentence survives the reload");
    } else {
      bad("a refused rename sets the message before `await load()` — the reload will erase it "
        + "(CLAUDE.md item 11: first save wins, and the loser is TOLD)");
    }
    if (/clash[\s\S]{0,140}plain/.test(code(src))) ok("the roster reads the plain sentence out of a 409");
    else bad("the roster no longer reads `clash.plain` — a refusal would show a bare status code");
  }
}

// ── 2 · A REFUSAL IS ON SCREEN, NOT 950px ABOVE IT ───────────────────────────────────────────
// Every refusal on the roster renders in ONE place: a banner at the very top. The one-time
// password card has been scrolled into view since 2026-07-07 for exactly this reason ("an owner
// low on the page used to never see it"); the banner was not. Measured on a 360×780 phone: an Add
// refused from the bottom of the roster put the banner at y = -951px, so the tap looked ignored.
{
  const src = read(ROSTER);
  if (src) {
    const bare = code(src);
    const hasRef = /errRef/.test(bare);
    const scrolls = /errRef\.current\?\.scrollIntoView[\s\S]{0,200}\[err\]/.test(bare);
    const attached = /ref=\{errRef\}/.test(bare);
    if (hasRef && scrolls && attached) ok("a refusal on the roster brings itself into view");
    else bad(`the roster's error banner is not scrolled into view (ref=${hasRef} effect=${scrolls} attached=${attached}) `
      + "— on a phone it renders above the fold and the tap looks ignored");
  }
}

// ── 3 · "WHAT'S ENABLED" DESCRIBES THE PANEL IT IS PART OF ───────────────────────────────────
// The card is the only place an owner can confirm "that section is off on purpose". It listed six
// of the twelve keys the API answers, so Menu, Audit & logs and Manager mode had no chip at all —
// verified live: with `menu` off, the sidebar item vanished, /owner/menu said "ask your
// administrator", and this card said nothing. Two chips also carried names retired from every
// other surface ("Staff & powers", "Feedback & issues").
//
// The three logs_* keys are deliberately NOT chips — they are which KINDS of row the Audit & logs
// page shows, not sections — so they are excluded here by name rather than by silence.
const LOG_VIEW_KEYS = ["logs_signins", "logs_service", "logs_staff_changes"];
{
  const src = read(SETTINGS);
  const ents = read("lib/ownerEntitlements.ts");
  const shell = read("components/owner/OwnerShell.tsx");
  if (!src || !ents) bad(`${SETTINGS} or lib/ownerEntitlements.ts not found`);
  else {
    const keysLine = code(ents).match(/OWNER_SECTION_KEYS\s*=\s*\[([^\]]+)\]/);
    const allKeys = keysLine ? [...keysLine[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
    const sectionKeys = allKeys.filter((k) => !LOG_VIEW_KEYS.includes(k));
    if (!sectionKeys.length) bad("could not read OWNER_SECTION_KEYS — update this guard");
    const labelBlock = code(src).match(/SECTION_LABEL[^{]*\{([\s\S]*?)\n\};/);
    const labels = labelBlock
      ? Object.fromEntries([...labelBlock[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]))
      : {};
    const missing = sectionKeys.filter((k) => !(k in labels));
    if (!missing.length) ok(`every switchable section has a chip (${sectionKeys.length})`);
    else bad(`"What's enabled" has no chip for: ${missing.join(", ")} — the one card that explains a `
      + "missing section cannot explain those");
    const extra = Object.keys(labels).filter((k) => !allKeys.includes(k));
    if (!extra.length) ok("no chip names something that is not a real section key");
    else bad(`"What's enabled" shows chips for keys the server never answers: ${extra.join(", ")}`);
    for (const dead of ["Staff & powers", "Feedback & issues"]) {
      if (!Object.values(labels).includes(dead)) ok(`no chip says "${dead}" (a screen that no longer exists)`);
      else bad(`a chip still says "${dead}" — the sidebar and the page itself call it something else`);
    }
    // …and the names must be the ones he can actually see in the sidebar.
    if (shell) {
      // ONE nav item at a time: `[^{}]*` cannot leave the object literal, so a GROUP label
      // ("Business", "Account") can never be paired with the next item's `ent`.
      const nav = Object.fromEntries(
        [...code(shell).matchAll(/\{[^{}]*label:\s*"([^"]+)"[^{}]*ent:\s*"(\w+)"[^{}]*\}/g)].map((m) => [m[2], m[1]]));
      const drift = Object.entries(nav).filter(([k, label]) => k in labels && labels[k] !== label);
      if (!drift.length) ok("every chip is named exactly as the sidebar names that section");
      else bad(`chip vs sidebar name drift: ${drift.map(([k, l]) => `${k} card="${labels[k]}" sidebar="${l}"`).join("; ")}`);
    }
  }
}

// ── 4 · BOTH PER-TAB PINS SURVIVE THE ROUND TRIP ─────────────────────────────────────────────
// The roster's link INTO a person was fixed to carry ?as= in the T19 sweep. The way back built its
// URL from ?rid= alone, so an Aevidine tab opened for a restaurant's second owner silently fell
// back to the PRIMARY owner's estate the moment a profile was closed.
{
  const src = read(PERSON);
  if (!src) bad(`${PERSON} not found`);
  else {
    const fn = src.slice(src.indexOf("backToRoster"));
    const block = fn.slice(0, 700);
    const hasRid = /rid=\$\{encodeURIComponent\(rid\)\}/.test(block);
    const hasAs = /as=\$\{encodeURIComponent\(as\)\}/.test(block);
    const dep = /\[router,\s*rid,\s*as\]/.test(src);
    if (hasRid && hasAs) ok("closing a person's profile carries BOTH pins back to the roster");
    else bad(`closing a person's profile drops a pin (rid=${hasRid} as=${hasAs}) — the roster would `
      + "resolve a different owner than the tab was opened for");
    if (dep) ok("backToRoster is memoised on both pins, so a late-arriving pin is not stale");
    else bad("backToRoster's dependency list does not include `as` — it would close with a stale pin");
  }
  // and the roster's link OUT must still carry them (the T19 fix — do not let it regress either)
  const roster = read(ROSTER);
  if (roster) {
    const rb = code(roster);
    const w = rb.slice(rb.indexOf("const withRid"), rb.indexOf("const withScope"));
    if (/rid=/.test(w) && /as=/.test(w)) ok("the roster's link to a person still carries both pins");
    else bad("the roster's link to a person no longer carries both pins (the T19 fix regressed)");
  }
}

// ── 5 · "I COULDN'T ASK" IS NEVER PRINTED AS "IT IS SWITCHED OFF" ────────────────────────────
// /owner/menu resolved its restaurants through a helper ending in `.data || []`, so a failed query
// looked exactly like "the admin switched Menu off" — and the page said so, in words, sending the
// owner to support about a setting that was fine. Every other owner surface refuses to guess
// (see /api/owner/staff → transient(), lib/panelAccess → OwnedLookupFailed).
{
  const src = read(MENU);
  if (!src) bad(`${MENU} not found`);
  else {
    const bare = code(src), txt = plain(src);
    if (/\.error/.test(bare)) ok("/owner/menu inspects the error of its own read");
    else bad("/owner/menu ignores its read error — a database blip is reported as a switched-off feature");
    if (/couldntRead|couldNotRead/.test(bare)) ok("/owner/menu has a distinct state for \"couldn't read\"");
    else bad("/owner/menu has no separate \"couldn't read\" state — it can only say \"not switched on\"");
    const offMsg = /isn't switched on for your restaurant/.test(txt);
    const retryMsg = /please reload the page|please try again/i.test(txt);
    if (offMsg && retryMsg) ok("/owner/menu says two different things for two different reasons");
    else bad(`/owner/menu has only one message (off=${offMsg} retry=${retryMsg})`);
    // and it must not have gone back to reading the restaurants table twice for one page
    const reads = (bare.match(/sb\.from\("restaurants"\)/g) || []).length;
    if (reads <= 2) ok(`/owner/menu reads the restaurants table ${reads}× (one per caller branch)`);
    else bad(`/owner/menu reads the restaurants table ${reads}× for one page render`);
    if (!/entitledSubset/.test(bare)) ok("/owner/menu resolves the entitlement from the row it already read");
    else bad("/owner/menu is back to a second read via entitledSubset, whose empty answer is ambiguous");
    // the section switch must STILL be enforced here, not only in the sidebar
    if (/mergeOwnerEntitlements|entitledSubset/.test(bare) && /\.menu\s*!==\s*false|"menu"/.test(bare))
      ok("/owner/menu still enforces the admin's Menu switch server-side");
    else bad("/owner/menu no longer enforces the Menu section switch — hiding the nav row is never the only guard");
  }
}

// ── 6 · A PICKER WITH NOTHING IN IT DOES NOT ASK YOU TO PICK ─────────────────────────────────
// With the floor size unreadable (0), the waiter picker drew an empty box, "0 of 0 picked" and
// "Pick at least one table" — an instruction the screen was not offering, with Add disabled for
// good and nothing saying why.
{
  const src = read(ROSTER);
  if (src) {
    const bare = code(src);
    const guarded = /newRole\[r\.id\]\s*===\s*"tablet"\s*&&\s*!r\.tableCount/.test(bare)
      && /newRole\[r\.id\]\s*===\s*"tablet"\s*&&\s*!!r\.tableCount/.test(bare);
    const explains = /couldn't read how many tables/i.test(plain(bare));
    if (guarded && explains) ok("an unreadable floor size explains itself instead of asking the impossible");
    else bad(`the waiter picker still draws an empty grid when the floor size is 0 (guarded=${guarded} explains=${explains})`);
  }
}

// ── 7 · A LIMIT THE SERVER ENFORCES IS STATED WHERE IT IS TYPED ──────────────────────────────
// The server has always refused a password under 6 characters and cut a phone number at 20. The
// form said neither, so the owner learned both from a round trip — or, for the phone, never: the
// value was accepted and quietly truncated, and the roster then showed a number nobody typed.
{
  const src = read(ROSTER);
  const route = read("app/api/owner/staff/route.ts");
  if (src && route) {
    const pwMin = (route.match(/password\.length\s*<\s*(\d+)/) || [])[1] || "6";
    const pwField = (code(src).match(/name="password"[^/]*/) || [""])[0];
    if (new RegExp(`minLength=\\{${pwMin}\\}`).test(pwField) || new RegExp(`min ${pwMin}`).test(pwField))
      ok(`the Add form states/enforces the server's ${pwMin}-character password minimum`);
    else bad(`the Add form does not state the server's ${pwMin}-character password minimum — `
      + "the owner only learns it from a refusal");
    const phoneMax = (route.match(/body\?\.phone[^)]*\)\.trim\(\)\.slice\(0,\s*(\d+)\)/) || [])[1] || "20";
    const phoneFields = [...code(src).matchAll(/<input[^>]*(?:name="phone"|editing\.phone)[^>]*>/g)].map((m) => m[0]);
    if (phoneFields.length >= 2) ok(`both phone fields found (${phoneFields.length})`);
    else bad(`expected 2 phone inputs on the roster, found ${phoneFields.length} — update this guard`);
    const uncapped = phoneFields.filter((f) => !new RegExp(`maxLength=\\{${phoneMax}\\}`).test(f));
    if (!uncapped.length) ok(`every phone field stops at the server's ${phoneMax} characters`);
    else bad(`${uncapped.length} phone field(s) have no maxLength — a longer number is silently truncated on save`);
  }
}

// ── 8 · THE RULES THIS TERRITORY MUST NOT DRIFT BACK INTO ────────────────────────────────────
{
  const src = read(ROSTER);
  if (src) {
    // Only the admin holds permissions — the owner panel configures none (docs/ACCESS-MODEL.md).
    if (!/set_permissions/.test(code(src))) ok("the roster still writes no permission of any kind");
    else bad("the roster is writing permissions again — only the admin holds those");
    // Kitchen has no profile, ruled three times. The roster must not decide that for itself.
    if (!/role\s*===\s*"kitchen"/.test(code(src))) ok("the roster does not branch on the kitchen role itself (it trusts profileEligible)");
    else bad("the roster branches on the kitchen role directly — one source decides who has a profile");
    // "waiter", never the storage word, on every one of the three places it is shown.
    const waiterLabels = (code(src).match(/\?\s*"waiter"\s*:/g) || []).length;
    if (waiterLabels >= 3) ok(`"tablet" is shown as "waiter" in all ${waiterLabels} places`);
    else bad(`only ${waiterLabels} of 3 places translate "tablet" to "waiter"`);
  }
  const settings = read(SETTINGS);
  if (settings) {
    // Owners configure no features (owner, 2026-07-31) — the API still answers `modules`; nothing renders it.
    if (!/modules\.map|modules\?\.map/.test(code(settings))) ok("the settings page still renders no feature toggle");
    else bad("the settings page is rendering feature toggles again — every switch is the admin's");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("\n❌ FAIL — the owner's cockpit is telling him something that did not happen.");
else console.log("\n✅ PASS — Menu, Team and Settings each say what actually happened");
process.exit(fail ? 1 : 0);
