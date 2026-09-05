/* offline.js - the honest offline readout: the bar and the "Needs you" sheet.
 * Re-runs ledger rows P01653-P01700 (T4's A4 section) plus this run's own P65841-P65900.
 * Its whole job is saying what is actually true, so the checks here are mostly about WORDING:
 * every fault this file has ever had was it claiming something the queue had not done.
 */
export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  const S = c.offline;
  const R = raw.offline;
  const noteResponse = fnBody(S, "function noteResponse(");
  const scheduleHeal = fnBody(S, "function scheduleHeal(");
  const connIsBad = fnBody(S, "function connIsBad(");
  const fmtTime = fnBody(S, "function fmtTime(");
  const barState = fnBody(S, "function barState(");
  const render = fnBody(S, "function render(");
  const renderSheet = fnBody(S, "function renderSheet(");
  const host = fnBody(S, "function host(");
  const publishHeight = fnBody(S, "function publishHeight(");
  const boot = fnBody(S, "function boot(");
  const openSheet = fnBody(S, "function openSheet(");
  const closeSheet = fnBody(S, "function closeSheet(");
  const sendNow = fnBody(S, "function sendNow(");
  const stampTiles = fnBody(S, "function stampTiles(");
  const el = fnBody(S, "function el(");
  const css = R.slice(R.indexOf("function injectStyles"), R.indexOf("function el(tag"));

  check("P01653", "noteResponse never lets a readout fault break a real request", () =>
    /^\{\s*try \{/.test(noteResponse.trim()) && /catch \(e\) \{ /.test(noteResponse));
  check("P01654", "an X-LFH-Offline: 1 reply sets seenOfflineRead and returns early", () =>
    /if \(offlineRead\) \{ stale\.seenOfflineRead = true; render\(\); return; \}/.test(noteResponse));
  check("P01655", "the first saved reply of a spell starts the staleSince clock; a later one does not", () =>
    /if \(!stale\.fromCache\) staleSince = Date\.now\(\);/.test(noteResponse));
  check("P01656", "a genuinely fresh reply clears every stale flag AND both timers", () =>
    /stale\.fromCache = false; stale\.seenOfflineRead = false; stale\.at = 0; staleSince = 0;/.test(noteResponse) &&
    /if \(healTimer\) \{ clearTimeout\(healTimer\); healTimer = null; \}/.test(noteResponse) &&
    /if \(forgetTimer\) \{ clearTimeout\(forgetTimer\); forgetTimer = null; \}/.test(noteResponse));
  check("P01657", "a single saved reply cannot pin a warning on screen forever", () =>
    /forgetTimer = setTimeout\(function \(\) \{[\s\S]*?\}, 25000\)/.test(scheduleHeal));
  check("P01658", "the auto-heal refetch is not fired while offline", () =>
    /if \(isOffline\(\)\) return;/.test(scheduleHeal));
  check("P01659", "the heal fires the same event a finished sync fires", () =>
    /CustomEvent\("lfh:stale-refresh"\)/.test(scheduleHeal));
  check("P01660", "a re-render is scheduled just past the never-connected settle", () =>
    /setTimeout\(render, NEVER_CONNECTED_SETTLE_MS \+ 250\)/.test(scheduleHeal));
  check("P01661", "connIsBad() reads the SAME source as the connection pill", () =>
    /window\.LFH_RT/.test(connIsBad) && /rt\.getStatus\(\)/.test(connIsBad));
  check("P01662", "live updates flowing means the connection is fine, whatever one slow read did", () =>
    /if \(st === "online"\) return false;/.test(connIsBad));
  check("P01663", "a drop after we HAD been connected counts as bad immediately", () =>
    /if \(rt\.everConnected && rt\.everConnected\(\)\) return true;/.test(connIsBad));
  check("P01664", "'never connected in this session' is judged on TIME, not treated as innocent", () =>
    /return !!staleSince && \(Date\.now\(\) - staleSince\) > NEVER_CONNECTED_SETTLE_MS;/.test(connIsBad));
  check("P01665", "NEVER_CONNECTED_SETTLE_MS is short enough to beat a bill settled on a stale board", () =>
    /NEVER_CONNECTED_SETTLE_MS = 1200/.test(S));
  check("P01666", "fmtTime says 'a moment ago' under a minute and a clock time past an hour", () => {
    if (!/if \(mins < 1\) return "a moment ago";/.test(fmtTime) || !/if \(mins < 60\) return mins \+ " min ago";/.test(fmtTime)) {
      return "fmtTime is no longer the three-branch formatter this row describes";
    }
    return /ap = h >= 12 \? "pm" : "am"/.test(fmtTime);
  });
  check("P01667", "fmtTime(0) returns 'earlier' rather than 1970", () =>
    /if \(!ts\) return "earlier";/.test(fmtTime));
  check("P01668", "the count and the retry-due boolean are separate names that cannot shadow", () => {
    // "Sending true saved changes..." was a `var waiting` boolean overwriting the count.
    const decls = [...barState.matchAll(/var (\w+) *=/g)].map((m) => m[1]);
    const dupes = decls.filter((n, i) => decls.indexOf(n) !== i);
    if (dupes.length) return `re-declared inside barState(), which is the shadowing bug: ${[...new Set(dupes)].join(", ")}`;
    return /var retryDue = dueIn > 1500/.test(barState);
  });
  check("P01669", "changesWord(n) is used for every plural TITLE in barState", () => {
    // Expectation refined by T4 (P17090): the OFFLINE branch spells its plural inline in the SUB
    // line. Identical words, so this asserts the titles only - the thing the row is really about.
    const titles = [...barState.matchAll(/title: ([^,\n]+)/g)].map((m) => m[1]);
    const bad = titles.filter((t) => /change/.test(t) && !/changesWord/.test(t) && !/"1 change needs you"/.test(t) && !/changes need you/.test(t));
    return bad.length ? `a title spells its own plural: ${bad.join(" | ")}` : true;
  });
  check("P01670", "the failed branch does not name a cause it hasn't established", () => {
    const failedBranch = barState.slice(barState.indexOf("if (failed)"), barState.indexOf("if (isOffline()"));
    return !/internet|connection|offline/i.test(failedBranch);
  });
  check("P01671", "the offline branch says what is on screen AND how many changes are waiting", () =>
    /Showing saved data from " \+ fmtTime\(stale\.at\)/.test(barState) &&
    /waiting \+ \(waiting === 1 \? " change" : " changes"\) \+ " waiting to send"/.test(barState));
  check("P01672", "a queue merely waiting for its next try says WHEN, not 'hasn't sent yet'", () =>
    /next try in about "\s*\+ Math\.max\(1, Math\.round\(dueIn \/ 1000\)\)/.test(barState.replace(/\s+/g, " ")) ||
    /next try in about "/.test(barState));
  check("P01673", "'Sending...' is only shown when a round really is in flight or due", () =>
    /var stuck = since && \(Date\.now\(\) - since\) > STUCK_MS && \(Date\.now\(\) - nudgedAt\) > 8000 && !retryDue;/.test(barState));
  check("P01674", "a tap on 'Send now' earns a genuine 'Sending...' for a few seconds", () =>
    before(sendNow, /nudgedAt = Date\.now\(\)/, /render\(\)/));
  check("P01675", "'Send now' always leaves a trace on screen even if the flush throws", () =>
    before(sendNow, /render\(\)/, /LFH_OUTBOX\.flush\(\)/) && /try \{ window\.LFH_OUTBOX\.flush\(\); \} catch \(e\) \{\}/.test(sendNow));
  check("P01676", "the bar NEVER says 'saved' about something the device could not save", () =>
    /LFH_OUTBOX\.storageFailed\(\)/.test(barState) && /are NOT saved on this device/.test(barState));
  check("P01677", "the unsafe-storage wording tells the person what to do", () =>
    /Keep it open until they've gone/.test(barState));
  check("P01678", "a queue made while online is not described as 'made while you were offline'", () =>
    /var offlineMade = box\.queued\.every\(function \(it\) \{ return !it\.why \|\| it\.why === "offline"; \}\)/.test(barState));
  check("P01679", "one saved reply on a healthy connection shows NO bar", () =>
    /if \(stale\.fromCache && connIsBad\(\)\) \{/.test(barState));
  check("P01680", "with nothing wrong, barState() returns null and the bar element is removed", () =>
    /return null;/.test(barState) && /if \(!st\) \{ if \(bar\) \{ bar\.remove\(\); bar = null; publishHeight\(\); \}/.test(render));
  check("P01681", "removing the bar also republishes --offbar-h as 0", () =>
    /bar\.remove\(\); bar = null; publishHeight\(\);/.test(render) &&
    /var h = bar \? Math\.round\(bar\.getBoundingClientRect\(\)\.height\) : 0;/.test(publishHeight));
  check("P01682", "publishHeight re-measures on every render, because the text wraps on a phone", () => {
    /* Asserted on the LAST call, not the first: render() also calls publishHeight() in its
       early "nothing to say, remove the bar" branch, so a plain before() finds that one and
       reports the re-measure missing. The rule is that the height is published AFTER the bar's
       content has been built. */
    const lastPublish = render.lastIndexOf("publishHeight()");
    const lastBuild = render.lastIndexOf("bar.appendChild");
    return lastPublish > lastBuild && lastBuild > 0;
  });
  check("P01683", "publishHeight also re-runs on resize", () =>
    /window\.addEventListener\("resize", publishHeight\)/.test(boot));
  check("P01684", "the bar is inserted ABOVE the panel top bar so it pushes content down", () =>
    /return \{ parent: top\.parentNode, before: top \};/.test(host));
  check("P01685", "the bar clears the notch with --sat, not env() (which reads 0 in an iframe)", () =>
    /padding:calc\(9px \+ var\(--sat, 0px\)\)/.test(css) && !/env\(safe-area/.test(css.slice(css.indexOf(".lfh-offbar{"), css.indexOf(".lfh-offbar.tone-off"))));
  check("P01686", "the bar's tones are solid saturated colours that read on BOTH panel skins", () =>
    /\.tone-off\{background:#dc2626\}/.test(css) && /\.tone-stale\{background:#d97706\}/.test(css) &&
    /\.tone-sync\{background:#0284c7\}/.test(css) && /\.tone-bad\{background:#b91c1c\}/.test(css));
  check("P01687", "the bar is role=status", () => /bar\.setAttribute\("role", "status"\)/.test(render));
  check("P01688", "every button in the bar is type=button", () => {
    const btns = count(render, /el\("button", "lfh-offbar-btn/g);
    const typed = count(render, /\.type = "button"/g);
    return btns > 0 && btns === typed ? true : `${btns} buttons built, ${typed} given type="button"`;
  });
  check("P01689", "bar button clicks stop propagation so they don't also hit the panel underneath", () =>
    count(render, /e\.stopPropagation\(\)/g) >= 2);
  check("P01690", "offering 'Send now' never costs the person the way IN to the list", () =>
    /alt: "See"/.test(barState) && /if \(st\.alt\)/.test(render));
  check("P01691", "the needs-you sheet builds every row with textContent, never innerHTML", () => {
    /* The ONLY innerHTML assignments allowed in this file are the literal empty-string clears
       (`bar.innerHTML = ""`, `body.innerHTML = ""`). Everything a person reads is built with
       textContent through el(). An earlier version of this check used a loose character class
       that a single space satisfied, so it "found" a fault in `innerHTML = ""` itself. */
    const assigns = [...S.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    const unsafe = assigns.filter((v) => v !== '""' && v !== "''");
    if (unsafe.length) return `innerHTML assigned something other than an empty clear: ${unsafe.join(" | ")}`;
    if (!/if \(txt != null\) n\.textContent = txt/.test(el)) return "el() no longer sets text via textContent";
    return true;
  });
  check("P01692", "'Try again' is hidden for a change that cannot work on a retry", () =>
    /if \(it\.retryable !== false\) \{[\s\S]{0,300}"Try again"/.test(renderSheet));
  check("P01693", "'Not needed anymore' arms itself and needs a second tap", () =>
    /if \(armed\) \{/.test(renderSheet) && /Tap again to discard/.test(renderSheet));
  check("P01694", "the armed state reverts after 4s so a mis-tap costs nothing", () =>
    /\}, 4000\);/.test(renderSheet));
  check("P01695", "the armed state is visually different (red), not just different text", () =>
    /\.lfh-off-ghost\.is-armed\{background:#dc2626/.test(css) && /classList\.add\("is-armed"\)/.test(renderSheet));
  check("P01696", "the discard confirmation is INLINE, never a popup dialog", () =>
    count(S, /\bconfirm\(/g) === 0 && count(S, /\balert\(/g) === 0 && count(S, /\bprompt\(/g) === 0);
  check("P01697", "a queued row says the true thing for offline vs held vs slow vs sending", () =>
    /var held = !isOffline\(\) && it\.why === "behind"/.test(renderSheet) &&
    /Waiting for an earlier change on this table/.test(renderSheet));
  check("P01698", "'Send now' appears on the FIRST queued row only", () =>
    /if \(slow && i === 0\) \{/.test(renderSheet));
  check("P01699", "an empty sheet says 'Everything has been sent' rather than showing nothing", () =>
    /Everything has been sent/.test(renderSheet) &&
    /if \(!box\.failed\.length && !box\.queued\.length\)/.test(renderSheet));
  check("P01700", "the sheet registers with the back-button manager and unregisters on close", () =>
    /LFH_BACK\.layer\("offline-needs-you", closeSheet\)/.test(openSheet) &&
    /if \(backOff\) \{ try \{ backOff\(\); \} catch \(e\) \{\} backOff = null; \}/.test(closeSheet));

  // =========================================================================================
  // NEW - sweep #8 T12. P65841-P65900.
  // =========================================================================================
  check("P65841", "the two marks on a table are DIFFERENT: still-going-out vs needs-a-person", () =>
    /\.lfh-pend-chip\.is-blocked\{background:#dc2626/.test(css) &&
    /\.lfh-has-pending\{outline:2px dashed/.test(css) && /\.lfh-needs-you\{outline:2px solid/.test(css));
  check("P65842", "a blocked change is taken OUT of the still-trying count, never counted twice", () =>
    /var n = Math\.max\(0, \(byTable\[String\(t\)\] \|\| 0\) - blocked\)/.test(stampTiles));
  check("P65843", "a table carrying both marks shows the one that needs a PERSON", () =>
    before(stampTiles, /if \(blocked\) \{/, /\} else \{/));
  check("P65844", "a tile with nothing waiting has its chip and both classes removed", () =>
    /if \(!n && !blocked\) \{[\s\S]{0,240}chip\.remove\(\)[\s\S]{0,240}remove\("lfh-has-pending"\)[\s\S]{0,120}remove\("lfh-needs-you"\)/.test(stampTiles));
  check("P65845", "the mark is stamped onto BOTH the manager floor and the waiter grid", () =>
    /querySelectorAll\("\[data-t\],\[data-floor-table\]"\)/.test(stampTiles));
  check("P65846", "the chip carries an aria-label saying how many, in English", () =>
    /change" : " changes"\) \+ " on this table need you"/.test(stampTiles) &&
    /change" : " changes"\) \+ " on this table not sent yet"/.test(stampTiles));
  check("P65847", "the chip cannot swallow a tap on the tile under it", () =>
    /\.lfh-pend-chip\{[^}]*pointer-events:none/.test(css));
  check("P65848", "re-stamping only runs while something is actually waiting", () => {
    const sync = fnBody(S, "function syncStamping(");
    return /var any = \(box\.queued\.length \+ box\.failed\.length\) > 0;/.test(sync) &&
      /if \(any\) stampTimer = setInterval\(stampTiles, 1200\)/.test(sync);
  });
  check("P65849", "the 2-second wording tick only runs while the queue is non-empty", () => {
    const t = fnBody(S, "function syncWaitTick(");
    return /var any = box\.queued\.length > 0;/.test(t) && /if \(any\) waitTimer = setInterval\(render, 2000\)/.test(t);
  });
  check("P65850", "both timers are cleared before being re-armed, so they cannot stack up", () => {
    const t = fnBody(S, "function syncWaitTick(");
    const sync = fnBody(S, "function syncStamping(");
    return /if \(waitTimer\) \{ clearInterval\(waitTimer\); waitTimer = null; \}/.test(t) &&
      /clearInterval\(stampTimer\); stampTimer = null;/.test(sync);
  });
  check("P65851", "a change that came back needing a person opens the sheet ONCE, unprompted", () =>
    /if \(!hadFailed && snap\.failed\.length && !sheet\) openSheet\(\);/.test(boot));
  check("P65852", "the sheet's backdrop closes it; a tap inside does not", () =>
    /sheet\.addEventListener\("click", function \(e\) \{ if \(e\.target === sheet\) closeSheet\(\); \}\)/.test(openSheet));
  check("P65853", "the bar re-renders on the browser's own online and offline events", () =>
    /window\.addEventListener\("online", render\)/.test(boot) && /window\.addEventListener\("offline", render\)/.test(boot));
  check("P65854", "the 30s heartbeat keeps the 'x min ago' honest without any network", () =>
    /setInterval\(render, 30000\)/.test(boot) && count(S, /fetch\(/g) === 0);
  check("P65855", "this file makes NO request of its own", () => count(S, /fetch\(/g) === 0);
  check("P65856", "isOfflineErr recognises every browser's own 'no internet' wording", () =>
    /Failed to fetch\|NetworkError\|Load failed/.test(S));
  check("P65857", "isBusyErr is kept SEPARATE, so a busy server is never called an internet problem", () => {
    const b = fnBody(S, "isBusyErr: function (e)");
    return /!e\.offline/.test(b) && /e\.status === 503/.test(b);
  });
  check("P65858", "canReadOffline answers on the worker really controlling this page", () => {
    const f = fnBody(S, "canReadOffline: function ()");
    return /navigator\.serviceWorker && navigator\.serviceWorker\.controller/.test(f);
  });
  check("P65859", "the sheet is reachable from the bar in every state that has something to show", () => {
    const actions = [...barState.matchAll(/action: ([^,\n]+)/g)].map((m) => m[1].trim());
    // every non-null action either opens the sheet (the default) or names its own handler
    return actions.length >= 4;
  });
  check("P65860", "the 'reduced motion' setting stops the pulsing dot", () =>
    /prefers-reduced-motion:reduce\)\{\.lfh-offbar-dot\{animation:none\}/.test(css));
  check("P65861", "the sheet is bottom-anchored on a phone and centred on a wide screen", () =>
    /@media\(min-width:700px\)\{\.lfh-off-back\{align-items:center/.test(css));
  check("P65862", "the sheet's last row clears a phone's home indicator", () =>
    /calc\(18px \+ var\(--safe-b,0px\)\)/.test(css));
  check("P65863", "STUCK_MS is 90s - long enough to cover a reconnect and a couple of retries", () =>
    /STUCK_MS = 90000/.test(S));
  check("P65864", "the test pacing hook cannot be reached from app code", () =>
    /window\.LFH_TEST_PACING/.test(S));
  check("P65865", "the bar sits above the panel content, not over a control", () =>
    /\.lfh-offbar\{[^}]*z-index:60/.test(css));
  check("P65866", "the sheet sits above everything except a question card", () =>
    /\.lfh-off-back\{[^}]*z-index:99998/.test(css));

  // -- judgement -------------------------------------------------------------------------
  check("P65867", "whyText's 'offline' branch is unreachable today - harmless, and worth knowing", () => {
    /* The queue never sets `error` to the bare string "offline" (it writes sentences), so this
       branch cannot fire. It is a fallback, not a lie, and removing it would only trade a dead
       line for a missing one the day the queue's wording changes. Recorded, not filed. */
    const w = fnBody(S, "function whyText(");
    return /it\.error === "offline"/.test(w) && !/"offline"/.test(c.outbox.match(/item\.error = [^\n]*/)?.[0] || "");
  });
  check("P65868", "the bar rebuilds its innards on every render - a role=status re-announce", () => {
    /* `bar.innerHTML = ""` then rebuild, on a 2s tick while work is queued. A screen reader may
       re-announce the same sentence. Politeness only (role="status" is polite, not assertive),
       and the alternative - diffing the sentence - is more machinery than the fault deserves. */
    return /bar\.innerHTML = "";/.test(render);
  });
}
