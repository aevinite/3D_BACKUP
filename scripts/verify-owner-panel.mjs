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
    // The message may be put on screen through any of the page's reporting calls — `fail(e)` keeps
    // the thrown error's own kind (clash / refused / fault, added 2026-08-18), `say(...)` is for one
    // we make ourselves, and `setErr` is the raw setter underneath both. Whichever is used, it has
    // to come AFTER the reload, or the reload's `setErr(null)` erases it.
    const errAt = tail.search(/\b(setErr|fail|say)\(/);
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
    const scrolls = /errRef\.current\?\.scrollIntoView[\s\S]{0,240}\[\s*err\b[^\]]*\]/.test(bare);
    const attached = /ref=\{errRef\}/.test(bare);
    if (hasRef && scrolls && attached) ok("a refusal on the roster brings itself into view");
    else bad(`the roster's error banner is not scrolled into view (ref=${hasRef} effect=${scrolls} attached=${attached}) `
      + "— on a phone it renders above the fold and the tap looks ignored");
    // …AND SO DOES THE SECOND ONE (T13 sweep, 2026-08-27 — measured).
    // The effect above was keyed on `[err]` alone. Setting state to the string it already holds is a
    // no-op in React, so a run of identical refusals — the same username typed twice, the same short
    // password — re-rendered nothing and the effect never fired again. Measured on a 360×780 phone:
    // attempt 1 put the banner at y = 194 (on screen), attempt 2 left it at y = -1190 (off the top),
    // with the owner's typing still in the boxes. The message must therefore carry something that
    // ALWAYS moves, and the effect must watch it.
    // This asserts the property, not the name: whatever the counter is called, both `say` and `fail`
    // must bump it, and the scroll effect must depend on it.
    const nonce = (bare.match(/const \[(\w+), set(\w+)\] = useState\(0\)/) || [])[1];
    const bumps = nonce
      && new RegExp(`say = useCallback\\([\\s\\S]{0,220}set${nonce[0].toUpperCase()}${nonce.slice(1)}\\(`).test(bare)
      && new RegExp(`fail = useCallback\\([\\s\\S]{0,320}set${nonce[0].toUpperCase()}${nonce.slice(1)}\\(`).test(bare);
    const watched = nonce && new RegExp(`errRef\\.current\\?\\.scrollIntoView[\\s\\S]{0,240}\\[[^\\]]*\\b${nonce}\\b`).test(bare);
    if (bumps && watched) ok("…and so does the SECOND identical refusal — the message carries a counter that always moves");
    else bad(`a repeated identical refusal would not come back onto the screen (counter=${nonce || "none"} bumped=${!!bumps} watched=${!!watched}) `
      + "— React skips a re-render when the message is unchanged, so the scroll never fires again");
  }
}

