// Guards the SHARED PANEL PLUMBING — the small files every staff panel loads
// (public/panels/*.js): the write queue, the connection pill, the back-button manager, the undo
// card, the guest bell, the settings drawer, the issue modal, the theme, the error log.
//
// WHY THIS EXISTS. Sweep #6 terminal 9 (2026-08-17) found ten faults in these files, and every
// one of them was a promise the plumbing made and then did not keep — a change put back at the
// wrong end of the queue, a panel that said "Sending…" about work nothing was sending, a switch
// that reported the guest menu was offline when the server had refused, a take-back card offered
// four minutes late. None of them showed up in a test, because each file is correct on its own
// and the fault was in what it TOLD the person. These checks are STATIC (fast, no browser, no
// database) and every one maps to a fault that really happened.
//
//   node scripts/verify-panel-plumbing.mjs            # check this checkout
//   node scripts/verify-panel-plumbing.mjs <root>     # check another checkout (a worktree)
//
// Add a check here whenever one of these shared files makes a new promise to a person.
import fs from "node:fs";
import { repoRootFrom } from "./sweep/repoRoot.mjs";
import path from "node:path";

// The repo to scan: the first argument that really IS one, else the repo this file lives in.
// It used to be plain `process.argv[2]`, so `-- --base http://localhost:4228` — which every
// sweep lane passes to every guard — made this scan a folder called "--base" and exit 1.
// (T28, sweep #7, 2026-08-29; the same fault as verify:test-safety's, in eight more guards.)
const ROOT = repoRootFrom(import.meta.url);
const P = (f) => path.join(ROOT, "public/panels", f);

// A missing file means this checkout predates the panels (or is mid-rebase). A guard must never
// break someone's edit, so we say so and stop rather than throw.
function read(f) {
  try { return fs.readFileSync(P(f), "utf8"); } catch { return null; }
}

const fails = [];
const files = {};
for (const f of ["outbox.js", "connbadge.js", "myprofile.js", "maint.js", "undobar.js",
  "issue-raise.js", "guestbell.js", "editor/inventory.js"]) {
  files[f] = read(f);
  if (files[f] == null) { console.log(`· ${f} not in this checkout — skipping its checks`); }
}
const has = (f, re, why) => {
  const s = files[f];
  if (s == null) return;
  if (!re.test(s)) fails.push(`${f}: ${why}`);
};
const hasNot = (f, re, why) => {
  const s = files[f];
  if (s == null) return;
  if (re.test(s)) fails.push(`${f}: ${why}`);
};

