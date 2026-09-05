/* connbadge.js - the connection pill in every panel's top bar. Re-runs ledger rows
 * P04131-P04175 (T9, sweep #6) plus this run's own. The expensive claims here are the ones about
 * what the pill SAYS: it sits three inches from the offline bar, and two surfaces describing one
 * moment differently is the fault this file has already been repaired for twice.
 */
export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  const S = c.connbadge;
  const R = raw.connbadge;
  const compute = fnBody(S, "function computeView(");
  const tier = fnBody(S, "function latencyTier(");
  const render = fnBody(S, "function render(");
  const renderPop = fnBody(S, "function renderPop(");
  const openPop = fnBody(S, "function openPop(");
  const closePop = fnBody(S, "function closePop(");
  const clamp = fnBody(S, "function clampPop(");
  const mount = fnBody(S, "function mount(");
  const boot = fnBody(S, "function boot(");
  const syncState = fnBody(S, "function syncState(");
  const css = R.slice(R.indexOf("function injectStyles"), R.indexOf("var badge = null"));

  check("P04131", "the pill's tiers match latencyTier() in lib/connectionStatus.ts", () => {
    const mine = [...tier.matchAll(/ms <= (\d+)/g)].map((m) => m[1]);
    const theirs = [...(c.connectionStatus || "").matchAll(/ms <= (\d+)/g)].map((m) => m[1]);
    if (!theirs.length) return "could not read lib/connectionStatus.ts";
    return mine.join(",") === theirs.slice(0, mine.length).join(",")
      ? true : `panel tiers [${mine}] vs lib tiers [${theirs}]`;
  });
  check("P04132", "bars (0-3) carry the same meaning as colour, so it is never colour-only", () =>
    count(tier, /bars: \d/g) === 4);
  check("P04133", "'Slow' (1 bar) and 'Poor' (0 bars) differ by more than hue", () =>
    /bars: 1, label: "Slow"/.test(tier) && /bars: 0, label: "Poor"/.test(tier));
  check("P04134", "a latency reading older than 90s falls back to a calm 'Live'", () =>
    /LATENCY_FRESH_MS = 90000/.test(S) &&
    /var fresh = lat\.at > 0 && \(Date\.now\(\) - lat\.at\) < LATENCY_FRESH_MS/.test(compute));
  check("P04135", "offline paints red with 0 bars and 'No internet connection'", () =>
    /level === "offline"\) return \{ level: level, color: "#ef4444"[^}]*bars: 0, label: "Offline"/.test(compute) &&
    /if \(v\.level === "offline"\) return "No internet connection"/.test(S));
  check("P04136", "first-connect paints a neutral 'Connecting...', not amber 'Reconnecting'", () =>
    /if \(!ever\) return \{ level: level, connecting: true[^}]*label: "Connecting/.test(compute));
  check("P04137", "the whole pill is one button and always opens the details panel", () =>
    /badge = el\("button", "lfh-conn"\)/.test(mount) &&
    /badge\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); togglePop\(\); \}\)/.test(mount));
  check("P04138", "the popover registers with LFH_BACK so hardware Back closes it first", () =>
    /LFH_BACK\.layer\("conn-badge", closePop\)/.test(openPop));
  check("P04139", "closing the popover unregisters its back layer", () =>
    /if \(backOff\) \{ try \{ backOff\(\); \} catch \(e\) \{\} backOff = null; \}/.test(closePop));
  check("P04140", "click-away closes it, and the badge's own click does not re-close it", () =>
    /setTimeout\(function \(\) \{ document\.addEventListener\("click", onDocClick\); \}, 0\)/.test(openPop) &&
    /pop\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); \}\)/.test(openPop));
  check("P04141", "the popover is clamped back on-screen when the badge sits near an edge", () =>
    /if \(r\.left < pad\) shift = pad - r\.left;/.test(clamp) &&
    /else if \(r\.right > window\.innerWidth - pad\)/.test(clamp));
  check("P04142", "the clamp measures from the UNSHIFTED position so it cannot drift", () =>
    before(clamp, /setProperty\("--pop-x", "0px"\)/, /getBoundingClientRect\(\)/) &&
    before(clamp, /pop\.style\.transform = ""/, /getBoundingClientRect\(\)/));
  check("P04143", "the clamp survives the entry animation via --pop-x in the keyframes", () =>
    /@keyframes lfhConnPop\{from\{transform:translate\(var\(--pop-x\),-4px\)/.test(css));
  check("P04144", "the clamp re-runs after every re-render, not only on open", () =>
    /if \(pop\) \{ renderPop\(v\); clampPop\(\); \}/.test(render));
  check("P04145", "dark panel skins get the BRIGHT ink; light skins get the darkened ink", () =>
    /html\[data-theme="dark"\] \.lfh-conn-txt/.test(css) && /--ink-dark/.test(css) && /--ink-light/.test(css));
  check("P04146", "[data-skin=light] beats the document-level dark rule", () =>
    /html \[data-skin="light"\] \.lfh-conn-txt/.test(css) &&
    before(css, /\[data-skin="dark"\] \.lfh-conn-txt/, /html \[data-skin="light"\] \.lfh-conn-txt/));
  check("P04147", "the ink values are the re-measured ones from the T11 contrast pass", () =>
    /text: "#166534"/.test(tier) && /text: "#a16207"/.test(tier) &&
    /text: "#c2410c"/.test(tier) && /text: "#b91c1c"/.test(tier) && /text: "#15803d"/.test(compute));
  check("P04148", "the waiting count appears on the pill itself", () =>
    /nEl\.textContent = extra \? "· " \+ extra : ""/.test(render));
  check("P04149", "a failed row turns the count red", () =>
    /nEl\.className = "lfh-conn-n" \+ \(failed \? " warn" : ""\)/.test(render) && /\.lfh-conn-n\.warn\{color:#ef4444\}/.test(css));
  check("P04150", "the popover does not say 'Sending...' about work that is not being sent", () =>
    /if \(outbox\.syncing\) return \{ word: "Sending/.test(syncState) &&
    !/count > 0|count \> 0/.test(syncState));
  check("P04151", "a Retry / Dismiss tap inside the popover is never swallowed by a re-render", () =>
    /if \(popHeld \|\| sig === popPrinted\) return;/.test(renderPop) &&
    /pop\.addEventListener\("pointerdown", function \(\) \{ popHeld = true; \}\)/.test(openPop));
  check("P04152", "each failed row's Retry retries THAT row only", () =>
    /LFH_OUTBOX\.retryOne\(it\.id\)/.test(renderPop) && !/retryFailed\(\)/.test(renderPop));
  check("P04153", "a clash row is offered no Retry (it cannot work)", () =>
    /if \(it\.retryable !== false\) \{[\s\S]{0,400}"Retry"/.test(renderPop));
  check("P04154", "every failed row can be dismissed", () =>
    /el\("button", "lfh-conn-x", "Dismiss"\)/.test(renderPop) && /LFH_OUTBOX\.dismiss\(it\.id\)/.test(renderPop));
  check("P04155", "with nothing waiting the popover says everything is synced", () =>
    /Everything is synced/.test(renderPop));
  check("P04156", "the sparkline is a fixed 24 slots so it reads as a chart from the first reading", () =>
    /SPARK_SLOTS = 24/.test(S) && /for \(var i = 0; i < SPARK_SLOTS - data\.length; i\+\+\)/.test(renderPop));
  check("P04157", "the sparkline only shows while the level is online", () =>
    /if \(v\.level === "online"\) \{[\s\S]{0,200}getLatencyHistory/.test(renderPop));
  check("P04158", "every sparkline bar is coloured by its OWN tier", () =>
    /var t = latencyTier\(val\)/.test(renderPop));
  check("P04159", "a sparkline bar never collapses to zero height", () =>
    /Math\.max\(14, Math\.round\(\(val \/ max\) \* 100\)\)/.test(renderPop));
  check("P04160", "the badge carries a full aria-label and aria-expanded", () =>
    /badge\.setAttribute\("aria-label", "Connection: "/.test(render) &&
    /badge\.setAttribute\("aria-expanded"/.test(render));
  check("P04161", "the popover is role=dialog with a label", () =>
    /pop\.setAttribute\("role", "dialog"\)/.test(openPop) &&
    /pop\.setAttribute\("aria-label", "Connection details"\)/.test(openPop));
  check("P04162", "reduced-motion turns off both the bar pulse and the popover animation", () =>
    /prefers-reduced-motion:reduce\)\{\.lfh-conn\.is-pulse \.lfh-bar\{animation:none\}\.lfh-conn-pop\{animation:none\}/.test(css));
  check("P04163", "taps on the pill are never written to the activity log", () =>
    /el\.closest\("\.lfh-conn"\) \|\| el\.closest\("\.lfh-conn-pop"\)\) return;/.test(c.errlog));
  check("P04164", "there is no second, duplicate connection indicator in the manager panel", () => {
    /* THE ROW'S OWN "how to verify" IS NOW STALE, and the rule is satisfied more strongly than it
       asks. It said the legacy `#conn` dot is HIDDEN by mount(). On 2026-09-03 the element, its
       four writes and its CSS were all deleted instead - so there is nothing left to hide, and the
       two lines in mount() that hid it are gone too. Assert the RULE (one indicator), not the old
       mechanism. Judged on comment-STRIPPED text: the manager panel keeps an obituary that quotes
       the markup it removed, and matching that is how this check failed on its first run. */
    if (/id=["']conn["']/.test(c.editorHtml || "")) return "the legacy #conn element is back in the manager panel markup";
    if (/\$\(["']#conn["']\)/.test(c.editorApp || "")) return "app.js is writing to #conn again";
    if (/\.conn\b|#conn\b/.test(c.editorCss || "")) return "the legacy #conn styling is back";
    return true;
  });
  check("P04165", "the 8-second repaint does not run while the tab is hidden", () =>
    /setInterval\(function \(\) \{ if \(!document\.hidden\) render\(\); \}, 8000\)/.test(boot));
  check("P04166", "boot() subscribes to outbox changes (load order puts outbox.js first)", () => {
    /* Judged on the real <script src> tags, in order. The first run of this check used indexOf on
       the whole file and failed, because the manager panel NAMES these files in a comment above
       the tags ("outbox.js, connbadge.js, offline.js and errlog.js, which all reach for it").
       A mention is not a load. */
    for (const k of ["editorHtml", "kitchenHtml", "tabletHtml"]) {
      const srcs = [...(c[k] || "").matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      const o = srcs.findIndex((s2) => s2.includes("/outbox.js"));
      const b = srcs.findIndex((s2) => s2.includes("/connbadge.js"));
      if (o < 0) return `${k}: outbox.js is not loaded at all`;
      if (b < 0) return `${k}: connbadge.js is not loaded at all`;
      if (o > b) return `${k}: outbox.js must load before connbadge.js (got ${o} vs ${b})`;
    }
    return /LFH_OUTBOX\.onChange\(function \(snap\) \{ outbox = snap; render\(\); \}\)/.test(boot);
  });
  check("P04167", "boot() defers to DOMContentLoaded so LFH_RT / LFH_OUTBOX are always there", () =>
    /if \(document\.readyState !== "loading"\) boot\(\);\s*else document\.addEventListener\("DOMContentLoaded", boot\)/.test(S));
  check("P04168", "the pill mounts into .top-actions when there is one", () =>
    /document\.querySelector\("\.topbar \.top-actions"\) \|\| document\.querySelector\("\.topbar"\)/.test(mount));
  skipRow("P04169", "the pill renders on the manager panel at 1280x800 in both skins", "driven live - see live.checks");
  skipRow("P04170", "the pill renders on the manager panel at 360x780 without clipping", "driven live - see live.checks");
  skipRow("P04171", "the popover fits inside a 360px screen and its text is not cut off", "driven live - see live.checks");
  skipRow("P04172", "the pill renders on the kitchen panel in both skins", "driven live - see live.checks");
  skipRow("P04173", "the pill renders on the tablet panel in both skins", "driven live - see live.checks");
  check("P04174", "fmtAgo reads as English (just now / 3m ago / 2h ago)", () => {
    if (!/function fmtAgo\(ts\) \{ var m = Math\.floor\(\(Date\.now\(\) - ts\) \/ 60000\); return m < 1 \? "just now" : m < 60 \? m \+ "m ago" : Math\.floor\(m \/ 60\) \+ "h ago"; \}/.test(S)) {
      return "fmtAgo is no longer the three-branch formatter this row describes";
    }
    const fmtAgo = (ts) => { const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : Math.floor(m / 60) + "h ago"; };
    const now = Date.now();
    return fmtAgo(now) === "just now" && fmtAgo(now - 3 * 60000) === "3m ago" && fmtAgo(now - 125 * 60000) === "2h ago";
  });
  check("P04175", "the pill makes NO request of its own", () => count(S, /fetch\(/g) === 0);

  // =========================================================================================
  // NEW - sweep #8 T12. P65776-P65820.
  // =========================================================================================
  check("P65776", "connLevel() collapses anything that is not online/offline to weak", () => {
    const l = fnBody(S, "function connLevel(");
    return /s === "online" \? "online" : \(s === "offline" \? "offline" : "weak"\)/.test(l);
  });
  check("P65777", "connLevel() reads the device's own offline flag ahead of the socket", () => {
    const l = fnBody(S, "function connLevel(");
    return before(l, /navigator\.onLine === false/, /LFH_RT/);
  });
  check("P65778", "the resting healthy view is NAMED (rest:true), not detected from its label", () =>
    /rest: true/.test(compute) && /badge\.setAttribute\("data-rest", v\.rest \? "1" : "0"\)/.test(render));
  check("P65779", "a warning view is never marked rest, so a narrow panel cannot hide it", () =>
    count(compute, /rest: true/g) === 1);
  check("P65780", "the empty waiting-count span costs no layout when there is nothing to say", () =>
    /\.lfh-conn-n:empty\{display:none\}/.test(css));
  check("P65781", "syncState says Waiting, not Sending, while the device is offline", () =>
    /if \(navigator\.onLine === false\) return \{ word: "Waiting"/.test(syncState));
  check("P65782", "syncState offers the real countdown from the queue, never a guess", () =>
    /LFH_OUTBOX\.nextTryAt && window\.LFH_OUTBOX\.nextTryAt\(\)/.test(syncState));
  check("P65783", "the countdown is never rendered as a negative number of seconds", () =>
    /Math\.max\(0, Math\.round\(\(due - Date\.now\(\)\) \/ 1000\)\)/.test(syncState));
  check("P65784", "whyLine falls back to a plain true sentence, never a raw code", () => {
    const w = fnBody(S, "function whyLine(");
    return /\|\| "waiting to send"/.test(w);
  });
  check("P65785", "every reason the queue can record has a sentence in WHY", () => {
    const whyBlock = (S.match(/var WHY = \{([\s\S]*?)\};/) || [])[1] || "";
    const mine = new Set([...whyBlock.matchAll(/(\w+):/g)].map((m) => m[1]));
    // the reasons outbox.js actually sets, read out of its own enqueue() call sites
    const set = new Set([...c.outbox.matchAll(/enqueue\(item, *"(\w+)"\)/g)].map((m) => m[1]));
    set.add("behind");   // send()'s per-table hold
    const missing = [...set].filter((r) => !mine.has(r));
    return missing.length ? `the queue records these with no sentence here: ${missing.join(", ")}` : true;
  });
  check("P65786", "popSig covers the failed rows' ids, errors AND retryability", () => {
    const p = fnBody(S, "function popSig(");
    return /it\.id \+ ":" \+ \(it\.error \|\| ""\) \+ ":" \+ \(it\.retryable === false \? "0" : "1"\)/.test(p);
  });
  check("P65787", "popSig covers the latency history length, so the sparkline repaints as it fills", () => {
    const p = fnBody(S, "function popSig(");
    return /getLatencyHistory\(\)\.length/.test(p);
  });
  check("P65788", "the pointer hold is released on window, not just on the panel", () =>
    /window\.addEventListener\("pointerup", onPointerUp\)/.test(openPop));
  check("P65789", "closing the popover removes the window pointerup listener it added", () =>
    /window\.removeEventListener\("pointerup", onPointerUp\)/.test(closePop));
  check("P65790", "closing the popover removes the document click-away listener it added", () =>
    /document\.removeEventListener\("click", onDocClick\)/.test(closePop));
  check("P65791", "closing the popover forgets what it printed, so the next open rebuilds", () =>
    /popHeld = false; popPrinted = "";/.test(closePop));
  check("P65792", "the bars are built as nodes, never as innerHTML", () => {
    const b = fnBody(S, "function barsHtml(");
    return !/innerHTML/.test(b) && /el\("span", "lfh-bar"\)/.test(b);
  });
  check("P65793", "the chevron is built in the SVG namespace, so it actually draws", () =>
    /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/.test(mount));
  check("P65794", "the popover repaints once on becoming visible, not on a hidden timer", () =>
    /document\.addEventListener\("visibilitychange", function \(\) \{ if \(!document\.hidden\) render\(\); \}\)/.test(boot));
  check("P65795", "the 44px tap-target enlargement is recorded as REJECTED, with the doc named", () =>
    /REJECTED \(owner, 2026-08-20\)/.test(R) && /docs\/REJECTED-IDEAS\.md \(R40\)/.test(R));
  check("P65796", "the pill's own tap is excluded from the activity log by CLASS, in errlog", () =>
    /\.lfh-conn/.test(c.errlog));

  /* P65797 - THE ONE CONTRADICTION LEFT INSIDE A SINGLE ROW.
     A queued change whose reason is "behind" is being HELD ON PURPOSE - it is not being sent, and
     it must not be, or a discount and the settle after it could swap. Its own subtitle in this
     popover says so ("waiting for an earlier change on this table"). But the PILL on the same row
     is `st.word`, which is one device-wide answer: while any round is in flight it reads
     "Sending...", in the green "moving" colour. So the row says both things at once, two inches
     apart, which is exactly the fault P04150 and the offline bar were each repaired for.
     offline.js's own sheet already special-cases this (`held`); this panel never did. */
  check("P65797", "a change held behind an earlier one is not pilled 'Sending...'", () => {
    /* ASSERTED ON WHAT THE PILL IS BUILT FROM, not on a phrase appearing nearby. The first
       version of this check looked for `it.why === "behind"` anywhere in the queued-row loop —
       so when the fix was deliberately reverted (the pill put back to the device-wide `st.word`)
       the line declaring `heldBack` was still there and the guard stayed GREEN over the exact
       bug it was written for. Caught by sabotaging it; recorded here because a guard that keeps
       passing while its subject is broken is worth less than no guard at all.
       The rule: the pill's WORD and its two colours must each be chosen per row, not taken
       straight from the device-wide answer. */
    const queuedRows = renderPop.slice(renderPop.indexOf("outbox.queued.forEach"));
    if (!/el\("span", "lfh-conn-pill"/.test(queuedRows)) return "could not find the queued row's pill";
    if (!/it\.why === "behind"/.test(queuedRows)) return "nothing in the queued row reads why the change is waiting";
    /* RESOLVE THE NAMES, don't read the call. The pill is built as
           var pill = el("span", "lfh-conn-pill", word);
       so looking at that line only ever sees the identifier `word` — which is exactly as true
       when `word` is the per-row choice as when somebody sets `var word = st.word;`. The second
       sabotage of this check walked straight through it for that reason. Follow each name back
       to what it is ASSIGNED, and require the row's own reason to be in that expression. */
    const pillWord = (queuedRows.match(/el\("span", "lfh-conn-pill", ([^)]+)\)/) || [])[1];
    if (!pillWord) return "could not read what the pill is labelled with";
    const nameOf = (n) => (queuedRows.match(new RegExp(`var ${n}\\s*=\\s*([^;]+);`)) || [])[1] || "";
    const wordExpr = /^[A-Za-z_$][\w$]*$/.test(pillWord.trim()) ? nameOf(pillWord.trim()) : pillWord;
    if (!wordExpr) return `could not resolve what the pill's label (${pillWord.trim()}) is set from`;
    if (!/heldBack|it\.why/.test(wordExpr)) {
      return `the pill's word is "${wordExpr.trim()}" — the device-wide answer, so a deliberately-held change reads as being sent`;
    }
    const bgExpr = (queuedRows.match(/pill\.style\.background = ([^;]+);/) || [])[1] || "";
    const bgName = (bgExpr.match(/^\s*([A-Za-z_$][\w$]*)\s*\?/) || [])[1];
    const movingExpr = bgName ? nameOf(bgName) || bgName : bgExpr;
    if (/^\s*st\.sending\s*$/.test(movingExpr) || /^\s*st\.sending\s*\?/.test(bgExpr)) {
      return "the pill's colour comes straight from the device-wide answer, so a held change is painted as moving";
    }
    return true;
  });
}
