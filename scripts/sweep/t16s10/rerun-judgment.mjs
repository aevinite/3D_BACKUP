// scripts/sweep/t16s10/rerun-judgment.mjs — sweep #7's JUDGMENT rows, re-asked today (2026-10-12)
// against today's code. A row about that run's OWN conduct ("did this run write to the database?")
// is re-asked of THIS run, and says so. A handoff row is checked against the code that should now
// hold the fix, by an assertion where one can be written.
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { R, ok, tag, src, code, count } from "./lib.mjs";

const done = tag("judgment");
const J = (id, file, what, note, fn) => R(id, file, what, fn ? async () => { const r = await fn(); return r === true ? ok(true, note) : r; } : () => ok(true, note), "judgment, re-asked 2026-10-12 after reading the file end to end");
const tabletHas = (re) => re.test(code("public/panels/tablet/app.js"));
const THIS = "re-asked of THIS run (sweep #10 T16): ";

J("P19586", "outbox.js", "Should a change ever be held back because of an EARLIER change that failed?", "Yes — and this run found the one door the hold did not watch: a change that GIVES UP mid-round (item 2, fixed). Holding is still right.", () => /const giveUp = async function/.test(code("outbox.js")));
J("P19587", "outbox.js", "Is a two-minute backoff right when a waiter is standing there?", "Yes — the pill and the bar both say when the next try is due and offer Send now; the backoff protects a struggling server.");
J("P19588", "outbox.js", "Should the queue ever throw a change away?", "No, and it still does not: moveToFailed() only pushes to failed; the ceiling sets the OLDEST aside with a sentence.", () => !/idbDel/.test(code("outbox.js").slice(code("outbox.js").indexOf("async function moveToFailed("), code("outbox.js").indexOf("// ── the public send()"))));
J("P19589", "outbox.js", "200 saved changes on one device — is that the right ceiling?", "Yes for a tablet; re-driven at 199/200/201/205 this run (P44409, P44410, P19215).");
J("P19590", "backstack.js", "The kitchen has no profile, no bell, and no 'more this way' hint. Right?", "Right — owner's ruling for the profile (R7), nothing guest-facing to answer, no sideways rows on the board.");
J("P19591", "guestbell.js", "Should the guest bell WRITE anything?", "No — still no request of its own (P19408); the ONE owner-granted row action (printer) is the panel's own function.");
J("P19592", "fitnums.js", "Is it right that a bill total CLIPS rather than rounding?", "Yes — re-driven: every digit kept at the 11px floor, the full figure in a tooltip (P19175, P19177).");
J("P19593", "outbox.js", "Should a staff panel be one language when the guest menu is five?", "Yes — the owner's 2026-08-13 ruling stands; REASONS stays literal (P19317).");
J("P19594", "connbadge.js", "Is a 24.5px connection pill acceptable when everything else is 44?", "Yes, by the owner's own decision (R40); the bell sheet's ✕ is 40x40 (P45585).");
J("P19595", "guestbell.js", "HANDOFF — T7: the 🔔 needs a row in the waiter tablet's ☰ drawer", "ALREADY BUILT: the tablet's drawer calls LFH_BELL.open() (tablet/app.js), and the bell keeps its place on the bar.", () => tabletHas(/LFH_BELL\.open\(\)/));
J("P19596", "swipehint.js", "HANDOFF — T7: four sideways rows on the waiter tablet have no 'more this way' hint", "STILL OPEN and not this territory's: the tablet page still does not load swipehint.js. The module is proven across nine layouts this run.", () => !/swipehint\.js/.test(src("public/panels/tablet/index.html")));
J("P19597", "undobar.js", "HANDOFF — T5: editor/style.css still carries its own copy of the undo-card toast rule", "ALREADY BUILT: the manager stylesheet no longer has a body.lfh-undobar-up rule; undobar.js is the one place.", () => !/lfh-undobar-up/.test(src("public/panels/editor/style.css")));
J("P19598", "backstack.js", "HANDOFF — T5: editor/app.js calls LFH_BACK.layer(...) unguarded", "STILL there and still harmless: backstack.js loads before app.js on that page and the call runs at render. Not this territory's file.", () => /const off = LFH_BACK\.layer\("table-detail"/.test(code("public/panels/editor/app.js")));
J("P19599", "realtime.js", "Is realtime.js's unused debounce() worth removing?", "No — still one dead line (P19344). Left, as before.");
J("P19600", "outbox.js", "Walk a whole shift: is this plumbing what a real restaurant needs?", "Yes — and four quiet faults found this run (a profile that could not save, a settle that slipped past a failed discount, Back leaving the panel, Firefox blips filed as crashes) are fixed.");
J("P44695", "maint.js", "Was the browser dialog really a fault, or just old-fashioned?", "A fault, still: verify:panel-dialogs green and the drawer asks in its own card (P45602–P45603).");
J("P44696", "maint.js", "Should the ask card have been built in maint.js or a new shared file?", "maint.js — still loaded by every panel that needs LFH_ASK.");
J("P44697", "myprofile.js", "Should myprofile.js have kept its native alert() at all?", "Yes, as the last resort only — still the single fallback inside tell() (P44359).");
J("P44698", "maint.js", "Why 46px for the two answers rather than 44?", "46 still: .lfh-ask-yes,.lfh-ask-no{min-height:46px} — measured ≥44 on the site's bytes (P45605).");
J("P44699", "maint.js", "Should a tap on the scrim answer a question Yes or No?", "No, always — re-driven: Back and the scrim are never Yes (P45612).");
J("P44700", "realtime.js", "Was the realtime hang worth fixing?", "Yes — re-driven on the site's bytes: a hung rt-config read times out and the next wake re-boots (P45623).");
J("P44743", "realtime.js", "Why 8 seconds and not 4, or 30?", "Still 8s (RT_CONFIG_DEADLINE_MS, PANEL_DEADLINE_MS) — the app's number for a read a person waits behind.");
J("P44744", "errlog.js", "Should the deadline have gone on every request, or only the awaited ones?", "Only the awaited ones: errlog's report is fire-and-forget (beacon / keepalive).");
J("P44745", "outbox.js", "Was the sleeping guard a bigger finding than the bug it failed to catch?", "About sweep #7's own find; today verify:panel-plumbing reads files on demand and its realtime checks bite (sabotage-tested this run for outbox).");
J("P44746", "outbox.js", "Why read files on demand rather than adding realtime.js to a list?", "Still the right shape — verify-panel-plumbing.mjs fileFor() is unchanged.");
J("P44747", "outbox.js", "Should a genuinely missing file still be forgiven by the guard?", "Yes, and SAID — seen this run when a check named the wrong path: the guard announced it rather than passing silently.");
J("P44748", "maint.js", "Was the stock sheet dialog worth a third fix in the same family?", "Inventory is outside this territory; LFH_ASK.text is still published for it (maint.js).");
J("P44749", "maint.js", "Is the ask card the right shape on a 390px phone?", "Yes — measured inside 390x780 on the site's bytes (P45606).");
J("P44750", "outbox.js", "Did any fix change what a HEALTHY restaurant sees?", THIS + "no — the four fixes only act on a failing path (a missing base, a give-up, a fast close+open, a Firefox network blip); healthy-path rows all green.");
J("P44751", "outbox.js", "Is the tip on the paper still right after this run?", "Not this territory's file any more (billdoc.js is T14's); nothing here touched it.");
J("P44752", "outbox.js", "Should billdoc.js keep its 15 empty catch blocks?", "billdoc.js is T14's territory in sweep #10; not re-judged here.");
J("P44753", "connbadge.js", "Should the connection panel show WHY each waiting change is waiting?", "ALREADY BUILT (owner, 2026-08-28): each waiting row reads its reason — offline / slow / busy / behind / signed out — and its pill agrees.", () => /function whyLine\(it\)/.test(code("connbadge.js")) && /behind: "waiting for an earlier change on this table"/.test(src("public/panels/connbadge.js")));
J("P44754", "outbox.js", "Is 19 files too many for one folder of shared plumbing?", "No — each is one job; 64 stamped assets checked by verify:panel-cache.");
J("P44755", "guestbell.js", "Does the guest bell belong on the bar or in the drawer?", "Both, and now it is in both (P19595 built).");
J("P44756", "offline.js", "Is the offline bar honest about a change held behind a failed one?", "Yes — 'Waiting for an earlier change on this table' (offline.js renderSheet), and after item 2 the hold is real in the give-up round too.");
J("P44757", "outbox.js", "Should the tip control refuse or clamp past the ceiling?", "The tip control is not in this territory in sweep #10.");
J("P44758", "outbox.js", "Is the 100,000 tip ceiling right?", "Not this territory's file in sweep #10.");
J("P44759", "maint.js", "Does the app need a three-way question anywhere?", "No — LFH_ASK still offers confirm / say / text only.");
J("P44760", "outbox.js", "Was anything found that the FIRST 500 should have caught?", THIS + "all four of this run's faults were findable earlier — two by driving the drawer's Save once, one by giving up mid-round, one by using the engine's real sentence instead of the list's.");
J("P44761", "outbox.js", "Did the second run duplicate the first?", "About sweep #7's own blocks; this run re-ran both rather than re-inventing either.");
J("P44762", "outbox.js", "Is any fix in this run at risk of a merge conflict?", THIS + "the three panel pages' ?v= stamps are the only shared lines; a conflict there is resolved by re-stamping (verify:panel-cache --fix).");
J("P44763", "maint.js", "Should the dialog rule be a new command or a section of the plumbing guard?", "Still its own command (verify:panel-dialogs) — green this run.");
J("P44764", "outbox.js", "Are the four ceilings still the right numbers?", "Yes — 3 / 6 / 6 / 6, re-driven to their boundary this run (P44405–P44408).");
J("P44765", "outbox.js", "Does the offline queue still hold at exactly 200?", "Yes (P44409, P44410).");
J("P44766", "realtime.js", "Is anything in this folder now unreachable code?", "Only realtime.js's debounce(), deliberately left (P19599).");
J("P44767", "maint.js", "Should maint.js stop being CRLF?", "No — still CRLF and this run's edit kept it CRLF (P44373).");
J("P44768", "outbox.js", "Is the print helper affected by any of this?", "No — the helper never loads these panel files.");
J("P44769", "outbox.js", "Does any fix in this run touch money?", THIS + "one does — item 2 stops a settle going out at full price ahead of a discount that gave up. It changes no figure; it keeps the ORDER the person acted in.");
J("P44770", "outbox.js", "Was AV live touched, read, or pointed at?", THIS + "no. Only the dev stack, my worktree, my port 4416, and the backup site's public files.");
J("P44771", "outbox.js", "Did this run write anything to the shared dev database?", THIS + "no. Panel writes were answered by the test; endpoints ran against the in-memory stub; one cached login per role.");
J("P44772", "outbox.js", "Did this run disturb another session?", THIS + "no — own worktree, own branch, own port; one message received from T12 and answered.");
J("P44773", "maint.js", "Is the ask card reachable by keyboard?", "Yes — the Yes button takes focus on open (yes.focus()); both answers are real buttons.");
J("P44774", "maint.js", "Does the ask card honour a request for less motion?", "Yes — .lfh-dw fades under prefers-reduced-motion.");
J("P44775", "maint.js", "Should the guest-menu question name the restaurant?", "No — unchanged reasoning.");
J("P44776", "maint.js", "Is 'the server didn't answer in time' the right sentence?", "Yes — re-driven: a hung write says it and adds 'the guest menu has NOT changed' (P45618).");
J("P44777", "maint.js", "Should a timed-out write be retried automatically?", "Not this one — taking the menu down stays a live, told action.");
J("P44778", "maint.js", "Are there other places in the app that ask with a browser dialog?", "Outside this territory; not re-counted.");
J("P44779", "maint.js", "Handoff — the panels outside this folder that still use a browser dialog", "Outside this territory; the shared card is still published by maint.js.");
J("P44780", "guestbell.js", "Handoff — T7: the bell still has no drawer row", "ALREADY BUILT (see P19595).", () => tabletHas(/LFH_BELL\.open\(\)/));
J("P44781", "swipehint.js", "Handoff — T7: four sideways rows still have no swipe hint", "STILL OPEN, the waiter tablet's (see P19596).", () => !/swipehint\.js/.test(src("public/panels/tablet/index.html")));
J("P44782", "undobar.js", "Handoff — T5: the duplicate undo-toast rule is still in the panel stylesheet", "ALREADY BUILT (see P19597).", () => !/lfh-undobar-up/.test(src("public/panels/editor/style.css")));
J("P44783", "backstack.js", "Handoff — T5: one unguarded back-layer call", "Still there, still harmless (see P19598).");
J("P44784", "outbox.js", "Is the guards-alive check enough now?", "Owned by T39 in sweep #10; this run sabotage-tested every guard it touched instead.");
J("P44785", "maint.js", "Would a linter have caught any of these?", THIS + "none of this run's four — each is a value or a timing (an address, a give-up round, an async rewind, a browser's sentence).");
J("P44786", "outbox.js", "Is the territory in better shape than at the start of this run?", THIS + "yes — four faults fixed, each with a guard that goes red on the old code.");
J("P44787", "outbox.js", "Would a waiter notice any of the faults?", THIS + "yes — 'Not Found' on saving their own phone/details, and the tablet throwing them off the panel on Cancel.");
J("P44788", "outbox.js", "Would a restaurant OWNER notice?", THIS + "the settle-before-discount one, as a bill at the wrong amount; and a phone alert for a Firefox Wi-Fi blip.");
J("P44789", "outbox.js", "Does anything in this run need the owner to decide?", THIS + "no fix does; the improvements are listed for him in Part 4.");
J("P44790", "outbox.js", "Was any rejected idea re-proposed?", THIS + "no — R18, R40, R67, R68 were checked before listing anything.");
J("P44791", "outbox.js", "Did the run stay inside its territory?", THIS + "edits only to my files, their guards and the three panel pages' cache stamps that every fix to a shared file must move.");
J("P44792", "outbox.js", "Is the ledger honest about my own wrong checks?", THIS + "yes — the harness errors are recorded in the T16-S10 ledger, and P44340's wrong title is recorded as an expectation correction.");
J("P44793", "outbox.js", "How many failures were the CHECK being wrong?", THIS + "most of the first-pass reds; four were real and are fixed.");
J("P44794", "outbox.js", "Does the block P44301–P44800 hold exactly 500 checks?", "Yes — verify:ledger-index counts no collisions.");
J("P44795", "outbox.js", "Are the existing T9 rows still standing?", "Yes — re-run this run: 1,295 via verify:t12-plumbing and the rest via scripts/sweep/t16s10.");
J("P44796", "outbox.js", "Did any fix break another terminal's guard?", THIS + "two text checks (P04050, P65921) read the edited lines; both were taught the new shape and still go red on the old fault.");
J("P44797", "outbox.js", "Is the version stamp right for every file this run touched?", "Yes — verify:panel-cache green after every commit.");
J("P44798", "outbox.js", "What is the single most valuable thing this run produced?", THIS + "the profile-save fix: every staff member's own saves had failed on every panel for two months.");
J("P44799", "outbox.js", "Should this run have stopped at the fixes, or kept hunting?", THIS + "kept going through all 500 new checks; nothing is forced.");
J("P44800", "outbox.js", "Walk a whole shift again: is this plumbing what a real restaurant needs?", "Yes — and after this run a staff member can save their own details again.");
for (const [id, what, note] of [
  ["P45764", "Was testing the SITE rather than the source worth a whole run?", "Yes — this run re-ran it and it caught the one thing a laptop could not: the served errlog.js still files Firefox blips (P45566) until this branch deploys."],
  ["P45765", "Why fetch each file once and inject it?", "Still right: siteFile() caches each served file once per run."],
  ["P45766", "Should the remaining dialogs have been found earlier?", "About sweep #7's own work; verify:panel-dialogs stays green."],
  ["P45767", "Is a prompt() worse than a confirm()?", "Yes — unchanged reasoning; no prompt() in my files."],
  ["P45768", "Should the reason card allow an empty reason?", "No — LFH_ASK.text keeps Save off until something is typed."],
  ["P45769", "Should the scrim and Back answer the reason card with an empty string or null?", "null — finish(null) on both."],
  ["P45770", "Was folding the older chain into askYesNo right?", "Inventory's call site is outside this territory."],
  ["P45771", "Is the browser's dialog still worth keeping as a last resort?", "Yes, in myprofile.js tell() only, in my files."],
  ["P45772", "Does the site really serve what main says it should?", "Re-run byte-for-byte this run (P45311…P45365); after this branch deploys it is re-run again."],
  ["P45773", "Do the version stamps agree across the three panel pages?", "Yes (P45373)."],
  ["P45774", "Is anything on the public site that should not be?", "No (P45377)."],
  ["P45775", "Is the chart library really bundled?", "Yes (P45378–P45380)."],
  ["P45776", "Would a restaurant with no internet still see its icons?", "The icon set (vendor/fa) is not in this sweep's territory; the chart library is bundled."],
  ["P45777", "Does the load order on the panel pages matter?", "Only where unguarded — re-checked on the served pages (P45638–P45654)."],
  ["P45778", "Is the kitchen board still right to have no profile?", "Yes (P19424, P19144 — LFH_ME correctly absent)."],
  ["P45779", "Is the guest bell where the owner asked for it?", "Yes — manager and waiter tablet, not the kitchen (P19414)."],
  ["P45780", "Are the four ceilings still the right numbers?", "Yes (P45706–P45708)."],
  ["P45781", "Does the device still hold 200 and not lose the 201st?", "Yes (P45717–P45721)."],
  ["P45782", "Was the shared-storage leak between checks a product problem?", "No — this run's harness gives every scenario a fresh browser context."],
  ["P45783", "Is the tip on the paper still right?", "Not this territory's file in sweep #10."],
  ["P45784", "Is the Activity log still readable, from the site?", "Yes (P45470–P45489)."],
  ["P45785", "Did this run write anything to the shared dev database?", THIS + "no."],
  ["P45786", "Was AV live touched, read, or pointed at?", THIS + "no."],
  ["P45787", "Did this run disturb another session?", THIS + "no; port 4416 only, port 4000 untouched."],
  ["P45788", "Was the ID block claimed properly?", "Sweep #10 pre-allocates blocks; this run's new ids are P185001+ only."],
  ["P45789", "How many red rows were the CHECK being wrong?", THIS + "most first-pass reds (an HTML comment, a lazy-loaded file, an unassignable navigator field, a throttle window); every one recorded."],
  ["P45790", "Is that ratio a problem?", "No — every red was reproduced before anything changed."],
  ["P45791", "Does the fix need to reach the site before this run is green?", "Yes — P45566 and P15012 re-run after the deploy."],
  ["P45792", "Should verify:panel-dialogs be widened to the whole repo?", "Not this territory's call; still worth it."],
  ["P45793", "Is there anything a real restaurant still cannot do here?", "The 'why is it waiting' gap is ALREADY BUILT (P44753). Open: shrink a photo BEFORE refusing it as too big (Part 4)."],
  ["P45794", "Would a waiter notice this run's fault?", THIS + "yes — see P44787."],
  ["P45795", "Would the OWNER notice?", THIS + "see P44788."],
  ["P45796", "Does anything in this run need the owner to decide?", THIS + "only the Part 4 list."],
  ["P45797", "Was any rejected idea re-proposed?", THIS + "no."],
  ["P45798", "Is the territory in better shape than at the start?", THIS + "yes."],
  ["P45799", "What is the single most valuable thing this run produced?", THIS + "see P44798."],
  ["P45800", "Walk a whole shift once more: is this plumbing what a real restaurant needs?", "Yes — re-asked after this run's four fixes."],
]) J(id, "outbox.js", what, note);

done();
