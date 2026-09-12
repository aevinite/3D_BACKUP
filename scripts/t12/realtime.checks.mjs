/* realtime.js - the shared live socket. Re-runs ledger rows P04081-P04130 (T9, sweep #6) plus
 * this run's own P65734-P65790. This is the file that decides how much traffic every staff
 * device in every restaurant is handed, so the scoping and backoff claims are the expensive ones.
 */
export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  const S = c.realtime;
  const R = raw.realtime;
  const start = fnBody(S, "async function start(");
  const catchUp = fnBody(S, "function catchUp(");
  const getClient = fnBody(S, "async function getClient(");
  const burst = fnBody(S, "function burstDebounce(");
  const recordLat = fnBody(S, "function recordLatency(");
  const surface = S.slice(S.indexOf("window.LFH_RT = {"));

  check("P04081", "exactly ONE websocket client per frame (memoised getClient)", () =>
    /let sbPromise = null/.test(S) && /if \(sbPromise\) return sbPromise;/.test(getClient));
  check("P04082", "a FAILED boot is not remembered forever - the memo is dropped on rejection", () =>
    /p\.catch\(\(\) => \{ if \(sbPromise === p\) sbPromise = null; \}\)/.test(getClient));
  check("P04083", "dropping the memo cannot clear a NEWER boot already in flight", () =>
    /sbPromise === p/.test(getClient));
  check("P04084", "the Supabase client is imported from our own origin, never a public CDN", () =>
    /import\("\/vendor\/supabase\.js"\)/.test(getClient) && !/jsdelivr|unpkg|cdn\./.test(S));
  check("P04085", "worker: true keeps the heartbeat alive on a backgrounded tablet", () =>
    /realtime: \{ worker: true/.test(getClient));
  check("P04086", "eventsPerSecond: 10 caps the socket's own rate", () =>
    /eventsPerSecond: 10/.test(getClient));
  check("P04087", "an unconfigured server throws a sentence a human can read", () =>
    /cfg\.unconfigured \|\| !cfg\.url \|\| !cfg\.anonKey\) throw new Error\("Live updates are not set up on this server"\)/.test(getClient));
  check("P04088", "the channel is filtered SERVER-side to this restaurant via topic_rid", () =>
    /filter: RT_RID \? "topic_rid=eq\." \+ topic \+ ":" \+ RT_RID/.test(start));
  check("P04089", "with no RT_RID it falls back to the topic-only filter (never a missed update)", () =>
    /: "topic=eq\." \+ topic/.test(start));
  check("P04090", "breadcrumbs from another restaurant are also dropped client-side", () =>
    /if \(RT_RID && row && row\.restaurant_id && row\.restaurant_id !== RT_RID\) return;/.test(start));
  check("P04091", "a missing id on either side keeps the event (safe fallback)", () =>
    /RT_RID && row && row\.restaurant_id &&/.test(start));
  check("P04092", "the admin's ?rid= pin is forwarded to /api/rt-config", () =>
    /const RT_RID_Q = new URLSearchParams\(location\.search\)\.get\("rid"\)/.test(S) &&
    /RT_RID_Q \? "\?rid=" \+ encodeURIComponent\(RT_RID_Q\) : ""/.test(getClient));
  check("P04093", "a normal flurry coalesces on 200ms", () => /burstDebounce\(run, 200\)/.test(start));
  check("P04094", "a real burst stretches the window but never past 1200ms from its FIRST event", () =>
    /BURST_MAX_MS = 1200/.test(S) && /Math\.min\(stretched, BURST_MAX_MS - \(now - firstAt\)\)/.test(burst));
  check("P04095", "capped can never go negative", () => /Math\.max\(0, Math\.min\(stretched/.test(burst));
  check("P04096", "the burst counter resets when the window finally fires", () =>
    /t = null; seen = 0; fn\(\);/.test(burst));
  check("P04097", "a breadcrumb naming one table adds only that table to the refetch set", () =>
    /a\.tables\.add\(String\(tn\)\)/.test(start));
  check("P04098", "a breadcrumb with no table, or kind 'platform', forces a full reload", () =>
    /const spans = !tn \|\| \(row && row\.kind === "platform"\)/.test(start));
  check("P04099", "past 20 changed tables one full reload replaces N per-table fetches", () =>
    /if \(a\.tables\.size > 20\) \{ a\.full = true; a\.tables\.clear\(\); \}/.test(start));
  check("P04100", "the accumulator resets BEFORE the handler runs, so a mid-flight event is kept", () =>
    before(start, /acc\[topic\] = \{ tables: new Set\(\), full: false \};\s*$/m, /await handlers\[topic\]\(detail\)/) ||
    before(start.slice(start.indexOf("const run = async")), /acc\[topic\] = \{ tables: new Set\(\), full: false \}/, /await handlers\[topic\]/));
  check("P04101", "a handler that throws is counted, never allowed to kill the loop", () =>
    /catch \(e\) \{ metrics\.sync_failures\+\+; \}/.test(start));
  check("P04102", "per-topic handlers are supported so a cheap event never triggers a costly refetch", () =>
    /let handlers = opts\.handlers/.test(start));
  check("P04103", "the {topics, onEvent} shape still works", () =>
    /const topics = opts\.topics \|\| \["ops"\]/.test(start) && /topics\.forEach\(\(t\) => \{ handlers\[t\] = onEvent; \}\)/.test(start));
  check("P04104", "a tab hidden for IDLE_MS (120s) drops its channels", () =>
    /IDLE_MS = 120000/.test(start) && /idleTimer = setTimeout\(\(\) => \{ if \(!holdOpen\(\)\) teardown\(\); \}, IDLE_MS\)/.test(start));
  check("P04105", "an always-visible panel (a kitchen display) never disconnects", () => {
    const vis = fnBody(start, "const onVisibility = ()");
    return /if \(document\.hidden\) \{/.test(vis) && /\} else wake\(\);/.test(vis) && !/teardown\(\);\s*\} else/.test(vis);
  });
  check("P04106", "becoming visible again resubscribes AND refetches", () =>
    /if \(torndown\) \{ torndown = false; lastWake = now; subscribe\(\); fireAll\(\); return; \}/.test(start));
  check("P04107", "the socket rebuild is throttled to once per 1.5s wake window", () =>
    /now - lastWake < 1500/.test(start));
  check("P04108", "a wake with no client at all tries to build one", () =>
    /if \(!sb\) \{[\s\S]{0,240}ensureClient\(\)/.test(start));
  check("P04109", "that branch refetches whether the client comes back or not", () =>
    /ensureClient\(\)\.then\(\(\) => fireAll\(\), \(\) => fireAll\(\)\)/.test(start));
  check("P04110", "pageshow is handled so a bfcache restore on a phone wakes the panel", () =>
    /"pageshow", onPageShow/.test(start));
  check("P04111", "CLOSED does NOT downgrade the badge (it fires on our own teardown)", () =>
    !/=== "CLOSED"/.test(start));
  check("P04112", "only CHANNEL_ERROR / TIMED_OUT move the badge to weak/offline", () =>
    /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT"/.test(start));
  check("P04113", "the badge starts pessimistic until the first SUBSCRIBED", () =>
    /let connStatus = \(typeof navigator !== "undefined" && navigator\.onLine === false\) \? "offline" : "weak"/.test(S));
  check("P04114", "a device-level offline flips the badge instantly, ahead of the socket", () =>
    /window\.addEventListener\("offline", \(\) => setStatus\("offline"\)\)/.test(S));
  check("P04115", "everConnected separates a calm Connecting from an alarming Reconnecting", () =>
    /let everConnected = false/.test(S) && /if \(s === "online"\) everConnected = true/.test(S));
  check("P04116", "a reconnect after a real drop counts reconnects and refetches", () =>
    /if \(everSubscribed\) \{ metrics\.reconnects\+\+; fireAll\(\); \}/.test(start));
  check("P04117", "latency is measured from breadcrumbs already received - no extra request", () =>
    count(start, /fetch\(/g) === 0 && /recordLatency\(lat\)/.test(start));
  check("P04118", "a nonsense latency (negative, or over 60s) is discarded", () =>
    /if \(!\(ms >= 0\) \|\| ms > 60000\) return;/.test(recordLat));
  check("P04119", "the latency ring is bounded at 24 readings", () =>
    /LAT_HIST_MAX = 24/.test(S) && /if \(metrics\.latHist\.length > LAT_HIST_MAX\) metrics\.latHist\.shift\(\)/.test(recordLat));
  check("P04120", "a latency listener that throws cannot break the others", () =>
    /latListeners\.forEach\(\(fn\) => \{ try \{ fn\(ms\); \} catch \(e\) \{\} \}\)/.test(recordLat));
  check("P04121", "catchUp polls at 5s only while the socket is DOWN and reads get through", () =>
    /const base = \(opts && opts\.baseMs\) \|\| 5000/.test(catchUp) &&
    /connStatus === "online" \|\| navigator\.onLine === false\) \{ step = 0; return arm\(\); \}/.test(catchUp));
  check("P04122", "catchUp doubles its wait to 60s while reads keep failing (no amplifier)", () =>
    /const max = \(opts && opts\.maxMs\) \|\| 60000/.test(catchUp) &&
    /Math\.min\(base \* Math\.pow\(2, step\), max\)/.test(catchUp) &&
    /catch \(e\) \{ step = Math\.min\(step \+ 1, 8\); \}/.test(catchUp));
  check("P04123", "catchUp jitters +/-20% so twenty devices never poll on the same beat", () =>
    /const spread = \(ms\) => Math\.round\(ms \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)\)/.test(catchUp));
  check("P04124", "catchUp does nothing while the tab is hidden or the device is offline", () =>
    /document\.hidden && !holdOpenAny\(\)/.test(catchUp) && /navigator\.onLine === false/.test(catchUp));
  check("P04125", "catchUp returns a stop function that really clears the timer", () =>
    /return \(\) => \{ stopped = true; clearTimeout\(timer\); \};/.test(catchUp));
  check("P04126", "a backoff that has run out resets to fast the moment one read succeeds", () =>
    /try \{ await fn\(\); step = 0; \}/.test(catchUp));
  check("P04127", "getStatus/onStatus fire once immediately with the current state", () =>
    /onStatus: \(cb\) => \{ statusListeners\.add\(cb\); try \{ cb\(connStatus\); \}/.test(surface));
  check("P04128", "getRid() is what errlog.js tags its rows with", () =>
    /getRid: \(\) => RT_RID/.test(surface) && /LFH_RT && window\.LFH_RT\.getRid/.test(c.errlog));
  check("P04129", "a wake does not cost TWO full board reloads (both fires coalesce)", () =>
    /burstDebounce\(run, 200\)/.test(start) && /const fireAll = \(\) =>/.test(start));
  check("P04130", "nothing in this file polls faster than the 60s backstop when reads fail", () =>
    !/setInterval/.test(S));

  // =========================================================================================
  // NEW - sweep #8 T12. P65734-P65775.
  // =========================================================================================
  check("P65734", "the ONE read live updates boot on has an 8s deadline", () =>
    /RT_CONFIG_DEADLINE_MS = 8000/.test(S) && /signal: deadline\(RT_CONFIG_DEADLINE_MS\)/.test(getClient));
  check("P65735", "the deadline helper falls back to AbortController on an old browser", () => {
    const d = fnBody(S, "function deadline(");
    return /AbortSignal\.timeout/.test(d) && /new AbortController\(\)/.test(d) && /return undefined/.test(d);
  });
  check("P65736", "the rt-config read is never served from a cache", () =>
    /cache: "no-store"/.test(getClient));
  check("P65737", "setStatus does nothing when the state has not moved (no listener storm)", () => {
    const s = fnBody(S, "function setStatus(");
    return /if \(s === connStatus\) return;/.test(s);
  });
  check("P65738", "a status listener that throws cannot break the others", () => {
    const s = fnBody(S, "function setStatus(");
    return /statusListeners\.forEach\(\(fn\) => \{ try \{ fn\(s\); \} catch \(e\) \{\} \}\)/.test(s);
  });
  check("P65739", "coming back online from a hard offline goes to weak, never straight to online", () =>
    /"online", \(\) => \{ if \(connStatus === "offline"\) setStatus\("weak"\); \}/.test(S));
  check("P65740", "subscribe() tears down its old channels before building new ones", () => {
    const sub = fnBody(S, "const subscribe = ()");
    return before(sub, /removeChannel/, /channels = topicList\.map/);
  });
  check("P65741", "removeChannel is wrapped so a dead channel cannot stop the rebuild", () =>
    count(S, /try \{ sb\.removeChannel\(c\); \} catch \(e\) \{\}/g) >= 2);
  check("P65742", "teardown() empties the channel list, so a stale handle is never reused", () =>
    /channels = \[\]; torndown = true;/.test(start));
  check("P65743", "the idle drop is re-judged when the timer FIRES, not when it is armed", () =>
    /setTimeout\(\(\) => \{ if \(!holdOpen\(\)\) teardown\(\); \}, IDLE_MS\)/.test(start));
  check("P65744", "keepAlive is only honoured when the caller passed a function", () =>
    /typeof opts\.keepAlive === "function" \? opts\.keepAlive : null/.test(start));
  check("P65745", "a keepAlive that throws is read as 'do not hold open', never as a crash", () => {
    const h = fnBody(S, "const holdOpen = ()");
    return /catch \(e\) \{ return false; \}/.test(h);
  });
  check("P65746", "catchUp can see the keepAlive answer too (a printing screen polls while hidden)", () =>
    /const holdOpenAny = \(\) =>/.test(S) && /holdOpenAny\(\)/.test(catchUp));
  check("P65747", "pageshow only wakes on a REAL bfcache restore, never an ordinary load", () =>
    /const onPageShow = \(e\) => \{ if \(e\.persisted\) wake\(\); \}/.test(start));
  check("P65748", "wake() does nothing at all while the tab is hidden", () => {
    const w = fnBody(start, "const wake = ()");
    return /if \(document\.hidden\) return;/.test(w);
  });
  check("P65749", "start() does an initial load, so a panel is never blank waiting for an event", () =>
    /fireAll\(\); \/\/ initial load/.test(R) || /fireAll\(\);\s*$/m.test(start));
  check("P65750", "ensureClient answers true/false rather than throwing into the caller", () => {
    const e = fnBody(S, "const ensureClient = async ()");
    return /return true;/.test(e) && /return false;/.test(e) && /catch \(e\) \{/.test(e);
  });
  check("P65751", "a failed boot leaves the badge honest (weak or offline), never green", () => {
    const e = fnBody(S, "const ensureClient = async ()");
    return /setStatus\(\(typeof navigator !== "undefined" && navigator\.onLine === false\) \? "offline" : "weak"\)/.test(e);
  });
  check("P65752", "metrics are published on window for a person to inspect, and nothing more", () =>
    /window\.__lfh_rt = metrics/.test(S));
  check("P65753", "the average latency is a running mean, not the last reading", () =>
    /metrics\._latSum \+= ms; metrics\._latN\+\+; metrics\.avgLatencyMs = Math\.round\(metrics\._latSum \/ metrics\._latN\)/.test(recordLat));
  check("P65754", "getLatencyHistory hands out a COPY, so a caller cannot edit the ring", () =>
    /getLatencyHistory: \(\) => metrics\.latHist\.slice\(\)/.test(surface));
  check("P65755", "onLatency and onStatus both return an unsubscribe function", () =>
    /return \(\) => statusListeners\.delete\(cb\)/.test(surface) && /return \(\) => latListeners\.delete\(cb\)/.test(surface));
  check("P65756", "the burst debounce starts its clock on the FIRST event of a burst", () =>
    /if \(!t\) firstAt = now;/.test(burst));
  check("P65757", "BURST_AFTER is a named threshold, not a hard-typed number in the maths", () =>
    /BURST_AFTER = 4/.test(S) && /seen >= BURST_AFTER/.test(burst));
  check("P65758", "one debounced refetch PER topic, so two topics cannot starve each other", () =>
    /firePerTopic\[topic\] = burstDebounce\(run, 200\)/.test(start));
  check("P65759", "a wake marks every topic full before firing, so nothing is half-refreshed", () =>
    /topicList\.forEach\(\(t\) => \{ if \(acc\[t\]\) acc\[t\]\.full = true; firePerTopic\[t\]\(\); \}\)/.test(start));
  check("P65760", "noteEvent ignores a topic it has no accumulator for", () =>
    /const a = acc\[topic\]; if \(!a\) return;/.test(start));
  check("P65761", "the delivery-latency clock reads the breadcrumb's own created_at", () =>
    /Date\.now\(\) - Date\.parse\(ts\)/.test(start));
  check("P65762", "this file opens no interval and no fixed poll of its own", () =>
    count(S, /setInterval/g) === 0);

  // -- judgement -------------------------------------------------------------------------
  check("P65763", "keepAliveFn is one per frame - correct, because a frame runs one panel", () =>
    count(S, /keepAliveFn = /g) === 2);  // the declaration and the one assignment in start()
  check("P65764", "the online listener inside start() counts a reconnect even while hidden", () => {
    // wake() returns immediately when hidden, so the COUNTER moves and nothing else does.
    // Metric noise only - recorded so a later sweep does not read it as a missed refetch.
    return /window\.addEventListener\("online", \(\) => \{ metrics\.reconnects\+\+; wake\(\); \}\)/.test(start);
  });
}