// ── outbox.js — a change put back goes where it belongs ───────────────────────────────────────
// A discount that ran out of automatic tries, retried by hand, used to land AFTER a later
// "Mark paid" on the same bill — so the bill settled at the full amount and the discount was
// then applied to a settled bill. Both retry paths must re-order by `at` (when the PERSON acted).
has("outbox.js", /function requeueInOrder\s*\(\s*\)\s*\{[\s\S]{0,200}?\.sort\(/,
  "requeueInOrder() is gone — a retried change would go to the back of the queue again");
{
  // Both hand-retry entry points, checked inside their own function body.
  const s = files["outbox.js"];
  for (const fn of ["async function retryFailed", "async function retryOne"]) {
    if (!s) break;
    const at = s.indexOf(fn);
    if (at < 0) { fails.push(`outbox.js: ${fn.split(" ").pop()}() is gone`); continue; }
    if (!/requeueInOrder\(\)/.test(s.slice(at, at + 700))) {
      fails.push(`outbox.js: ${fn.split(" ").pop()}() no longer calls requeueInOrder() — a retried change goes to the back of the queue`);
    }
  }
}
// …and the four attempt ceilings stay named constants that agree with the guest queue.
for (const k of ["AUTH_MAX_TRIES", "BUSY_MAX_TRIES", "NET_MAX_TRIES", "SERVER_MAX_TRIES", "MAX_QUEUED"]) {
  has("outbox.js", new RegExp(`const ${k}\\s*=`), `${k} is no longer a named ceiling`);
}
// A queued change must always have something that will send it.
has("outbox.js", /ensureRetry\(\);\s*\n\s*return persisted;/,
  "enqueue() no longer leaves a retry timer behind — saved work with nothing to send it");

// ── connbadge.js — it must not say "Sending…" about work nothing is sending ────────────────────
has("connbadge.js", /function syncState\s*\(/,
  "syncState() is gone — the panel is guessing at what is happening to the waiting work again");
has("connbadge.js", /outbox\.syncing/,
  "the connection panel no longer reads the queue's `syncing` flag (cry-wolf: 'Sending…' on a two-minute backoff)");
hasNot("connbadge.js", /el\("span", "lfh-conn-pill", off \? "Waiting" : "Sending…"\)/,
  "the waiting-row pill is back to deciding 'Sending…' from navigator.onLine alone");
// …and a Retry tap must not be swallowed by a repaint.
has("connbadge.js", /popHeld/,
  "the pointer-hold guard is gone — a Retry tap can be swallowed by a repaint mid-press");
has("connbadge.js", /function popSig\s*\(/,
  "popSig() is gone — the connection panel rebuilds itself on every breadcrumb again");
has("connbadge.js", /if \(popHeld \|\| sig === popPrinted\) return;/,
  "renderPop() no longer skips a rebuild that changes nothing / happens under a finger");
has("connbadge.js", /setInterval\(function \(\) \{ if \(!document\.hidden\) render\(\); \}/,
  "the 8-second repaint runs on a hidden tab again");

// ── myprofile.js — a name with an apostrophe reads as typed ────────────────────────────────────
// row() is the ONE escaper. A caller that escapes as well produces "Owner&#39;s assistant".
has("myprofile.js", /'<small>' \+ esc\(sub\)/, "row() no longer escapes `sub`");
has("myprofile.js", /'<span class="me-rr">' \+ esc\(right\)/, "row() no longer escapes `right`");
hasNot("myprofile.js", /row\((?:[^)\n]*?),\s*esc\(/,
  "a call site escapes the title again — row() already does, so the text renders double-escaped");
// A failed read is not an answer.
hasNot("myprofile.js", /catch\s*\{?\s*availability = false;? *\}?/,
  "available() caches a FAILED read as 'no profile', so one blip hides the button for the session");
has("myprofile.js", /addEventListener\("online"/,
  "myprofile no longer re-checks when the connection comes back");
// A save that WORKED must never be reported as a failure. The refresh that follows it has its own
// catch, so a blip on the read cannot make the screen claim the save was refused (T9 sweep #7).
has("myprofile.js", /btn\.textContent = "Saved ✓";[\s\S]{0,900}?try \{\s*\n\s*await load\(\);\s*\n\s*render\(\);\s*\n\s*\} catch/,
  "the re-read after a successful save is back inside the save's own try — one dropped request and the person is told 'Couldn't save' about a save the server accepted");

// ── maint.js — the guest-menu switch must never claim something the server did not do ──────────
has("maint.js", /if \(!r\.ok\) \{[\s\S]{0,160}?throw e;? *\}\r?\n\s*maintOn = turnOn;/,
  "setMaint() moves the switch without checking the server said yes (it can claim the menu is offline while guests are still ordering)");
has("maint.js", /maintOn = null;/,
  "a maintenance state we could not read is being reported as a confident 'online' again");
has("maint.js", /maintOn === null/,
  "the guest-menu button no longer has an 'I couldn't read this' state");
has("maint.js", /addEventListener\("online", function \(\) \{\r?\n?\s*if \(!document\.getElementById\("staffSettingsBtn"\)/,
  "maint.js no longer retries after a panel that opened with no signal");

// ── undobar.js — the take-back window runs on the clock, not on paints ─────────────────────────
has("undobar.js", /var askedAt = Date\.now\(\);/,
  "the undo card no longer measures how much of its window is really left");
has("undobar.js", /if \(leftMs <= 0\)/,
  "an undo card whose window expired while the screen slept is shown late again");
has("undobar.js", /else if \(document\.hidden\) \{\s*\r?\n?\s*reveal\(\);/,
  "the undo card is back to waiting on requestAnimationFrame, which never runs on a sleeping tablet");
// The undo card is the one on top (owner, 2026-08-17) AND the panel's toast still gets read: the
// card keeps its place at the bottom and the toast steps up over it. Shipped from THIS file so all
// four panels get it, instead of the same rule copied into three stylesheets and drifting.
has("undobar.js", /body\.lfh-undobar-up \.toasts,body\.lfh-undobar-up \.toast\{/,
  "the toast step-over rule is gone — on the kitchen and tablet a message is completely hidden behind the undo card");
has("undobar.js", /var\(--lfh-undobar-h, 56px\)/,
  "the step-over no longer uses the card's measured height, so it will overlap again as soon as the card is two lines tall");

// ── issue-raise.js — every write has a ceiling, and a recording is not thrown away ─────────────
has("issue-raise.js", /signal: uploadDeadline\(\)/,
  "the attachment upload has no deadline — 'Uploading photo…' can hang with Send greyed out");
has("issue-raise.js", /typeof AbortSignal\.timeout === "function"/,
  "reading AbortSignal.timeout is no longer guarded (it throws on older tablets)");
has("issue-raise.js", /function guardedClose\s*\(/,
  "the backdrop/Escape can throw away a voice note being recorded again");
has("issue-raise.js", /ov\.onclick = function \(e\) \{ if \(e\.target === ov\) guardedClose\(\); \};/,
  "the backdrop no longer goes through the recording guard");
// …and so does the phone's own Back button, which is the third accidental exit and the likeliest
// one on the device somebody actually records a voice note on (T9 sweep #7, 2026-08-22). Refusing
// it also has to RE-ARM the layer, because backstack has already popped it by then — without that,
// the next Back press leaves the panel entirely.
has("issue-raise.js", /function doClose\(\) \{[\s\S]{0,320}?rec\.state === "recording"[\s\S]{0,240}?armBack\(\);/,
  "hardware Back throws away a voice note being recorded again (it must refuse AND re-arm its layer)");

// ── fitnums.js — a bill's figure is the law, and this file must not feed itself ────────────────
files["fitnums.js"] = read("fitnums.js");
has("fitnums.js", /var EXACT_SEL = /,
  "the exact-money gate is gone — an order total of ₹1,23,45,678 would render as '₹1.2 Cr'");
for (const sel of ["bill-amt", "ks-val", "ordtotal", "ctotal", "ord-total", "data-fit-exact"]) {
  has("fitnums.js", new RegExp("EXACT_SEL[\\s\\S]{0,240}" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${sel} left the exact-money list — a document figure could be rounded on screen`);
}
has("fitnums.js", /&& !isExact\(el\)/, "the abbreviation no longer asks whether this figure must stay exact");
has("fitnums.js", /if \(el\.textContent === el\.dataset\.lfhShort\)/,
  "a shortened figure is pasted back over a value the panel has since changed (a stale total that never corrects itself)");
has("fitnums.js", /function setText\(el, s\) \{ selfNodes\.add\(el\)/,
  "our own text rewrite no longer marks itself, so the observer feeds this file a scan every frame for ever");
has("fitnums.js", /if \(mine\) return;/, "the self-write guard was removed from the observer callback");
// A shortened tile gets a tooltip with the whole figure; the CLIPPED exact one got nothing, so a
// part-figure on the Bills tab could not be read at all. It carries the same title now — marked as
// ours, so a panel's own title is never overwritten and ours is withdrawn when a shorter value fits
// (T9 sweep #7, 2026-08-22).
has("fitnums.js", /isExact\(el\)\) \{[\s\S]{0,320}?dataset\.lfhTitle/,
  "a clipped exact figure has nothing that shows the digits the box cut off");
has("fitnums.js", /if \(over <= 1\) break;/,
  "fit() returns early when a figure fits, so a tooltip added while it was clipped is left quoting the old value");

// ── guestbell.js — cheap enough to call on every paint, and clear of the home indicator ────────
has("guestbell.js", /var seenSet = null;/,
  "the seen list is being re-read from storage once per row again");
has("guestbell.js", /var\(--sab, env\(safe-area-inset-bottom, 0px\)\)/,
  "the bell sheet reads only the injected inset, so its last row hides under a phone's home bar");
// The bell borrows `.theme-toggle` for its SHAPE, and the waiter tablet hides
// `.top-actions .theme-toggle` below 760px — a rule written for the sun/moon before this bell
// existed. So on a phone the bell vanished with it, and it is not in that panel's ☰ drawer either.
// It re-states its own `display` so borrowing the shape can never mean borrowing the hiding
// (T9 sweep #7, 2026-08-22).
has("guestbell.js", /\.top-actions \.lfh-bell[^"]*\{display:inline-flex\}/,
  "the bell no longer re-states its own display — a panel hiding .theme-toggle on a phone hides the bell with it, and there is no drawer row to reach it by");
{
  // …and if a panel ever DOES give it a drawer row, this note is how the next person finds out why
  // the rule above exists. Belt and braces: the tablet must not be hiding it by id either.
  const tabCss = (() => { try { return fs.readFileSync(path.join(ROOT, "public/panels/tablet/style.css"), "utf8"); } catch { return ""; } })();
  if (/#lfhBellBtn[^{]*\{[^}]*display\s*:\s*none/.test(tabCss)) {
    fails.push("public/panels/tablet/style.css hides #lfhBellBtn outright — the owner asked for the bell on this panel specifically");
  }
}

// ── editor/inventory.js — a read gets a ceiling too ────────────────────────────────────────────
has("editor/inventory.js", /\}\r?\n\s*\/\/ A READ GETS A CEILING TOO[\s\S]{0,600}?opts\.signal = invDeadline\(\);\r?\n\s*try \{/,
  "the inventory deadline is back inside the write-only branch — a read can hang on 'Loading inventory…' forever");

// ── the "→ N more" chip counts what is really off the edge (T9 sweep #7, 2026-08-22) ──────────
// offsetLeft is measured from the nearest POSITIONED ancestor, and countChip() makes the row's
// PARENT positioned — so any inset between the two put the count in a different coordinate system
// from scrollLeft + clientWidth. Measured with 40px of parent padding: "→ 7 more" where six were
// off the edge, and "→ 1 more" at the end of the row with nothing left.
{
  files["swipehint.js"] = read("swipehint.js");
  has("swipehint.js", /function hiddenAtEnd\(row\) \{[\s\S]{0,200}?getBoundingClientRect\(\)\.right/,
    "the chip's count is back on offsetLeft, which is measured from a different box than the row's own scroll position");
  hasNot("swipehint.js", /c\.offsetLeft \+ c\.offsetWidth > right/,
    "hiddenAtEnd() compares offsetLeft against a scroll coordinate again — the count drifts by however far the row sits inside its parent");
}

// ── no tap in the Inventory tab ends in silence (T9 sweep #7, 2026-08-22) ─────────────────────
// verify:taps covers the three panels' own app.js but not this file, and Discard swallowed every
// refusal with `catch {}` and cleared the sheet regardless — so a refused discard closed the sheet,
// said nothing, and then came back with every figure still in it on the next read. Every write in
// here must either surface its refusal or be a deliberate best-effort read.
{
  const src = files["editor/inventory.js"];
  if (src) {
    // Each `catch {}` / `catch (e) {}` that sits on a POST is a swallowed refusal.
    const swallowed = [];
    const re = /(await inv\("(?:POST|PATCH|DELETE|PUT)"[^;]{0,200}?;)\s*\}\s*catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
    let m;
    while ((m = re.exec(src))) swallowed.push(m[1].slice(0, 60));
    if (swallowed.length) {
      fails.push(`editor/inventory.js: a write's refusal is thrown away with an empty catch, so the tap ends in silence — ${swallowed.join(" · ")}`);
    }
  }
}

// ── the queue says when a round STARTS, not only when it stops (T9 sweep #7, 2026-08-22) ──────
// `syncing` is the one flag every surface reads to answer "is this actually moving?". The finally
// block publishes when a round ends; nothing published when it began, so with exactly ONE change
// queued — the everyday case — the connection panel read "Waiting to send · next try in 5s", in the
// red not-moving colour, while that change was being sent. Both halves are guarded: the notify at
// the top of the round, and the two snapshot shapes agreeing.
has("outbox.js", /flushing = true;[\s\S]{0,900}?\n\s*notify\(\);/,
  "flush() no longer says a round has started, so the connection panel calls an in-flight change 'waiting'");
has("outbox.js", /getSnapshot: \(\) => \(\{[^}]*syncing: flushing[^}]*unsafeStore: unsafeStore/,
  "getSnapshot() dropped syncing/unsafeStore again — a listener's first snapshot has a different shape from every later one");

// ── leaving the panel moves the WHOLE window, not the frame (T9 sweep #7, 2026-08-22) ─────────
// /manager, /kitchen and /tablet render the panel inside an iframe, so a bare `location.href` from
// panel code loads the sign-in page INSIDE the panel and leaves the page around it signed in. The
// kitchen and tablet fixed their own logout forms with target="_top" on 2026-08-19; these two
// shared files were still doing it. A guard, because it looks almost right on screen.
for (const f of ["maint.js", "outbox.js"]) {
  has(f, /window\.top && window\.top !== window\.self/,
    "goes to /login without moving the whole window — the sign-in page loads inside the panel frame");
  hasNot(f, /(?<!window\.)\blocation\.href = "\/login"/,
    "has a bare location.href = \"/login\" again, which navigates only the panel's iframe");
}

// ── the standing rules these files must keep ──────────────────────────────────────────────────
// Nobody may hand-roll history: backstack.js is the one manager.
for (const f of ["connbadge.js", "guestbell.js", "myprofile.js", "maint.js", "issue-raise.js", "undobar.js", "editor/inventory.js"]) {
  hasNot(f, /history\.pushState|addEventListener\("popstate"/,
    "hand-rolls the back button instead of registering LFH_BACK.layer(...)");
}
// The panels are English. These files must not grow a locale.
for (const f of ["outbox.js", "connbadge.js", "guestbell.js", "undobar.js"]) {
  hasNot(f, /from ["'].*i18n|require\(["'].*i18n/, "pulls in i18n — staff panels are one language, on purpose");
}
// backdrop-filter stays ONE unprefixed line (hand-adding -webkit- makes the build drop it).
for (const f of ["guestbell.js", "maint.js"]) {
  hasNot(f, /-webkit-backdrop-filter/, "has a -webkit- backdrop-filter, which makes the build drop the rule");
}

// ── the ledger's load-bearing invariants (.claude/sweep/LEDGER/T9.md) ─────────────────────────
// These are the rows whose LOSS would cost a person something. Kept here so the next sweep
// re-runs them in a second instead of re-reading five thousand lines and inventing new ones.

// outbox: the contract every panel's api() depends on
has("outbox.js", /"X-LFH-Action-Id": item\.id/, "a write no longer carries its action id — a replay could run twice");
has("outbox.js", /"X-LFH-Queued-At"/, "a write no longer says WHEN the person did it — the clash gate goes blind");
has("outbox.js", /if \(replay\) headers\["X-LFH-Replay"\]/, "a replay is no longer marked as one");
has("outbox.js", /signal: writeDeadline\(\)/, "a write has no deadline — an overloaded database leaves the tap on a spinner");
has("outbox.js", /if \(res\.status >= 500\) \{[\s\S]{0,400}?enqueue\(item, "busy"\)/, "a 5xx on the FIRST attempt throws again instead of being kept (busy must behave like offline)");
has("outbox.js", /if \(res\.status === 401\) \{ await enqueue\(item, "signedout"\)/, "being signed out mid-tap throws the change away again");
has("outbox.js", /if \(j && j\.ok === false\)/, "a 200 whose body says NO is being counted as delivered again");
has("outbox.js", /if \(navigator\.onLine === false\) \{ scheduleRetry\(false\); return; \}/, "a flush during a blip kills the queue's last timer again");
has("outbox.js", /0\.75 \+ Math\.random\(\) \* 0\.5/, "the retry backoff lost its jitter — every device would retry on the same beat");
has("outbox.js", /const UNTABLED/, "per-table ordering is gone; one stuck change would hold up every other table");

// realtime: the connection budget and the no-amplifier rule
has("realtime.js", /if \(sbPromise === p\) sbPromise = null/, "a failed realtime boot is remembered forever again");
has("realtime.js", /import\("\/vendor\/supabase\.js"\)/, "the realtime client is back on a public CDN a restaurant's wifi can block");
has("realtime.js", /topic_rid=eq\./, "the socket is no longer scoped server-side to this restaurant (every tenant's traffic again)");
has("realtime.js", /worker: true/, "the socket heartbeat left the worker — a backgrounded tablet drops live updates");
has("realtime.js", /const IDLE_MS = 120000/, "a hidden tab no longer drops its channels");
has("realtime.js", /step = Math\.min\(step \+ 1, 8\)/, "catchUp() lost its backoff — a struggling database gets a fixed fast poll from every device");
has("realtime.js", /connStatus === "online" \|\| navigator\.onLine === false/, "catchUp() polls even while the live socket is healthy");

// errlog: never hide a real error, and the log reads as English
has("errlog.js", /bare\.toLowerCase\(\) === NETWORK_NOISE\[i\]\.toLowerCase\(\)/, "the noise filter is a substring test again — a real crash containing 'Load failed' would be thrown away");
has("errlog.js", /function visibleText/, "a button's name is read from hidden children again ('Tables3')");
has("errlog.js", /el\.closest\("\.lfh-conn"\)/, "taps on the connection pill flood the activity log again");
has("errlog.js", /setInterval\(flush, 30000\)/, "the tap batch is no longer one write per panel per 30s");

// theme: the panel skin key and its default
has("theme.js", /var KEY = "lfh_panel_theme"/, "the panel skin key changed — it must never be the guest's lfh_theme");
has("theme.js", /apply\(saved\(\) === "dark" \? "dark" : "light"\)/, "the panel default is no longer LIGHT");

// fitnums: the readability floor and the composite-tile rule
has("fitnums.js", /var MIN_PX = 11/, "the readability floor moved off 11px");
has("fitnums.js", /el\.childElementCount === 0 && cs\.whiteSpace !== "nowrap"/, "a composite tile is being forced onto one line again");

// backstack: one manager, one entry per overlay
has("outbox.js", /window\.LFH_OUTBOX = \{/, "the queue no longer publishes itself");
{
  const bs = read("backstack.js");
  if (bs && !/ignore \+= 1;\s*\n?\s*history\.go\(-remove\)/.test(bs)) {
    fails.push("backstack.js: the single-popstate swallow is gone — a back press would close two overlays at once");
  }
}

// undobar / guestbell: the owner's own decisions
// ── THE WINDOW MOVED, SO THIS ASSERTION MOVED WITH IT (2026-08-26) ────────────────────────────
// It pinned 4 seconds, which is what he asked for on 2026-08-17. On 2026-08-26 he asked for two
// things at once — a CEILING ("keep undo button for 5 sec like not more") and, of the one bar that
// survived the cull, a shorter window ("decrese time for it"). So the numbers are 3 and 5, and
// they are asserted separately because they mean different things: the default is a preference and
// may move again; the ceiling is a rule and a caller must not be able to exceed it.
// (This guard went red the moment the default changed — which is the guard working. What would be
// wrong is "fixing" the code back to satisfy a rule the owner has retired.)
has("undobar.js", /var DEFAULT_SECONDS = 3;/, "the take-back window is no longer the 3 seconds the owner asked for on 2026-08-26");
has("undobar.js", /var MAX_SECONDS = 5;/, "the 5-second ceiling is gone — a caller could ask for a longer window again");
has("undobar.js", /Math\.min\(opts\.seconds != null \? opts\.seconds : DEFAULT_SECONDS, MAX_SECONDS\)/,
  "the ceiling is no longer APPLIED — declaring it is not enforcing it");
has("undobar.js", /lfh-undo-x/, "the ✕ that closes the undo card early is gone (owner, 2026-08-26)");
has("undobar.js", /function attachSwipe\(\)/, "you can no longer flick the undo card away (owner, 2026-08-26)");
has("guestbell.js", /if \(!menuOn\) \{ unmount\(\); return; \}/, "the bell survives the guest menu being switched off (he stressed this half)");
hasNot("guestbell.js", /fetch\(/, "the guest bell has grown a request of its own — it must cost nothing to run");

// inventory: the queue owns every plain write
has("editor/inventory.js", /window\.LFH_OUTBOX\.send\(\{/, "inventory writes bypass the queue again — a count typed in a cold store would be lost");
has("editor/inventory.js", /if \(inFlight\.has\(key\)\) throw new Error/, "the inventory double-tap guard is gone");
has("editor/inventory.js", /document\.querySelector\("\.inv-pop, #invPop"\)/, "the live refresh can repaint over a half-finished count again");

// ── the four the owner asked for on 2026-08-18 ────────────────────────────────────────────────
files["errlog.js"] = read("errlog.js");
files["theme.js"] = read("theme.js");

// 21 · a crash with no signal is kept and delivered later
has("errlog.js", /var PENDING_KEY = "lfh_errlog_pending"/,
  "a crash raised with no signal is lost again — nothing keeps it");
has("errlog.js", /if \(payload\.kind !== "error"\) return;/,
  "the offline store is keeping tap breadcrumbs too, which fills it to no purpose");
has("errlog.js", /var PENDING_MAX = 5;/,
  "the offline store no longer matches the server's own 5-per-10-minutes ceiling, so it promises a delivery that cannot happen");
has("errlog.js", /if \(list\[i\]\.message === payload\.message\) return;/,
  "identical crashes are no longer folded, so one crash in a loop can spend every place");
has("errlog.js", /addEventListener\("online", flushPending\)/,
  "nothing delivers the kept crashes when the connection returns");
has("errlog.js", /offline, "/,
  "a replayed crash no longer says it happened earlier, so it reads as a fault happening now");
// …and says it ONCE. A refused delivery re-stashes the row, and the row already carries the note, so
// each attempt used to append another one — squeezing the code location towards the 120-char cut
// (T9 sweep #7, 2026-08-22).
has("errlog.js", /replace\(\/ · offline, \[\^·\]\*earlier\/g, ""\)/,
  "a re-kept crash stacks another 'offline, N earlier' on every attempt, pushing the code line out of the 120-character field");
has("errlog.js", /if \(!queued\) stash\(payload\)/,
  "a beacon the browser refused to queue is dropped instead of kept");

// 22 · one skin choice across every tab of a panel — but never under a finger
has("theme.js", /addEventListener\("storage"/,
  "a skin switched in one tab no longer reaches another tab of the same panel");
has("theme.js", /if \(down\) \{ held = t; return; \}/,
  "a skin change can now re-colour the board mid-tap, which is the one risk this feature has");
has("theme.js", /function paint\(t\) \{[\s\S]{0,200}?paintButton\(t\);/,
  "the cross-tab apply writes back to storage, which risks two tabs looping at each other");

// 23 · the bell's badge counts every waiting row
has("guestbell.js", /allRows: all,/,
  "the guest bell no longer keeps the full list, so its badge under-counts past 50 waiting rows");
has("guestbell.js", /return last\.allRows\.filter\(isNew\)\.length;/,
  "the badge is counting the capped render list again — it will under-state a real backlog");
has("guestbell.js", /last\.allRows\.map\(rowKey\)\.slice\(0, 500\)/,
  "opening the sheet marks only the visible rows as read, so the badge would never clear a backlog");
has("guestbell.js", /rows: all\.slice\(0, 50\)/,
  "the 50-row render cap is gone — a bad floor could build a sheet nobody can scroll");

// 24 · the charts library is built, not hand-copied, and its version cannot lie
{
  const bv = (() => { try { return fs.readFileSync(path.join(ROOT, "scripts/build-vendor.mjs"), "utf8"); } catch { return null; } })();
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")); } catch { return null; } })();
  const chartFile = (() => { try { return fs.readFileSync(path.join(ROOT, "public/panels/vendor/chart.umd.min.js"), "utf8").slice(0, 200); } catch { return null; } })();
  if (bv && !/node_modules\/chart\.js\/dist\/chart\.umd\.js/.test(bv)) {
    fails.push("scripts/build-vendor.mjs: no longer builds the charts file — it is back to being copied in by hand");
  }
  if (bv && !/bundle: false/.test(bv)) {
    fails.push("scripts/build-vendor.mjs: the charts file is being BUNDLED again; bundling a UMD file breaks its global and every Dashboard graph goes blank");
  }
  const pinned = pkg && ((pkg.devDependencies && pkg.devDependencies["chart.js"]) || (pkg.dependencies && pkg.dependencies["chart.js"]));
  if (!pinned) fails.push("package.json: chart.js is not a dependency, so nothing can rebuild the charts file or prove its version");
  else if (/[\^~]/.test(pinned)) fails.push(`package.json: chart.js is pinned loosely ("${pinned}") — a vendored file must come from an exact version`);
  if (chartFile && pinned) {
    const m = /chart\.js v([0-9.]+) — generated by scripts\/build-vendor\.mjs/.exec(chartFile);
    if (!m) fails.push("public/panels/vendor/chart.umd.min.js: the generated banner is gone — nothing says which version this file is");
    else if (m[1] !== pinned.replace(/^[\^~]/, "")) {
      fails.push(`public/panels/vendor/chart.umd.min.js: says v${m[1]} but package.json pins ${pinned} — re-run npm run build:vendor`);
    }
  }
}
// …and every asset the panels load from our own origin carries a CONTENT hash, so no hand-typed
// version label can ever drift from the file again (the `?v=` is kept true by the PostToolUse hook).
{
  const vpc = (() => { try { return fs.readFileSync(path.join(ROOT, "scripts/verify-panel-cache.mjs"), "utf8"); } catch { return null; } })();
  if (vpc && /path\.includes\("\/vendor\/"\)/.test(vpc)) {
    fails.push("scripts/verify-panel-cache.mjs: our own vendored files are skipped again, so their ?v= is a hand-typed label nothing checks");
  }
  if (vpc && !/--hook/.test(vpc)) {
    fails.push("scripts/verify-panel-cache.mjs: the auto-restamping --hook mode is gone, so somebody has to remember a command again");
  }
}

if (fails.length) {
  console.error("\n✗ shared panel plumbing — " + fails.length + " check(s) failed:\n");
  for (const f of fails) console.error("  · " + f);
  console.error("");
  process.exit(1);
}
console.log("✓ shared panel plumbing — all checks pass");