// ── 3 · "WHAT'S ENABLED" LISTS WHAT HE HAS, AND NEVER WHAT HE DOESN'T ────────────────────────
// REJECTED (owner, 2026-08-18) — row R36 in docs/REJECTED-IDEAS.md: *"owner can't know which option
// are not given to them only admin should know that"*. So the FIRST job of this section is to keep the off-state off the
// screen — no ✗, no greyed chip, no "6 of 9" count. What is withheld is the admin's business.
//
// The second job is the half that survived: the label map must still hold every section, because a
// section he DOES have must never be missing a chip. Before 2026-08-17 the map held six of nine, so
// a restaurant with Menu, Audit & logs or Manager mode switched ON simply did not list them on a
// card headed "the sections Aevidine has switched on for you" — it under-reported what he had.
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
    // R36 — the off-state must not exist on this screen at all.
    const card = code(src);
    const cardBlock = card.slice(card.indexOf("What&apos;s enabled"), card.indexOf("Your restaurants"));
    if (!/fa-xmark/.test(cardBlock)) ok("R36 — no ✗ chip: the card never shows what is switched off");
    else bad("R36 BROKEN — the card shows a ✗ for a withheld section (owner, 2026-08-18: \"owner can't "
      + "know which option are not given to them only admin should know that\")");
    if (/filter\(\(k\) => data\.sections\[k\] !== false\)/.test(cardBlock))
      ok("R36 — the card filters to the sections that are ON before rendering");
    else bad("R36 — the card no longer filters to ON-only sections before rendering");
    if (!/of \$\{?Object\.keys\(SECTION_LABEL\)/.test(cardBlock) && !/\bof 9\b/.test(cardBlock))
      ok("R36 — no \"N of M\" count, which would leak the total he does not have");
    else bad("R36 — the card counts against the full list, which reveals what is withheld");

    const missing = sectionKeys.filter((k) => !(k in labels));
    if (!missing.length) ok(`the label map covers every section, so one he HAS is never missing (${sectionKeys.length})`);
    else bad(`"What's enabled" has no label for: ${missing.join(", ")} — a restaurant with that section `
      + "switched ON would not see it listed on a card that claims to list what is on");
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
    // ONE SOURCE DECIDES WHO HAS A PROFILE — and that is `profileEligible`, from the server.
    // This used to forbid the string `role === "kitchen"` outright. That was the WORDING, not the
    // rule: on 2026-08-19 the roster gained a line explaining why a kitchen row is shorter, and it
    // needs the role to word that sentence — a waiter who is ineligible because the payroll module is
    // off must not be told "kitchen screen only". So the real rule is what is asserted now: every
    // place that decides whether to SHOW profile UI keys off profileEligible, and the role may only
    // ever pick words. (This file's own advice: assert the rule, not the spelling.)
    const bareR = code(src);
    const roleUses = [...bareR.matchAll(/s\.role === "kitchen"/g)].map(m => bareR.slice(Math.max(0, m.index - 120), m.index + 40));
    const allWordingOnly = roleUses.every(w => /!s\.profileEligible/.test(w));
    if (allWordingOnly) ok(`the role is used for wording only (${roleUses.length}×); profileEligible still decides who has a profile`);
    else bad("the roster decides profile UI from the kitchen ROLE — that decision belongs to the "
      + "server's profileEligible, which also covers a restaurant whose payroll module is off");
    // Checked by LINE PROXIMITY, the way the JSX actually reads: each of these three elements sits a
    // few lines under its own `{s.profileEligible && …}` guard. A single flat regex over the whole
    // file kept matching across unrelated blocks, which is how a guard ends up red on working code.
    const rl = src.split("\n");
    const ungated = [];
    for (const cls of ['className="ost-prog"', 'className="ost-mini open"', 'className="ost-nopay"']) {
      const i = rl.findIndex((l) => l.includes(cls));
      if (i === -1) continue;                       // element gone; other checks cover that
      if (!rl.slice(Math.max(0, i - 8), i).some((l) => /s\.profileEligible/.test(l))) ungated.push(cls);
    }
    if (!ungated.length) ok("…and every profile/pay element on the row still sits behind profileEligible");
    else bad(`these row elements lost their profileEligible gate: ${ungated.join(", ")} — a kitchen `
      + "login would then be offered a profile, which he has refused three times");
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

// ── 9 · THE THREE THINGS HE ASKED FOR ON 2026-08-18 ──────────────────────────────────────────
// He picked these off the 🟡 list himself ("can do this"), so they are not taste any more — losing
// one silently in a later refactor would be losing something he chose.
{
  const src = code(read(ROSTER));
  if (src) {
    // 12 · find a person. It must filter what the row SHOWS (the badge says "waiter"), the login,
    // and the phone — and it must not fetch anything.
    const hasBox = /className="ost-find"/.test(src) && /type="search"/.test(src);
    const filters = /includes\(needle\)/.test(src);
    const searchesWaiter = /s\.role === "tablet" \? "waiter"/.test(src) && /\[s\.name[\s\S]{0,160}needle/.test(src);
    if (hasBox && filters) ok("12 — the Team roster has a search box that filters the list");
    else bad(`12 — the roster's search is gone (box=${hasBox} filter=${filters})`);
    if (searchesWaiter) ok("12 — searching the word on the badge (\"waiter\") finds a tablet login");
    else bad("12 — the search no longer matches the role word the row actually shows");
    if (!/fetch\([^)]*q\b/.test(src)) ok("12 — the search is a view filter, it queries nothing");
    else bad("12 — the search is issuing a request; it must only filter the list already loaded");

    // 13 · working people first, disabled under their own heading, sharing ONE row renderer.
    const grouped = /const working = team\.filter\(\(s\) => s\.active\)/.test(src)
      && /const disabled = team\.filter\(\(s\) => !s\.active\)/.test(src);
    const heading = /ost-offhead/.test(src) && /cannot sign in/.test(src);
    const oneRow = (src.match(/const personRow = /g) || []).length === 1
      && /working\.map\(personRow\)/.test(src) && /disabled\.map\(personRow\)/.test(src);
    if (grouped) ok("13 — the roster splits people who can sign in from people who cannot");
    else bad("13 — the disabled people are back in one mixed list");
    if (heading) ok("13 — the disabled group has its own heading, and it says they cannot sign in");
    else bad("13 — the disabled group has no heading of its own");
    if (oneRow) ok("13 — both groups render through ONE row function, so they cannot drift apart");
    else bad("13 — the person row is duplicated per group; two copies is how twin surfaces drift");

    // 14 · the banner is headed by the reason, and a clash is not painted as danger.
    const kinds = /type ErrKind = "clash" \| "refused" \| "fault"/.test(src);
    const heads = /ERR_HEAD\[errKind\]/.test(src) && /got there first/.test(src) && /didn't go through/.test(src);
    const amber = /errKind === "clash" \? "var\(--adm-warn\)"/.test(src);
    const labelled = /throw new CallError\([\s\S]{0,120}"clash"\)/.test(src);
    if (kinds && heads) ok("14 — the banner is headed by WHY it is there, not always \"Something went wrong\"");
    else bad(`14 — the banner heading no longer follows the reason (kinds=${kinds} heads=${heads})`);
    if (amber) ok("14 — a clash is amber, not danger red: nothing is broken and nothing was lost");
    else bad("14 — a clash is painted as danger again");
    if (labelled) ok("14 — a 409 clash is labelled at the point it is thrown, not guessed at later");
    else bad("14 — the clash is no longer labelled where it is thrown, so the heading cannot know");
    // …and every message on the page still goes through the ONE door, or a heading can disagree with
    // the text under it. `say` and `fail` ARE that door, so their own two bodies are cut out first —
    // counting them would make the check fail on its own fix.
    const doorStart = src.indexOf("const say = useCallback");
    const doorEnd = src.indexOf("}, []);", src.indexOf("const fail = useCallback"));
    const outside = doorStart > -1 && doorEnd > -1
      ? src.slice(0, doorStart) + src.slice(doorEnd)
      : src;
    const raw = (outside.match(/setErr\((?!null\))/g) || []).length;
    if (raw === 0) ok("14 — messages go through one door, so the heading can never disagree with the text");
    else bad(`14 — ${raw} place(s) set a message directly, bypassing the reason — use say() or fail()`);
  }
}

// ── 10 · THE TWO HANDOFFS, CLOSED 2026-08-19 ─────────────────────────────────────────────────
// H3 · a profile that IS a route must not also register a phone-Back layer, or the first press does
//      nothing. H4 · the reads that do not depend on each other must START together.
{
  const host = read("components/owner/ownerProfileHost.ts");
  const modal = read("components/admin/useAdminModal.ts");
  const prof = read("components/admin/StaffProfile.tsx");
  const page = read(PERSON);
  const route = read("app/api/owner/staff/route.ts");

  if (host && /pageHosted:\s*true/.test(code(host)))
    ok("H3 — the owner's profile host declares itself page-hosted");
  else bad("H3 — the owner's host no longer says `pageHosted: true`, so the route registers a back "
    + "layer again and the phone's FIRST Back press goes dead");
  if (modal && /backLayer\?:\s*boolean/.test(code(modal)) && /opts\?\.backLayer !== false/.test(code(modal)))
    ok("H3 — useAdminModal still offers the opt-out, and still defaults to ON for every real modal");
  else bad("H3 — useAdminModal's backLayer opt-out is gone (or its default flipped, which would strip "
    + "phone-Back from all 13 admin modals)");
  if (prof && /backLayer:\s*!hostRef\.pageHosted/.test(code(prof)))
    ok("H3 — StaffProfile passes the host's answer through to the modal hook");
  else bad("H3 — StaffProfile no longer passes `backLayer` through, so the host's answer is ignored");
  if (page && /router\.replace\(/.test(code(page)) && !/router\.push\(/.test(code(page)))
    ok("H3 — closing the profile REPLACES the detour instead of stacking another entry");
  else bad("H3 — the profile close is back to `router.push`, so ✕ then Back re-opens what was closed");

  if (route) {
    const rc = code(route);
    const started = /const treeQ = accessStateFor\(/.test(rc) && /const logsOnQ =/.test(rc) && /const visQ = loadLogVisibility\(/.test(rc);
    const awaited = /await treeQ/.test(rc) && /await logsOnQ/.test(rc) && /await visQ/.test(rc);
    if (started && awaited) ok("H4 — the profile's restaurant-wide reads are started together and awaited later");
    else bad(`H4 — the profile's reads are sequential again (started=${started} awaited=${awaited}); `
      + "each one is a round trip to Mumbai and the screen sits on \"Opening…\" for every one of them");
    // the gates must STILL come first — firing these for a kitchen login is reads for a thrown-away answer
    const gateAt = rc.indexOf("if (!hasProfile(u.role))");
    const startAt = rc.indexOf("const treeQ = accessStateFor(");
    if (gateAt > -1 && startAt > -1 && gateAt < startAt)
      ok("H4 — they start AFTER the kitchen/module gates, so a kitchen login still costs nothing extra");
    else bad("H4 — the parallel reads now start before the early returns, so a kitchen login pays for "
      + "an answer the route throws away");
    // floating promises must not be able to take the process down
    if (/accessStateFor\(u\.restaurant_id\)\.catch\(/.test(rc) && /loadLogVisibility\([^)]*\)\s*\n?\s*\.catch\(/.test(rc.replace(/\r/g,"")))
      ok("H4 — every started-early promise carries a catch, so one cannot fell the whole request");
    else bad("H4 — a started-early promise has no catch; if it ever rejects while un-awaited it takes "
      + "the process with it, not just this request");
  }
}

// ── 11 · THE FOUR HE ASKED FOR ON 2026-08-19 ("fix all") ─────────────────────────────────────
{
  const src = read(ROSTER);
  if (src) {
    const bare = code(src), txt = plain(code(src));
    // (a) the dead Powers-tab CSS must stay dead — and the note explaining that must stay too, or the
    //     next reader has no idea why a styled screen has no styles for those names.
    const deadRules = (bare.match(/\.(ost-perms|ost-perm|reach-chip|reach-legend)[\s.:,{]/g) || []).length;
    if (deadRules === 0) ok("the Powers-tab CSS is still gone (12 rules matching no element)");
    else bad(`${deadRules} Powers-tab CSS rule(s) are back — they styled controls removed in the access `
      + "rebuild and match nothing on this page; the switches live on /aevinite → Access and permissions");
    if (/THE POWERS-TAB CSS WAS DELETED HERE/.test(src)) ok("…and the note saying why is still there");
    else bad("the note explaining the deleted Powers-tab CSS is gone — without it the next sweep re-finds it");
    // (b) the kitchen row explains itself, quietly, and NEVER offers a profile (R7)
    const hasLine = /ost-nokitchen/.test(bare) && /kitchen screen only/.test(txt);
    if (hasLine) ok("a kitchen row explains why it is shorter");
    else bad("the kitchen row's explanation is gone — every sweep then re-asks why that row looks empty");
    if (/!s\.profileEligible && s\.role === "kitchen"/.test(bare))
      ok("…shown ONLY for a kitchen login that genuinely has no profile");
    else bad("the kitchen line's condition changed — it must never appear on a person who HAS a profile");
    // R7: it must stay a plain statement. A link, a button or a "soon" is the thing he refused 3×.
    // JUST THE ELEMENT, not 400 characters of whatever follows it — a wider window ran straight into
    // the completeness link below and reported the profile <a> as if the kitchen line had become one.
    const nkStart = bare.indexOf('<span className="ost-nokitchen"');
    const block = nkStart > -1 ? bare.slice(nkStart, bare.indexOf("</span>", nkStart) + 7) : "";
    if (!/<a |<button|onClick|href=/.test(block)) ok("…and it is plain text: no link, no button, no promise (R7)");
    else bad("the kitchen line has become a link or a button — R7 forbids offering the kitchen a profile "
      + "in any form; he has refused it three times");
    if (!/coming soon|not yet|later/i.test(block)) ok("…and it promises nothing for later");
    else bad("the kitchen line hints at a future profile — that is R7 wearing a different hat");
    // (c) 36px tap targets on a phone, matching the table tiles rather than a made-up number
    const phone = bare.slice(bare.indexOf("@media (max-width: 560px)"));
    if (/\.ost-actions \.ost-mini, \.ost-actions select \{ min-height: 36px; \}/.test(phone))
      ok("the roster's action controls are ≥36px on a phone");
    else bad("the phone tap-target floor is gone — they measured 26–28px before, shorter than every "
      + "other target in this file, and one of them is Remove");
    if (/\.ost-editrow[^{]*\{ min-height: 36px; \}/.test(phone)) ok("…and so are the rename editor's own controls");
    else bad("the rename editor's controls lost their phone tap-target floor");
    const tile = (bare.match(/\.ost-tgrid button \{[^}]*min-height:\s*(\d+)px/) || [])[1];
    if (tile === "36") ok("…and 36 still matches the table tiles, so the number is not invented");
    else bad(`the table tiles are now ${tile}px while the actions target 36px — pick one floor, not two`);
  }
}

// ── 12 · TAKING SOMEONE OFF THE PAY LIST ASKS FIRST ──────────────────────────────────────────
// Found 2026-08-19 while turning ledger row P06359 from a skip into a real check. The profile sheet's
// pay-list control was a bare toggle: one tap, no question — and that tap changes the month's staff
// cost in the owner's reports AND nulls payroll_added_at / payroll_added_by, so the record of when
// the person was enrolled and by whom is destroyed. Toggling back stamps today instead. Everything
// else about it is recoverable; that stamp is not.
//
// The careful sentence already existed, in the OWNER ROSTER's own setPayroll — unreachable there,
// because the roster only ever offers ADD. So the screen that does the removal was the one not asking.
{
  const prof = read("components/admin/StaffProfile.tsx");
  const route = read("app/api/owner/staff/route.ts");
  if (!prof) bad("components/admin/StaffProfile.tsx not found (if it moved, update this guard)");
  else {
    const bare = code(prof);
    const fn = bare.slice(bare.indexOf("async function setPayroll"));
    const body = fn.slice(0, fn.indexOf("async function", 1) > -1 ? fn.indexOf("async function", 1) : 1200);
    if (/if \(!on && !confirm\(/.test(body)) ok("taking someone off the pay list asks first");
    else bad("the pay-list toggle removes someone with NO question — one tap changes the reports and "
      + "destroys the note of who enrolled them");
    if (/past payments stay/.test(body)) ok("…and the question says the past payments stay on the record");
    else bad("…the question does not reassure that nothing is erased, which is the first thing he would ask");
    if (/when they were added/.test(body)) ok("…and warns that the enrolment note is cleared");
    else bad("…the question does not mention the one thing that is NOT recoverable");
    // it must ask on the way OFF only — a confirm to ADD someone would be noise
    if (!/if \(on && !confirm/.test(body)) ok("…and it does not ask on the way ON, where nothing is lost");
    else bad("adding someone to the pay list now asks a question too — that is noise, not a guard");
  }
  // and the server still clears the stamp, which is WHY the question has to mention it
  if (route && /payroll_added_at: on \? new Date\(\)\.toISOString\(\) : null/.test(code(route)))
    ok("the server still nulls the enrolment stamp on removal, so the warning stays true");
  else bad("the server no longer nulls payroll_added_at — re-word the confirm, it is now telling him "
    + "something that does not happen");
}

// ── 13 · KITCHEN PRINTING ON /owner/settings — the card sweep #6 never saw ───────────────────
// This card did not exist when the 500 phases were written (mig 336/338/341, +134 lines on this
// page since). Everything below was found by reading it and driving it on 2026-08-27.
{
  const src = read(SETTINGS);
  if (!src) bad("app/owner/settings/page.tsx not found (if it moved, update this guard)");
  else {
    const bare = code(src);

    // ── it must not ask when there is no card, and must stop in a background tab ──
    // MEASURED before the fix: 4 requests to /api/owner/printing in 40s with the tab in front, and
    // 2 MORE in the next 35s after it was hidden — from an unconditional `setInterval`. The card
    // only renders when `data.printing` has a row, and each request is five reads on the server, so
    // an owner who left this tab open paid ~1,200 reads an hour for a card that may not be there.
    // Every other page in this console (Customers, Pay Later, Feedback & complaints) does this
    // right; Settings was the one that did not.
    const poll = bare.slice(bare.indexOf("const showsPrinting"), bare.indexOf("const showsPrinting") + 900);
    if (/const showsPrinting/.test(bare) && /if \(!showsPrinting\) return;/.test(poll))
      ok("printing: nothing on screen → nothing is asked for");
    else bad("the printing poll runs whether or not the card is rendered — a restaurant with printing "
      + "switched off pays for a card R36 says it must never see");
    if (/if \(!document\.hidden\)/.test(poll)) ok("printing: a hidden tab does not tick");
    else bad("the printing poll keeps asking while the tab is hidden — the one page in this console that does");
    if (/addEventListener\("visibilitychange"/.test(poll) && /removeEventListener\("visibilitychange"/.test(poll))
      ok("printing: it stops and restarts on visibilitychange, and unhooks itself");
    else bad("the printing poll does not stop/restart on visibilitychange (or leaks its listener)");

    // ── one answer must not be put against every restaurant's row ──
    // /api/owner/printing answers for ONE restaurant and does not say which, so an owner with
    // printing on at two restaurants would have read the first one's computer and printer on the
    // second one's row.
    // T13 (sweep #7) and T20 found this same fault in the same week. T13's fix could only use the
    // answer when the list held one row; T20's made the ROUTE say which restaurant it answered for,
    // which is right for two restaurants as well as one, so that is the version on main and the one
    // asserted here. The claim is unchanged: one restaurant's printer never appears on another's row.
    if (/printing\.restaurantId === p\.restaurant_id/.test(bare))
      ok("printing: the answer is matched to the restaurant it is actually about");
    else bad("the /api/owner/printing answer is applied to every restaurant row — it answers for ONE "
      + "restaurant, so a second restaurant would be told the wrong printer");
    if (/restaurantId\?:/.test(read(SETTINGS) || "") )
      ok("…and the route's answer carries that restaurant id for the page to match on");
    else bad("the printing answer no longer carries the restaurant it is about — the match above cannot work");

    // ── the icon must not touch its label ──
    // `.owx .adm-btn` is `display: inline-flex` with no gap, and a flex container trims the leading
    // space of a text run: `<i/> Open the…` measured 0px between the glyph and the O.
    // The gap moved from this one button to the shared rule on 2026-09-01, because four more buttons
    // in this console had the same fault. Watch the RULE — a per-button override would let the shared
    // one rot unnoticed, which is the whole reason the other four were broken in the first place.
    const gcss = read("app/globals.css") || "";
    // Anchored to a line start: ".adx .adm-btn {" is a SUBSTRING of ".adm.adx .adm-btn {", which
    // sits earlier in the file and is a transition rule with no gap — matching it reported the fault
    // as unfixed while the real rule was right (caught 2026-09-01).
    const consoleBtn = (sel) => {
      const i = gcss.indexOf("\n" + sel); if (i === -1) return "";
      return gcss.slice(i, gcss.indexOf("}", i) + 1);
    };
    if (/gap:\s*\d/.test(consoleBtn(".owx .adm-btn {")))
      ok("printing: the guide button's icon is spaced off its label (the owner console's shared button rule)");
    else bad("the owner console's buttons have no gap — a flex container trims the space in the markup, "
      + "so every icon+label button touches its own first letter (5 of them did, 2026-08-27)");
    if (/gap:\s*\d/.test(consoleBtn(".adx .adm-btn {")))
      ok("…and the Aevidine console's shared button rule too, so the two do not drift apart");
    else bad("the Aevidine console's buttons have no gap — same fault, other console");

    // ── R36 still holds for this whole card ──
    if (!/switched off for|not enabled|isn.t enabled/i.test(bare.slice(bare.indexOf("Kitchen printing"), bare.indexOf("Kitchen printing") + 4000))
        || /Automatic printing is switched off at the moment/.test(bare))
      ok("printing: the card says nothing about a restaurant that does not have it (R36)");
    else bad("the printing card has grown wording about printing being unavailable — R36: the owner "
      + "never sees what is withheld");
  }
}

// ── 14 · A HEADING WITH NOBODY UNDER IT SAYS SOMETHING ───────────────────────────────────────
// Search for a DISABLED person and every match lands in the group below, so the card read
// "Team", blank, "Disabled · 1 — cannot sign in". The person was found; the first thing the
// owner's eye met was an empty heading under their own search.
{
  const src = read(ROSTER);
  if (src) {
    const bare = code(src);
    if (/team\.length > 0 && working\.length === 0/.test(bare))
      ok("a search that matched only disabled people says so, instead of leaving the Team heading empty");
    else bad("the Team heading can render with no rows and no sentence under it — a found person reads "
      + "as 'not found' until the owner scrolls past the empty heading");
  }
}

// ── 15 · ONE RESTAURANT = NO SWITCHER BAR (owner, 2026-09-01, STANDING) ─────────────────────
// *"If the owner has only one restaurant, then there shouldn't be any kind of bar only like to
// switch the restaurant. If they have two then only it should have."* A picker offering exactly one
// choice is a control that does nothing, and it costs a row of height on every screen.
{
  const src = read("components/owner/OwnerMenuEditor.tsx");
  if (!src) bad("components/owner/OwnerMenuEditor.tsx not found (if it moved, update this guard)");
  else {
    const bare = code(src);
    if (/restaurants\.length > 1/.test(bare)) ok("Menu: the restaurant bar needs MORE than one restaurant to exist");
    else bad("the Menu page's restaurant bar is no longer gated on holding more than one restaurant "
      + "— a single-restaurant owner would be shown a switcher with one option in it");
    if (/\{many && \(/.test(bare)) ok("…and the whole bar is what is gated, not just the dropdown inside it");
    else bad("the gate no longer wraps the whole bar — the row, its label and its border would still render");
    if (!/restaurants\.length >= 1|restaurants\.length > 0/.test(bare)) ok("…and nothing weakens that to 'one or more'");
    else bad("the gate has been weakened to one-or-more, which shows the bar to every owner");
    // …and the page can only ever hand it one restaurant on the admin act-as branch
    const page = code(read("app/owner/menu/page.tsx") || "");
    if (/restaurants = \[\{ id: row\.id, name: row\.name \}\]/.test(page))
      ok("…and the admin act-as branch resolves exactly one restaurant, so the bar is absent there too");
    else bad("the admin act-as branch no longer resolves a single restaurant — re-check whether the bar appears");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("\n❌ FAIL — the owner's cockpit is telling him something that did not happen.");
else console.log("\n✅ PASS — Menu, Team and Settings each say what actually happened");
process.exit(fail ? 1 : 0);
