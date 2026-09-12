/* outbox.js - the staff write queue. Re-runs ledger rows P04001-P04080 (T9, sweep #6) and adds
 * this run's own rows. Every staff write in the manager, kitchen and waiter panels goes through
 * send() here, so a claim that has quietly stopped being true costs somebody's order.
 */
export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  const S = c.outbox;            // comments stripped
  const R = raw.outbox;          // the real file, comments and all
  const send = fnBody(S, "async function send(");
  const flush = fnBody(S, "async function flush(");
  const enqueue = fnBody(S, "async function enqueue(");
  const sched = fnBody(S, "function scheduleRetry(");
  const boot = fnBody(S, "async function boot(");
  const doFetch = fnBody(S, "function doFetch(");
  const wake = fnBody(S, "function wake(");
  const surface = S.slice(S.indexOf("window.LFH_OUTBOX = {"));

  // -- the api() contract ------------------------------------------------------------------
  check("P04001", "send() returns the parsed JSON on an online 2xx", () =>
    /const j = await res\.json\(\)/.test(send) && /return j;/.test(send));
  check("P04002", "send() throws on a non-2xx, carrying .status and .data", () =>
    /if \(!res\.ok\)/.test(send) && /e\.status = res\.status/.test(send) && /e\.data = j/.test(send));
  check("P04003", "send() keeps the change BEFORE leaving for /login on a 401", () => {
    const m = send.match(/res\.status === 401\)[^\n]*/);
    if (!m) return "no 401 branch in send()";
    return /enqueue\(item, *"signedout"\)/.test(m[0]) && before(m[0], /enqueue/, /leaveTo|location/);
  });
  check("P04004", "only a genuine network failure diverts into the queue on the live path", () =>
    /catch \(netErr\) \{/.test(send) && /enqueue\(item, why\)/.test(send));
  check("P04005", "every request carries X-LFH-Action-Id = the item's uuid", () =>
    /"X-LFH-Action-Id": item\.id/.test(doFetch));
  check("P04006", "every request carries X-LFH-Queued-At as an ISO string", () =>
    /"X-LFH-Queued-At": new Date\(item\.at \|\| Date\.now\(\)\)\.toISOString\(\)/.test(doFetch));
  check("P04007", "a replay is marked X-LFH-Replay: 1; a live write is not", () =>
    /if \(replay\) headers\["X-LFH-Replay"\] = "1"/.test(doFetch));
  check("P04008", "X-LFH-Expect is sent on LIVE writes too, not only replays", () =>
    before(doFetch, /X-LFH-Expect/, /if \(replay\)/));
  check("P04009", "every write has a 15s deadline", () =>
    /WRITE_TIMEOUT_MS = 15000/.test(S) && /signal: writeDeadline\(\)/.test(doFetch));
  check("P04010", "reading AbortSignal.timeout is wrapped so an old tablet cannot kill the write", () => {
    const wd = fnBody(S, "function writeDeadline(");
    return /try \{/.test(wd) && /catch \(e\) \{ return undefined; \}/.test(wd);
  });
  check("P04011", "5xx on the FIRST attempt queues instead of throwing", () =>
    /if \(res\.status >= 500\) \{/.test(send) && /enqueue\(item, *"busy"\)/.test(send));
  check("P04012", "4xx on the first attempt is NOT queued - the person is told", () =>
    before(send, /res\.status >= 500/, /if \(!res\.ok\)/));
  check("P04013", "navigator.onLine === false queues without touching the network", () =>
    before(send, /navigator\.onLine === false/, /doFetch\(item\)/));
  check("P04014", "a queued item reaches IndexedDB before send() resolves", () =>
    /const persisted = await idbPut\(item\)/.test(enqueue));
  check("P04015", "idbWrite awaits the TRANSACTION completing, not just the request", () => {
    const w = fnBody(S, "function idbWrite(");
    return /tx\.oncomplete = \(\) => resolve\(true\)/.test(w);
  });
  check("P04016", "a storage failure resolves FALSE and is not swallowed as success", () => {
    const w = fnBody(S, "function idbWrite(");
    return /\.catch\(\(\) => false\)/.test(w);
  });
  check("P04017", "a storage failure raises the sticky unsafeStore flag for the page", () =>
    /if \(!persisted\) unsafeStore = true/.test(enqueue));
  check("P04018", "storageFailed() is exposed so a bar can stop promising 'syncing automatically'", () =>
    /storageFailed: \(\) => unsafeStore/.test(surface));
  check("P04019", "enqueue() always leaves a timer behind", () => /ensureRetry\(\);/.test(enqueue));
  check("P04020", "ensureRetry() does nothing while a flush is running", () => {
    const e = fnBody(S, "function ensureRetry(");
    return /if \(flushing\) return;/.test(e) && /if \(retryTimer\) return;/.test(e) && /if \(!queued\.length\) return;/.test(e);
  });
  check("P04021", "flush() never runs twice concurrently", () => /if \(flushing\) return;/.test(flush));
  check("P04022", "an empty queue clears the retry timer and resets the backoff step", () =>
    /!queued\.length\) \{ clearTimeout\(retryTimer\); retryTimer = null; retryStep = 0; return; \}/.test(flush));
  check("P04023", "a flush that finds the device offline still LEAVES A TIMER", () =>
    /navigator\.onLine === false\) \{ scheduleRetry\(false\); return; \}/.test(flush));
  check("P04024", "the retry wait backs off 5s -> 15s -> ... -> 120s and caps there", () =>
    /RETRY_FIRST_MS = 5000/.test(S) && /RETRY_BASE_MS = 15000/.test(S) && /RETRY_MAX_MS = 120000/.test(S) &&
    /Math\.min\(RETRY_BASE_MS \* Math\.pow\(2, retryStep - 1\), RETRY_MAX_MS\)/.test(sched));
  check("P04025", "every device rolls its own +/-25% jitter so retries never pulse together", () =>
    /base \* \(0\.75 \+ Math\.random\(\) \* 0\.5\)/.test(sched));
  check("P04026", "retryStep is capped at 8 so the exponent cannot run away", () =>
    /retryStep = Math\.min\(retryStep \+ 1, 8\)/.test(sched));
  check("P04027", "a round that delivered something resets the backoff to fast", () =>
    /if \(progressed\) retryStep = 0/.test(sched));
  check("P04028", "a timer is scheduled even while the browser reports offline", () =>
    !/navigator\.onLine === false\) return/.test(sched));
  check("P04029", "ordering is enforced per TABLE, not across the whole device", () =>
    /function orderKey\(it\) \{ const t = tableOf\(it\); return t == null \? UNTABLED : String\(t\); \}/.test(S));
  check("P04030", "work that cannot be tied to a table shares ONE strictly-ordered bucket", () =>
    /const UNTABLED = "\\u0000untabled"/.test(S));
  check("P04031", "a new write for a table with anything already owed is appended, not sent ahead", () =>
    /if \(queued\.some\(owed\) \|\| failed\.some\(/.test(send) && /enqueue\(item, "behind"\)/.test(send));
  check("P04032", "a RETRYABLE failed row still blocks a later write to the same table", () =>
    /failed\.some\(function \(f\) \{ return f\.retryable !== false && owed\(f\); \}\)/.test(send));
  check("P04033", "a non-retryable (clash) failed row does NOT block later work on that table", () =>
    /f\.retryable !== false/.test(send));   // the same predicate: false ones are excluded
  check("P04034", "the flush walk does not stop at the first obstacle - other tables carry on", () =>
    /const stalled = new Set\(\)/.test(flush) && /stalled\.add\(key\); i\+\+; continue;/.test(flush));
  check("P04035", "a stalled table's LATER items are skipped in the same round", () =>
    /if \(stalled\.has\(key\)\) \{ i\+\+; continue; \}/.test(flush));
  check("P04036", "stalled is per round, not persistent", () =>
    /const stalled = new Set\(\)/.test(flush) && !/^\s*(let|var|const) stalled/m.test(S.replace(flush, "")));
  check("P04037", "i only advances when the item stays in the queue", () => {
    // every moveToFailed / removeItem path must reach a bare `continue`, never `i++; continue`
    const bad = /await moveToFailed\([^;]*;\s*notify\(\); i\+\+;/.test(flush);
    return !bad && /await removeItem\(item\.id\); notify\(\); continue;/.test(flush);
  });
  check("P04038", "a genuinely-offline mid-round stops the whole round and keeps everything", () =>
    /if \(navigator\.onLine === false\) break;/.test(flush));
  check("P04039", "an online-but-never-answering write is capped at NET_MAX_TRIES (6)", () =>
    /NET_MAX_TRIES = 6/.test(S) && /item\.netTries < NET_MAX_TRIES/.test(flush));
  check("P04040", "a 401 during replay parks the WHOLE round, device-wide", () =>
    /item\.authTries < AUTH_MAX_TRIES\) \{ await idbPut\(item\); break; \}/.test(flush));
  check("P04041", "a 401 that keeps repeating becomes a person's decision after 3 rounds", () =>
    /AUTH_MAX_TRIES = 3/.test(S));
  check("P04042", "a 200 that says { ok:false, reason } is NOT treated as delivered", () =>
    /if \(j && j\.ok === false\) \{/.test(flush));
  check("P04043", "an ok:false refusal is marked non-retryable (the ground has moved)", () => {
    const okFalse = flush.slice(flush.indexOf("j.ok === false"));
    return /retryable: false/.test(okFalse.slice(0, 700));
  });
  skipRow("P04044", "every reason code the table-ops functions answer with has a sentence in REASONS",
    "cross-checked separately against supabase/migrations - see cross.checks.mjs P04044b");
  check("P04045", "REASONS are English literals, not routed through lib/i18n.ts", () =>
    !/i18n/.test(S) && /const REASONS = \{/.test(S));
  check("P04046", "409 {retry:true} is capped at BUSY_MAX_TRIES (6) then handed to a person", () =>
    /BUSY_MAX_TRIES = 6/.test(S) && /item\.busyTries < BUSY_MAX_TRIES/.test(flush));
  check("P04047", "409 without retry is a clash: the server's own plain sentence is kept", () =>
    /\(j && j\.clash && j\.clash\.plain\)/.test(flush));
  check("P04048", "5xx during replay is capped at SERVER_MAX_TRIES (6), matching the guest queue", () =>
    /SERVER_MAX_TRIES = 6/.test(S) && /item\.tries < SERVER_MAX_TRIES/.test(flush));
  check("P04049", "the four ceilings are named constants, none hard-typed", () =>
    /AUTH_MAX_TRIES = 3/.test(S) && /BUSY_MAX_TRIES = 6/.test(S) &&
    /NET_MAX_TRIES = 6/.test(S) && /SERVER_MAX_TRIES = 6/.test(S) &&
    !/Tries < [0-9]/.test(flush));
  check("P04050", "any other 4xx surfaces instead of vanishing", () => {
    const tail = flush.slice(flush.lastIndexOf("res.status >= 500"));
    return /await moveToFailed\(item, \(j && j\.error\) \|\| \("Sync failed \("/.test(tail);
  });
  check("P04051", "nothing is ever deleted on failure - it moves to failed, never away", () => {
    const m = fnBody(S, "async function moveToFailed(");
    return /failed\.push\(item\)/.test(m) && /await idbPut\(item\)/.test(m) && !/idbDel/.test(m);
  });
  check("P04052", "the device ceiling is MAX_QUEUED 200 and the OLDEST is set aside", () =>
    /MAX_QUEUED = 200/.test(S) && /while \(queued\.length > MAX_QUEUED\)/.test(enqueue) &&
    /const oldest = queued\[0\]/.test(enqueue));
  check("P04053", "an item set aside for age is non-retryable and says why in plain words", () => {
    const w = enqueue.slice(enqueue.indexOf("while (queued.length > MAX_QUEUED)"));
    return /retryable: false/.test(w) && /plain:/.test(w) && /todo:/.test(w);
  });
  check("P04054", "retryOne() resets EVERY attempt counter, not just tries", () => {
    const r = fnBody(S, "async function retryOne(");
    return /resetTries\(it\)/.test(r);
  });
  check("P04055", "retryFailed() uses the same resetTries so the two entry points cannot drift", () => {
    const r = fnBody(S, "async function retryFailed(");
    return /resetTries\(it\)/.test(r);
  });
  check("P04056", "retryFailed() never re-sends a clash", () => {
    const r = fnBody(S, "async function retryFailed(");
    return /x\.retryable !== false/.test(r);
  });
  check("P04057", "a retried change goes back in its ORIGINAL place, not at the end", () => {
    const one = fnBody(S, "async function retryOne(");
    const all = fnBody(S, "async function retryFailed(");
    return /requeueInOrder\(\)/.test(one) && /requeueInOrder\(\)/.test(all) &&
      /queued\.sort\(function \(a, b\) \{ return \(a\.at \|\| 0\) - \(b\.at \|\| 0\); \}\)/.test(S);
  });
  check("P04058", "dismiss(id) removes from memory AND from IndexedDB", () => {
    const r = fnBody(S, "async function removeItem(");
    return /queued = queued\.filter/.test(r) && /failed = failed\.filter/.test(r) && /await idbDel\(id\)/.test(r);
  });
  check("P04059", "boot() restores a previous session's queue in `at` order", () =>
    /\.sort\(\(a, b\) => a\.at - b\.at\)/.test(boot));
  check("P04060", "boot() separates failed from queued by stored status", () =>
    /x\.status !== "failed"/.test(boot) && /x\.status === "failed"/.test(boot));
  check("P04061", "coming back to the tab wakes the queue", () =>
    /visibilitychange", \(\) => \{ if \(!document\.hidden\) wake\(\); \}/.test(boot));
  check("P04062", "window focus wakes the queue", () => /"focus", \(\) => wake\(\)/.test(boot));
  check("P04063", "the browser online event forces a wake past the throttle", () =>
    /"online", \(\) => wake\(true\)/.test(boot));
  check("P04064", "realtime reporting online forces a wake", () =>
    /LFH_RT\.onStatus\(\(s\) => \{ if \(s === "online"\) wake\(true\); \}\)/.test(boot));
  check("P04065", "wake() costs nothing on an empty queue", () => /if \(!queued\.length\) return;/.test(wake));
  check("P04066", "wake() is throttled to WAKE_MIN_GAP_MS for non-forced signals", () =>
    /if \(!force && now - lastWakeAt < WAKE_MIN_GAP_MS\) return;/.test(wake));
  check("P04067", "notify() never lets one listener's throw block the others", () => {
    const n = fnBody(S, "function notify(");
    return /listeners\.forEach\(\(fn\) => \{ try \{ fn\(snap\); \} catch \(e\) \{\} \}\)/.test(n);
  });
  check("P04068", "notify() also fires the lfh:outbox-changed DOM event", () =>
    /CustomEvent\("lfh:outbox-changed"/.test(S));
  check("P04069", "the snapshot carries syncing = a round is really in flight", () =>
    /syncing: flushing/.test(S));
  check("P04070", "lfh:outbox-flushed fires after every round so panels refetch true state", () =>
    /CustomEvent\("lfh:outbox-flushed"\)/.test(flush));
  check("P04071", "labelFor reads /api/inventory paths with the inventory vocabulary", () => {
    const l = fnBody(S, "function labelFor(");
    return /base === "\/api\/inventory"/.test(l) && /Save an ingredient/.test(l);
  });
  check("P04072", "a label that already names a table is never doubled", () =>
    /!\/·\\s\*Table\\s\/i\.test\(item\.label\)/.test(send));
  check("P04073", "tableOf prefers the caller's explicit item.table over the path", () => {
    const t = fnBody(S, "function tableOf(");
    return before(t, /item\.table != null/, /item\.path/);
  });
  check("P04074", "item.table is kept OFF the body so a readout cannot change what a write means", () =>
    /table: \(table == null \|\| table === ""\) \? null : String\(table\)/.test(send) &&
    !/body\.table = /.test(S));
  check("P04075", "tablesOf returns BOTH ends of a move so the destination shows the mark too", () => {
    const t = fnBody(S, "function tablesOf(");
    return /const from = tableOf\(item\)/.test(t) && /\(item\.body \|\| \{\}\)\.to/.test(t);
  });
  check("P04076", "pendingByTable counts a move against both tables", () =>
    /pendingByTable: function \(\) \{[\s\S]*?tablesOf\(it\)\.forEach/.test(surface));
  check("P04077", "blockedByTable only counts non-retryable rows", () =>
    /blockedByTable: function \(\) \{[\s\S]*?if \(it\.retryable !== false\) return;/.test(surface));
  check("P04078", "waitingSince() returns the OLDEST waiting timestamp, 0 when empty", () => {
    // The file's own reducer, written out here rather than evaluated out of the source: a guard
    // that runs the code it is judging can only ever agree with it.
    if (!/waitingSince: \(\) => queued\.reduce\(\(a, it\) => \(a && a < it\.at \? a : it\.at\), 0\)/.test(S)) {
      return "waitingSince() is no longer the min-by-`at` reduce this row describes";
    }
    const reduce = (a, it) => (a && a < it.at ? a : it.at);
    return [{ at: 5 }, { at: 2 }].reduce(reduce, 0) === 2 && [].reduce(reduce, 0) === 0;
  });
  check("P04079", "LFH_TEST_PACING is read only from window and nothing in the app sets it", () =>
    /window\.LFH_TEST_PACING/.test(S));
  check("P04080", "__pause/__resume are test-only", () =>
    /__pause: \(\) =>/.test(surface) && /__resume: \(\) =>/.test(surface));

  // =========================================================================================
  // NEW - sweep #8 T12. P65701-P65790.
  // =========================================================================================
  check("P65701", "getSnapshot() and notify()'s snapshot carry the SAME keys", () => {
    const notifySnap = (S.match(/const snap = \{([^}]*)\}/) || [])[1] || "";
    const getSnap = (S.match(/getSnapshot: \(\) => \(\{([^}]*)\}\)/) || [])[1] || "";
    const keys = (s) => s.split(",").map((p) => p.split(":")[0].trim()).filter(Boolean).sort().join(",");
    return keys(notifySnap) && keys(notifySnap) === keys(getSnap)
      ? true
      : `notify() has [${keys(notifySnap)}] and getSnapshot() has [${keys(getSnap)}]`;
  });
  check("P65702", "onChange() hands a new listener a snapshot immediately", () =>
    /onChange: \(cb\) => \{ listeners\.add\(cb\); try \{ cb\(window\.LFH_OUTBOX\.getSnapshot\(\)\) \}/.test(S.replace(/;\s*\}/g, " }")) ||
    /onChange: \(cb\) => \{ listeners\.add\(cb\); try \{ cb\(window\.LFH_OUTBOX\.getSnapshot\(\)\); \}/.test(S));
  check("P65703", "boot() runs whether the document is still loading or already parsed", () =>
    /if \(document\.readyState !== "loading"\) boot\(\);\s*else document\.addEventListener\("DOMContentLoaded", boot\)/.test(S));
  check("P65704", "the queue holds ONE IndexedDB database, opened in one place", () =>
    count(S, /indexedDB\.open/g) === 1);
  check("P65705", "a blocked IndexedDB degrades to memory rather than throwing into the panel", () => {
    const all = fnBody(S, "async function idbAll(");
    return /catch \{ return \[\]; \}/.test(all);
  });
  check("P65706", "send() never sends a body on a request that has none", () =>
    /body: item\.body != null \? JSON\.stringify\(item\.body\) : undefined/.test(doFetch));
  check("P65707", "the 5xx-on-first-attempt answer tells the caller it was BUSY, not offline", () =>
    /return \{ ok: true, queued: true, busy: true,[^}]*why: "busy" \}/.test(send));
  check("P65708", "the queued answer always carries the action id, so a caller can trace it", () =>
    count(send, /action_id: item\.id/g) >= 4);
  check("P65709", "the queued answer says whether the change reached this device's storage", () =>
    count(send, /persisted: p/g) >= 4);
  check("P65710", "a timeout while the browser still says online is called SLOW, never offline", () =>
    /const why = navigator\.onLine === false \? "offline" : "slow"/.test(send));
  check("P65711", "leaveTo() moves the whole window, not the panel's iframe", () => {
    const l = fnBody(S, "function leaveTo(");
    return /window\.top\.location\.replace\(url\)/.test(l) && /window\.location\.replace\(url\)/.test(l);
  });
  check("P65712", "leaveTo() replaces the history entry so Back cannot walk into a dead panel", () => {
    const l = fnBody(S, "function leaveTo(");
    return !/location\.href *=/.test(l);
  });
  check("P65713", "uuid() has a fallback for a browser with no crypto.randomUUID", () =>
    /self\.crypto && self\.crypto\.randomUUID/.test(S) && /xxxxxxxx-xxxx-4xxx-yxxx/.test(S));
  check("P65714", "every REASONS value is a fragment, so it reads inside both sentences", () => {
    const block = (R.match(/const REASONS = \{[\s\S]*?\n  \};/) || [""])[0];
    const vals = [...block.matchAll(/: "([^"]+)"/g)].map((m) => m[1]);
    if (!vals.length) return "no REASONS values found";
    const bad = vals.filter((v) => /^[A-Z]/.test(v) || /\.$/.test(v));
    return bad.length ? `these are sentences, not fragments: ${bad.join(" | ")}` : true;
  });
  check("P65715", "reasonText() answers an empty string for a code it does not know", () =>
    /function reasonText\(code\) \{ return \(code && REASONS\[code\]\) \|\| ""; \}/.test(S));
  check("P65716", "an ok:false refusal with an unknown reason still says something true", () => {
    const b = flush.slice(flush.indexOf("j.ok === false"), flush.indexOf("j.ok === false") + 800);
    return /why \? "It couldn't be applied - "|why \? "It couldn't be applied — "/.test(b) &&
      /: "The system wouldn't accept this change\."/.test(b);
  });
  check("P65717", "the MAX_QUEUED eviction reports the age reason, not a bare drop", () => {
    const w = enqueue.slice(enqueue.indexOf("while (queued.length > MAX_QUEUED)"));
    return /This waited too long to send/.test(w);
  });
  check("P65718", "flush() publishes syncing:true at the START of a round, not only the end", () => {
    const upto = flush.slice(0, flush.indexOf("let progressed"));
    return /flushing = true;[\s\S]*notify\(\);/.test(upto);
  });
  check("P65719", "flush()'s finally always clears flushing, however the walk ended", () =>
    /\} finally \{\s*flushing = false;/.test(flush));
  check("P65720", "flush()'s finally always schedules the next round", () =>
    /finally \{[\s\S]*scheduleRetry\(progressed\);/.test(flush));
  check("P65721", "what is already OWED to a table stalls it before the walk starts", () =>
    /failed\.forEach\(function \(f\) \{ if \(f\.retryable !== false\) stalled\.add\(orderKey\(f\)\); \}\)/.test(flush));
  check("P65722", "the walk stops the moment the device goes offline mid-round", () =>
    /while \(i < queued\.length && navigator\.onLine !== false\)/.test(flush));
  check("P65723", "a 2xx is only 'delivered' after the body has been read", () =>
    before(flush, /if \(res\.ok\) \{/, /progressed = true; await removeItem/));
  check("P65724", "resetTries clears all four counters and the error text", () => {
    const r = fnBody(S, "function resetTries(");
    return /it\.tries = 0/.test(r) && /it\.netTries = 0/.test(r) && /it\.busyTries = 0/.test(r) &&
      /it\.authTries = 0/.test(r) && /it\.error = undefined/.test(r) &&
      /it\.plain = undefined/.test(r) && /it\.todo = undefined/.test(r);
  });
  check("P65725", "pendingForTable answers an empty list for a null table rather than throwing", () =>
    /pendingForTable: function \(t\) \{\s*if \(t == null\) return \[\];/.test(surface));
  check("P65726", "the queue never patches window.fetch (a raw fetch must stay raw)", () =>
    !/window\.fetch *=/.test(S));
  check("P65727", "tableOf reads a table out of the path OR the query string", () => {
    const t = fnBody(S, "function tableOf(");
    return /\\\/tables\\\/\(\[\^\/\?&\]\+\)/.test(t) && /\[\?&\]table=/.test(t);
  });
  check("P65728", "tableOf decodes a percent-escaped table name", () => {
    const t = fnBody(S, "function tableOf(");
    return /decodeURIComponent\(m\[1\]\)/.test(t);
  });
  check("P65729", "tablesOf never lists the same table twice on a move to itself", () => {
    const t = fnBody(S, "function tablesOf(");
    return /String\(to\) !== String\(from\)/.test(t);
  });
  check("P65730", "a label is never allowed to stop a write", () =>
    /catch \(e\) \{ *\/\* a label is a nicety/.test(R) || /catch \(e\) \{ *\}/.test(send));

  // -- judgement rows: is this how it should work for a real restaurant? -------------------
  check("P65731", "the FAILED list has no ceiling of its own - worth knowing, not a fault", () => {
    // MAX_QUEUED bounds `queued`; `failed` is deliberately unbounded because nothing may be
    // thrown away without a person. Recorded so a later sweep does not read it as an oversight.
    return /MAX_QUEUED/.test(S) && !/MAX_FAILED/.test(S);
  });
  check("P65732", "moveToFailed does NOT raise unsafeStore when its own idbPut fails", () => {
    // enqueue() checks `persisted`; moveToFailed ignores it. Both write to the same store, so a
    // device that cannot store is already reported by enqueue - this is an asymmetry, not a lie.
    const m = fnBody(S, "async function moveToFailed(");
    return /await idbPut\(item\)/.test(m) && !/persisted/.test(m);
  });
  check("P65733", "idbDel's result is deliberately not read (a delete that fails is harmless)", () =>
    /async function idbDel\(id\) \{ await idbWrite\(\(store\) => store\.delete\(id\)\); \}/.test(S));
}
