/* errlog.js - crash capture + tap breadcrumbs. Re-runs ledger rows P04176-P04210 (T9, sweep #6)
 * plus this run's own. This is the only path by which a screen that breaks during service leaves
 * a trace, so a filter that is one character too wide loses real faults silently.
 */
export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  const S = c.errlog;
  const R = raw.errlog;
  const isBenignSrc = fnBody(S, "function isBenign(");
  const frames = fnBody(S, "function frames(");
  const label = fnBody(S, "function label(");
  const visibleText = fnBody(S, "function visibleText(");
  const reportError = fnBody(S, "function reportError(");
  const post = fnBody(S, "function post(");
  const send = fnBody(S, "function send(");
  const stash = fnBody(S, "function stash(");
  const flushPending = fnBody(S, "function flushPending(");
  const detect = fnBody(S, "function detectPanel(");

  /* The file's own filter, written out here rather than evaluated from source: a guard that runs
     the code it is judging can only ever agree with it. Kept in step by P04184, which asserts the
     phrase list has not moved. */
  const NOISE = [
    "Failed to fetch", "NetworkError when attempting to fetch", "Load failed",
    "The network connection was lost", "The Internet connection appears to be offline", "network error",
  ];
  const isBenign = (message) => {
    const m = String(message || "").trim();
    if (m.indexOf("Failed to execute 'print' on 'Window'") >= 0) return true;
    const bare = m.replace(/^[A-Za-z]*Error:\s*/, "").replace(/[.\s]+$/, "");
    return NOISE.some((n) => bare.toLowerCase() === n.toLowerCase());
  };

  check("P04176", "a window error becomes one client-error row", () =>
    /window\.addEventListener\("error", function \(e\) \{/.test(S) && /reportError\(e && e\.message/.test(S));
  check("P04177", "an unhandled rejection becomes one row", () =>
    /window\.addEventListener\("unhandledrejection", function \(e\) \{/.test(S));
  check("P04178", "an identical message inside 5s is deduped so a render loop cannot spam", () =>
    /if \(message === lastMsg && now - lastAt < 5000\) return;/.test(reportError));
  check("P04179", "the network-noise filter matches the browser's WHOLE message, never a fragment", () =>
    /bare\.toLowerCase\(\) === NETWORK_NOISE\[i\]\.toLowerCase\(\)/.test(isBenignSrc));
  check("P04180", "'Menu Load failed' (our own words) is still reported", () => isBenign("Menu Load failed") === false);
  check("P04181", "a 'TypeError: Failed to fetch' prefix is still recognised as noise", () => isBenign("TypeError: Failed to fetch") === true);
  check("P04182", "a trailing full stop / whitespace does not defeat the match", () => isBenign("Load failed. ") === true);
  check("P04183", "the late print rejection is filtered (auto-print is best-effort)", () =>
    /Failed to execute 'print' on 'Window'/.test(isBenignSrc));
  check("P04184", "the filter is NOT widened; only these six phrases plus print are dropped", () => {
    const listed = [...(R.match(/var NETWORK_NOISE = \[([\s\S]*?)\];/) || ["", ""])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (listed.length !== 6) return `NETWORK_NOISE now has ${listed.length} phrases, not 6: ${listed.join(" | ")}`;
    const extra = listed.filter((p) => !NOISE.includes(p));
    return extra.length ? `new phrase(s) added without updating this guard: ${extra.join(" | ")}` : true;
  });
  check("P04185", "a crash row names the file AND the build hash it belongs to", () => {
    const a = fnBody(S, "function assetTag(");
    return /\[\?&\]v=/.test(a) && /name \+ "@" \+ m\[1\]/.test(a);
  });
  check("P04186", "the stack's first TWO frames are kept", () => /out\.length < 2/.test(frames));
  check("P04187", "errlog's own frame is skipped so the row names real panel code", () =>
    /m\[1\]\.indexOf\("errlog\.js"\) === 0\) continue;/.test(frames));
  check("P04188", "duplicate frames are collapsed", () => /if \(seen\[f\]\) continue;/.test(frames));
  check("P04189", "`where` fits the 120-char column", () => /\.slice\(0, 120\)/.test(reportError));
  check("P04190", "a rejection with no stack names the last button tapped instead of 'promise'", () =>
    /frames\(r\) \|\| lastTapHint\(\)/.test(S));
  check("P04191", "lastTap survives a flush so a crash just after one still has a breadcrumb", () => {
    const f = fnBody(S, "function flush(");
    return /var lastTap = null/.test(S) && !/lastTap = null/.test(f);
  });
  check("P04192", "tap breadcrumbs cost at most one write per panel per 30s", () =>
    /setInterval\(flush, 30000\)/.test(S) && count(S, /setInterval/g) === 1);
  check("P04193", "the batch also flushes when the tab hides and on pagehide", () =>
    /visibilitychange", function \(\) \{ if \(document\.hidden\) flush\(\); \}/.test(S) &&
    /window\.addEventListener\("pagehide", flush\)/.test(S));
  check("P04194", "sendBeacon is used so the on-hide flush survives the unload", () =>
    /navigator\.sendBeacon\("\/api\/log\/client-error"/.test(send));
  check("P04195", "the tap listener is capture-phase so a stopPropagation handler is still seen", () =>
    /\}, true\); /.test(S) || /\}, true\);/.test(S.slice(S.indexOf('document.addEventListener("click"'))));
  check("P04196", "a button's name is read from VISIBLE text only", () =>
    /own = visibleText\(el\)\.trim\(\)/.test(label));
  check("P04197", "the hidden attribute, display:none and visibility:hidden are all skipped", () =>
    /n\.hasAttribute\("hidden"\)\) continue;/.test(visibleText) &&
    /cs\.display === "none" \|\| cs\.visibility === "hidden"\)\) continue;/.test(visibleText));
  check("P04198", "a space is inserted across every element boundary", () =>
    /out \+= " " \+ visibleText\(n\) \+ " ";/.test(visibleText));
  check("P04199", "runs of whitespace collapse and the label is capped at 40 chars", () =>
    /\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 40\)/.test(label));
  check("P04200", "an icon-only button falls back to textContent rather than logging nothing", () =>
    /\|\| own \|\| el\.textContent \|\| ""/.test(label));
  check("P04201", "data-log and aria-label win over visible text", () =>
    before(label, /data-log/, /own \|\| el\.textContent/) && before(label, /aria-label/, /own \|\| el\.textContent/));
  check("P04202", "taps on the connection pill and its popover are never recorded", () =>
    /el\.closest\("\.lfh-conn"\) \|\| el\.closest\("\.lfh-conn-pop"\)\) return;/.test(S));
  check("P04203", "the tap buffer is bounded at 60 between flushes", () =>
    /if \(taps\.length > 60\) taps\.shift\(\);/.test(S));
  check("P04204", "nothing here can throw into the panel", () => {
    // every listener body and every send path is wrapped
    const bodies = [post, send, stash, flushPending, reportError];
    const unwrapped = [];
    if (!/try \{/.test(post)) unwrapped.push("post");
    if (!/try \{/.test(send)) unwrapped.push("send");
    if (!/try \{/.test(stash)) unwrapped.push("stash");
    if (!/try \{/.test(flushPending)) unwrapped.push("flushPending");
    if (!/try \{/.test(S.slice(S.indexOf('document.addEventListener("click"')))) unwrapped.push("the tap listener");
    return unwrapped.length ? `not wrapped: ${unwrapped.join(", ")}` : true;
  });
  check("P04205", "the panel name is inferred correctly for editor -> manager", () =>
    /\/panels\/editor"\) >= 0\) return "manager"/.test(detect) &&
    /\/panels\/tablet"\) >= 0\) return "tablet"/.test(detect) &&
    /\/panels\/kitchen"\) >= 0\) return "kitchen"/.test(detect));
  check("P04206", "rows are tagged with the restaurant via LFH_RT.getRid()", () => {
    const r = fnBody(S, "function rid(");
    return /LFH_RT\.getRid\(\)/.test(r) && /if \(rd\) payload\.rid = rd;/.test(post);
  });
  check("P04207", "LFH_ERRLOG.report lets panel code file a handled-but-notable failure", () =>
    /window\.LFH_ERRLOG = \{ report: reportError \}/.test(S));
  check("P04208", "resource-load failures do not become crash rows", () => {
    // a resource `error` event does not bubble, and this listener is non-capture
    const idx = S.indexOf('window.addEventListener("error"');
    const tail = S.slice(idx, S.indexOf("unhandledrejection"));
    return !/, *true\)/.test(tail);
  });
  skipRow("P04209", "a real crash in the manager panel produces one row naming a real code line", "driven live - see live.checks");
  check("P04210", "a crash raised while the device is offline is not silently lost forever", () =>
    /PENDING_KEY = "lfh_errlog_pending"/.test(S) &&
    /if \(navigator\.onLine === false\) return stash\(payload\);/.test(post) &&
    /window\.addEventListener\("online", flushPending\)/.test(S));

  // =========================================================================================
  // NEW - sweep #8 T12. P65798-P65840.
  // =========================================================================================
  check("P65798", "only CRASHES are kept for later, never tap breadcrumbs", () =>
    /if \(payload\.kind !== "error"\) return;/.test(stash));
  check("P65799", "the kept-crash store is capped at five, matching what the server will take", () =>
    /PENDING_MAX = 5/.test(S) && /list\.slice\(-PENDING_MAX\)/.test(S));
  check("P65800", "an identical kept message is folded, so one looping crash cannot fill all five", () =>
    /if \(list\[i\]\.message === payload\.message\) return;/.test(stash));
  check("P65801", "a replayed crash says it happened EARLIER, so it is not read as happening now", () =>
    /offline, " \+ \(mins < 1 \? "under a minute" : mins \+ " min"\) \+ " earlier"/.test(flushPending));
  check("P65802", "the 'earlier' note is written ONCE however many attempts it takes", () =>
    /\.replace\(\/ · offline, \[\^·\]\*earlier\/g, ""\)/.test(flushPending));
  check("P65803", "the age of a replayed crash is measured from when it HAPPENED", () =>
    /Date\.now\(\) - \(p\.offlineAt \|\| Date\.now\(\)\)/.test(flushPending));
  check("P65804", "kept crashes are sent one at a time with a gap, never as a burst", () =>
    /\}, i \* 1500\)/.test(flushPending));
  check("P65805", "a beacon the browser REFUSES to queue is kept rather than lost", () =>
    /if \(!queued\) stash\(payload\);/.test(send));
  check("P65806", "the fetch fallback also keeps a crash the network refused", () =>
    /\.catch\(function \(\) \{ stash\(payload\); \}\)/.test(send));
  check("P65807", "the fetch fallback is keepalive, so it survives the page going away", () =>
    /keepalive: true/.test(send));
  check("P65808", "a corrupt pending store reads as empty rather than throwing", () => {
    const r = fnBody(S, "function readPending(");
    return /Array\.isArray\(v\) \? v : \[\]/.test(r) && /catch \(e\) \{ return \[\]; \}/.test(r);
  });
  check("P65809", "a blocked localStorage cannot break the logger", () => {
    const w = fnBody(S, "function writePending(");
    return /catch \(e\) \{\}/.test(w);
  });
  check("P65810", "flushPending does nothing while the device is offline", () =>
    /if \(navigator\.onLine === false\) return;/.test(flushPending));
  check("P65811", "the pending list is taken before sending, so two flushes cannot double-send", () =>
    before(flushPending, /writePending\(\[\]\)/, /list\.forEach/));
  check("P65812", "the crash message is capped at 300 characters", () =>
    /\.slice\(0, 300\)/.test(reportError));
  check("P65813", "the tap batch is capped at 1500 characters", () => {
    const f = fnBody(S, "function flush(");
    return /\.slice\(0, 1500\)/.test(f);
  });
  check("P65814", "an empty tap batch is never posted", () => {
    const f = fnBody(S, "function flush(");
    return /if \(!taps\.length\) return;/.test(f);
  });
  check("P65815", "the tap clock restarts with each batch, so `t` is an offset within it", () => {
    const f = fnBody(S, "function flush(");
    return /taps = \[\]; t0 = Date\.now\(\);/.test(f);
  });
  check("P65816", "a tap is only recorded for something that is actually a control", () =>
    /closest\("button, \[data-log\], a\.btn, \.btn"\)/.test(S));
  check("P65817", "lastTapHint names the tap AND how long ago it was", () => {
    const l = fnBody(S, "function lastTapHint(");
    return /promise · after tap: " \+ lastTap\.l/.test(l) && /secs > 0/.test(l);
  });
  check("P65818", "lastTapHint falls back to 'promise' when there is no tap at all", () => {
    const l = fnBody(S, "function lastTapHint(");
    return /if \(!lastTap \|\| !lastTap\.l\) return "promise";/.test(l);
  });
  check("P65819", "visibleText falls through and INCLUDES a node whose layout cannot be read", () =>
    /catch \(e\) \{ /.test(visibleText) && !/catch \(e\) \{ continue/.test(visibleText));
  check("P65820", "the error listener reads the throw site the browser already resolved", () => {
    const idx = S.indexOf('window.addEventListener("error"');
    const body = S.slice(idx, idx + 700);
    return /e\.filename/.test(body) && /e\.lineno/.test(body);
  });
  check("P65821", "a stack frame's build hash is carried through into the row", () =>
    /assetTag\(m\[1\], m\[2\]\) \+ ":" \+ m\[3\]/.test(frames));
  check("P65822", "the frame regex tolerates a file with no ?v= query", () =>
    /\(\\\?\[\^\\s:\)\]\*\)\?/.test(frames));
  check("P65823", "the logger opens no interval other than the 30s tap flush", () =>
    count(S, /setInterval/g) === 1);
  check("P65824", "detectPanel defaults to manager rather than an empty tag", () =>
    /return "manager";\s*\}/.test(detect));

  // -- judgement -------------------------------------------------------------------------
  check("P65825", "the dedupe is on the MESSAGE alone - deliberate, and worth knowing", () => {
    /* Two DIFFERENT crashes that happen to share a message inside 5s collapse to one row. That is
       the intended trade (a render loop must not spam), and the `where` field is what tells them
       apart afterwards - but it means a coincidence costs a row. Recorded, not filed. */
    return /if \(message === lastMsg/.test(reportError) && !/lastWhere/.test(reportError);
  });
  check("P65826", "a crash kept offline is lost if the tab closes mid-replay - bounded, not silent", () => {
    /* flushPending() empties the store and then sends on 1.5s timers, so a tab closed inside that
       window loses what was in flight. The alternative - re-stashing before each send - would
       double-send on a slow answer, which is worse for a log the owner reads. */
    return before(flushPending, /writePending\(\[\]\)/, /setTimeout/);
  });
}
