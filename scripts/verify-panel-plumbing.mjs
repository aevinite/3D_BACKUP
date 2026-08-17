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
import path from "node:path";

const ROOT = process.argv[2] || process.cwd();
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

// ── guestbell.js — cheap enough to call on every paint, and clear of the home indicator ────────
has("guestbell.js", /var seenSet = null;/,
  "the seen list is being re-read from storage once per row again");
has("guestbell.js", /var\(--sab, env\(safe-area-inset-bottom, 0px\)\)/,
  "the bell sheet reads only the injected inset, so its last row hides under a phone's home bar");

// ── editor/inventory.js — a read gets a ceiling too ────────────────────────────────────────────
has("editor/inventory.js", /\}\r?\n\s*\/\/ A READ GETS A CEILING TOO[\s\S]{0,600}?opts\.signal = invDeadline\(\);\r?\n\s*try \{/,
  "the inventory deadline is back inside the write-only branch — a read can hang on 'Loading inventory…' forever");

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
has("undobar.js", /var DEFAULT_SECONDS = 4/, "the take-back window is no longer the 4 seconds the owner asked for");
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
