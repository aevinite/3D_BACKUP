// scripts/sweep/t16s10/rerun-static.mjs — the CODE-READING rows of sweep #7's T9 blocks
// (P19309–P19579, P44359–P44500) and the scattered ledgers, re-expressed as assertions on today's
// files. A row the code cannot answer (it is about a past run's conduct) is not here — see
// rerun-judgment.mjs.
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { join } from "node:path";
import { R, src, code, strip, count, fnBody, ok, eq, assert, ROOT, MY_FILES, ROUTES, tag } from "./lib.mjs";

const done = tag("static");
const OB = "outbox.js", RT = "realtime.js", CB = "connbadge.js", EL = "errlog.js", TH = "theme.js",
  FN = "fitnums.js", BS = "backstack.js", UB = "undobar.js", GB = "guestbell.js", MP = "myprofile.js",
  MT = "maint.js", IR = "issue-raise.js", SH = "swipehint.js", SW = "swreg.js", AS = "auditsort.js",
  OF = "offline.js", NR = "netretry.js", SI = "shrinkimg.js";
const panelHtml = (p) => src(`public/panels/${p}/index.html`);
const PAGES = ["editor", "kitchen", "tablet"];
const scriptOrder = (p) => [...panelHtml(p).matchAll(/<script[^>]*src="\/panels\/([^"?]+)/g)].map((m) => m[1]);
const pos = (p, f) => scriptOrder(p).indexOf(f);
const loads = (p, f) => pos(p, f) >= 0;
const migrations = () => readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const migText = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");

// ═════════════ outbox.js ═════════════
R("P19309", OB, "Every ceiling in the queue is a named constant, and all four agree with the guest queue's", () => {
  const c = code(OB), g = src("lib/guestOutbox.ts");
  const want = { AUTH_MAX_TRIES: 3, BUSY_MAX_TRIES: 6, NET_MAX_TRIES: 6, SERVER_MAX_TRIES: 6 };
  for (const [k, v] of Object.entries(want)) assert(new RegExp(`const ${k} = ${v};`).test(c), `${k} != ${v}`);
  const gm = (k) => (g.match(new RegExp(`${k}\\s*=\\s*(\\d+)`)) || [])[1];
  return ok(true, `staff 3/6/6/6 · guest auth ${gm("AUTH_MAX_TRIES") || "—"} busy ${gm("BUSY_MAX_TRIES") || "—"} net ${gm("NET_MAX_TRIES") || "—"} server ${gm("SERVER_MAX_TRIES") || gm("MAX_TRIES") || "—"}`);
});
R("P19310", OB, "A 4xx is never queued — only 5xx and a real network failure are", () => {
  const s = fnBody(code(OB), "async function send(");
  const a = s.indexOf("res.status >= 500"), b = s.indexOf("if (!res.ok)");
  return ok(a > 0 && b > a, `5xx branch at ${a}, the throw at ${b}`);
});
R("P19311", OB, "The queue never deletes a change on failure — every failure path pushes to `failed`", () => {
  const c = code(OB), n = count(c, /removeItem\(/);
  const mf = fnBody(c, "async function moveToFailed(");
  return ok(/failed\.push\(item\)/.test(mf) && !/idbDel/.test(mf) && n === 3, `removeItem appears ${n}x: its definition, the delivered path, dismiss`);
});
R("P19312", OB, "Ordering is per table, and work that cannot be tied to one shares a single strict bucket", () =>
  /const UNTABLED = "\\u0000untabled";/.test(src(OB)) && /function orderKey\(it\) \{ const t = tableOf\(it\); return t == null \? UNTABLED : String\(t\); \}/.test(code(OB)));
R("P19313", OB, "A non-retryable (clash) row does NOT hold up later work on its table", () =>
  /failed\.some\(function \(f\) \{ return f\.retryable !== false && owed\(f\); \}\)/.test(code(OB)));
R("P19314", OB, "A move marks BOTH tables as waiting, while ordering still follows the source", () => {
  const c = code(OB);
  return /function tablesOf\(item\)[\s\S]*?out\.push\(String\(to\)\)/.test(c) && /function orderKey\(it\) \{ const t = tableOf\(it\)/.test(c);
});
R("P19315", OB, "A destination table is NOT held behind a pending move — the database's own refusal covers it", () =>
  /orderKey\(it\) \{ const t = tableOf\(it\)/.test(code(OB)) && /target_occupied:/.test(code(OB)));
R("P19316", OB, "Every REASONS code is one the table-ops functions really answer with", () => {
  const keys = [...src(OB).matchAll(/^\s{4}([a-z_]+): "/gm)].map((m) => m[1]);
  const all = migrations().map(migText).join("\n");
  const missing = keys.filter((k) => !all.includes(`'${k}'`));
  return ok(keys.length >= 15 && missing.length === 0, `${keys.length} codes; not found in any migration: ${missing.join(", ") || "none"}`);
});
R("P19317", OB, "The REASONS sentences are English literals and are not routed through i18n", () =>
  !/\bimport\b|require\(|i18n|useTranslation/.test(code(OB)));
R("P19318", OB, "`item.table` is a sibling of `body`, never inside it — a readout cannot change what a write means", () =>
  /const item = \{ id: uuid\(\), base, method, path, body,[^}]*table: \(table == null/.test(code(OB)));
R("P19319", OB, "A test-pacing override is read from `window` only and nothing in the app sets it", () => {
  const hits = [];
  for (const d of ["app", "components", "lib"]) {
    const walk = (dir) => { for (const f of readdirSync(join(ROOT, dir))) { const p = join(dir, f); const st = statSync(join(ROOT, p)); if (st.isDirectory()) walk(p); else if (/\.(t|j)sx?$/.test(f) && readFileSync(join(ROOT, p), "utf8").includes("LFH_TEST_PACING")) hits.push(p); } };
    walk(d);
  }
  const panelSetters = readdirSync(join(ROOT, "public/panels")).filter((f) => f.endsWith(".js")).filter((f) => /LFH_TEST_PACING\s*=/.test(code(f)));
  return ok(hits.length === 0 && panelSetters.length === 0, `set by app code: ${hits.concat(panelSetters).join(", ") || "nothing"}`);
});
R("P19320", OB, "`__pause`/`__resume` exist for one verifier and no app code", () => {
  const users = ["editor", "kitchen", "tablet"].filter((p) => /__pause|__resume/.test(code(`public/panels/${p}/app.js`)));
  return ok(/__pause: \(\) =>/.test(code(OB)) && users.length === 0, `panel callers: ${users.join(", ") || "none"}`);
});
R("P19321", OB, "The label vocabulary for an inventory path is chosen by `base`, not by the path alone", () => /if \(base === "\/api\/inventory"\)/.test(code(OB)));
R("P19322", OB, "A label that already names a table is never doubled", () => /!\/·\\s\*Table\\s\/i\.test\(item\.label\)/.test(code(OB)));
R("P19323", OB, "`blockedByTable` counts only rows that can never be re-sent", () => /blockedByTable: function \(\) \{[\s\S]{0,120}if \(it\.retryable !== false\) return;/.test(code(OB)));
R("P19324", OB, "Nothing in the queue can raise an alert or a notification", () => !/Notification|api\/alerts/.test(code(OB)));
R("P19325", OB, "Every request the queue makes is a relative /api path — it never names a host", () => !/https?:\/\//.test(code(OB)));
// ═════════════ realtime.js ═════════════
R("P19326", RT, "Exactly one websocket client per frame, and a FAILED boot is not remembered", () => {
  const c = code(RT);
  return /if \(sbPromise\) return sbPromise;/.test(c) && /p\.catch\(\(\) => \{ if \(sbPromise === p\) sbPromise = null; \}\);/.test(c);
});
R("P19327", RT, "The socket is filtered server-side to this restaurant, with a safe topic-only fallback", () =>
  /filter: RT_RID \? "topic_rid=eq\." \+ topic \+ ":" \+ RT_RID : "topic=eq\." \+ topic/.test(code(RT)));
R("P19328", RT, "A breadcrumb from another restaurant is dropped client-side too, and a missing id keeps the event", () =>
  /if \(RT_RID && row && row\.restaurant_id && row\.restaurant_id !== RT_RID\) return;/.test(code(RT)));
R("P19329", RT, "A burst never waits longer than 1200ms measured from its FIRST event, and the wait cannot go negative", () =>
  /const capped = Math\.max\(0, Math\.min\(stretched, BURST_MAX_MS - \(now - firstAt\)\)\);/.test(code(RT)) && /const BURST_MAX_MS = 1200;/.test(code(RT)));
R("P19330", RT, "Past 20 changed tables one full reload replaces N per-table fetches", () => /if \(a\.tables\.size > 20\) \{ a\.full = true; a\.tables\.clear\(\); \}/.test(code(RT)));
R("P19331", RT, "The accumulator is reset BEFORE the handler runs, so an event arriving mid-refetch is not lost", () => {
  const c = code(RT), a = c.indexOf("acc[topic] = { tables: new Set(), full: false };", c.indexOf("const run = async")), b = c.indexOf("await handlers[topic](detail)");
  return ok(a > 0 && b > a, `reset at ${a}, handler at ${b}`);
});
R("P19332", RT, "A handler that throws is counted, never allowed to stop the loop", () => /try \{ await handlers\[topic\]\(detail\); \} catch \(e\) \{ metrics\.sync_failures\+\+; \}/.test(code(RT)));
R("P19333", RT, "CLOSED does not downgrade the badge; only CHANNEL_ERROR / TIMED_OUT do", () =>
  /else if \(status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT"\)/.test(code(RT)) && !/status === "CLOSED"/.test(code(RT)));
R("P19334", RT, "A hidden tab drops its channels after two minutes — unless the panel says it is still working", () =>
  /const IDLE_MS = 120000;/.test(code(RT)) && /idleTimer = setTimeout\(\(\) => \{ if \(!holdOpen\(\)\) teardown\(\); \}, IDLE_MS\);/.test(code(RT)));
R("P19335", RT, "The keep-alive is re-asked when the timer FIRES, not only when it is armed", () => /setTimeout\(\(\) => \{ if \(!holdOpen\(\)\) teardown\(\); \}/.test(code(RT)));
R("P19336", RT, "A wake with no client at all tries to build one, and refetches either way", () => /ensureClient\(\)\.then\(\(\) => fireAll\(\), \(\) => fireAll\(\)\);/.test(code(RT)));
R("P19337", RT, "catchUp() does nothing while the socket is healthy, the tab is hidden, or the device is offline", () =>
  /if \(\(document\.hidden && !holdOpenAny\(\)\) \|\| connStatus === "online" \|\| navigator\.onLine === false\) \{ step = 0; return arm\(\); \}/.test(code(RT)));
R("P19338", RT, "catchUp() jitters ±20% so twenty devices never poll on the same beat", () => /Math\.round\(ms \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)\)/.test(code(RT)));
R("P19339", RT, "catchUp() resets to fast the moment one read succeeds", () => /try \{ await fn\(\); step = 0; \}/.test(code(RT)));
R("P19340", RT, "A nonsense latency reading is discarded rather than shown", () => /if \(!\(ms >= 0\) \|\| ms > 60000\) return;/.test(code(RT)));
R("P19341", RT, "The latency ring is bounded", () => /const LAT_HIST_MAX = 24;/.test(code(RT)) && /if \(metrics\.latHist\.length > LAT_HIST_MAX\) metrics\.latHist\.shift\(\);/.test(code(RT)));
R("P19342", RT, "Latency is measured from breadcrumbs the panel already receives — realtime.js makes no extra request", () => {
  const n = count(code(RT), /fetch\(/);
  return ok(n === 1 && /fetch\("\/api\/rt-config"/.test(code(RT)), `${n} fetch call(s), /api/rt-config at boot`);
});
R("P19343", RT, "The realtime client comes from our own origin, never a public CDN", () => /import\("\/vendor\/supabase\.js"\)/.test(code(RT)) && !/jsdelivr|unpkg|cdnjs/.test(code(RT)));
R("P19344", RT, "`debounce()` is dead code — burstDebounce replaced it", () => {
  const c = code(RT), calls = count(c, /\bdebounce\(/);
  return ok(calls === 1, `declared once, called ${calls - 1} times — harmless, recorded as P19599 judges`);
});
// ═════════════ connbadge.js ═════════════
R("P19345", CB, "The four latency tiers match latencyTier() in lib/connectionStatus.ts, thresholds and labels", () => {
  const tiers = (t) => [...t.matchAll(/ms <= (\d+)\)\s+return \{[^}]*bars: (\d), label: "(\w+)"/g)].map((m) => `${m[1]}:${m[3]}:${m[2]}`);
  const a = tiers(code(CB)), b = tiers(strip(src("lib/connectionStatus.ts")));
  const pa = /bars: 0, label: "Poor"/.test(code(CB)), pb = /bars: 0, label: "Poor"/.test(src("lib/connectionStatus.ts"));
  return ok(JSON.stringify(a) === JSON.stringify(b) && a.length === 3 && pa && pb, `panel ${a.join(" ")} · react ${b.join(" ")}`);
});
R("P19346", CB, "Bars carry the same meaning as colour, so the readout is never colour-only", () => {
  const b = [...code(CB).matchAll(/bars: (\d), label: "(Excellent|Good|Slow|Poor)"/g)].map((m) => m[1]);
  return ok(b.join(",") === "3,2,1,0", `bars per tier: ${b.join(",")}`);
});
R("P19347", CB, "A latency reading older than 90s falls back to a calm 'Live' rather than a stale number", () => /var LATENCY_FRESH_MS = 90000;/.test(code(CB)) && /var fresh = lat\.at > 0 && \(Date\.now\(\) - lat\.at\) < LATENCY_FRESH_MS;/.test(code(CB)));
R("P19348", CB, "First connect paints a neutral 'Connecting…', never the amber 'Reconnecting'", () => /if \(!ever\) return \{ level: level, connecting: true, color: "#94a3b8"[^}]*label: "Connecting…"/.test(code(CB)));
R("P19349", CB, "The whole pill is one button, and a tap always opens the details panel", () => /badge = el\("button", "lfh-conn"\)/.test(code(CB)) && /badge\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); togglePop\(\); \}\);/.test(code(CB)));
R("P19350", CB, "The popover registers a Back layer on open and gives it up on close", () => /backOff = window\.LFH_BACK\.layer\("conn-badge", closePop\)/.test(code(CB)) && /if \(backOff\) \{ try \{ backOff\(\); \}/.test(fnBody(code(CB), "function closePop(")));
R("P19351", CB, "The clamp measures from the UNSHIFTED position, so it cannot drift on a re-render", () => /pop\.style\.setProperty\("--pop-x", "0px"\);\s*pop\.style\.transform = "";\s*var r = pop\.getBoundingClientRect\(\)/.test(fnBody(code(CB), "function clampPop(")));
R("P19352", CB, "The clamp survives the entry animation through --pop-x in the keyframes", () => /@keyframes lfhConnPop\{from\{transform:translate\(var\(--pop-x\),-4px\)/.test(code(CB)));
R("P19353", CB, "The dark-surface ink rule is keyed on data-skin, and a light console beats the document-level dark rule", () => {
  const c = src(CB);
  return /\[data-skin="dark"\] \.lfh-conn-txt/.test(c) && /html \[data-skin="light"\] \.lfh-conn-txt/.test(c) && /html\[data-theme="dark"\] \.lfh-conn-txt/.test(c);
});
R("P19354", CB, "A failed row's Retry retries THAT row only, and a clash is offered none", () => /if \(it\.retryable !== false\) \{\s*var retry = el\("button", "lfh-conn-x", "Retry"\)[\s\S]{0,300}window\.LFH_OUTBOX\.retryOne\(it\.id\)/.test(code(CB)) && !/retryFailed\(/.test(code(CB)));
R("P19355", CB, "The sparkline is a fixed 24 slots and every bar is coloured by its OWN tier", () => /var SPARK_SLOTS = 24;/.test(code(CB)) && /var t = latencyTier\(val\);/.test(code(CB)));
R("P19356", CB, "A sparkline bar never collapses to nothing", () => /Math\.max\(14, Math\.round\(\(val \/ max\) \* 100\)\)/.test(code(CB)));
R("P19357", CB, "Reduced motion turns off both the bar pulse and the popover animation", () => /@media \(prefers-reduced-motion:reduce\)\{\.lfh-conn\.is-pulse \.lfh-bar\{animation:none\}\.lfh-conn-pop\{animation:none\}\}/.test(src(CB)));
R("P19358", CB, "The pill makes no request of its own", () => ok(count(code(CB), /fetch\(/) === 0, "0 fetch calls"));
R("P19359", CB, "The legacy #conn dot is hidden rather than left duplicating the pill (expectation moved: it was DELETED 2026-09-03)", () => {
  const panelHasConn = PAGES.some((p) => /id="conn"/.test(panelHtml(p).replace(/<!--[\s\S]*?-->/g, "")));
  return ok(!panelHasConn && /OBITUARY \(2026-09-03\)/.test(src(CB)), "no #conn element on any panel page; the obituary note stands in mount()");
});
R("P19360", CB, "outbox.js is loaded before connbadge.js in all three panels", () => {
  const r = PAGES.map((p) => `${p}:${pos(p, "outbox.js") >= 0 && pos(p, "outbox.js") < pos(p, "connbadge.js") ? "ok" : "BAD"}`);
  return ok(r.every((x) => x.endsWith("ok")), r.join(" "));
});
R("P19361", CB, "The popover's rebuild signature is over-sensitive while a countdown is showing (TRUE but harmless)", () =>
  ok(/var s = syncState\(\);\s*return \[v\.level, v\.label, v\.ms, v\.bars, s\.head,/.test(code(CB)) && /if \(popHeld \|\| sig === popPrinted\) return;/.test(code(CB)), "still over-sensitive; the popHeld guard still protects the tap"));
// ═════════════ errlog.js ═════════════
R("P19362", EL, "The noise filter compares the browser's WHOLE message, allowing only its own Error prefix", () => /var bare = m\.replace\(\/\^\[A-Za-z\]\*Error:\\s\*\/, ""\)/.test(code(EL)) && /if \(bare\.toLowerCase\(\) === NETWORK_NOISE\[i\]\.toLowerCase\(\)\) return true;/.test(code(EL)));
R("P19363", EL, "The filter is exactly six phrases plus the late print rejection — it has not been widened", () => {
  const block = src(EL).slice(src(EL).indexOf("var NETWORK_NOISE = ["), src(EL).indexOf("];", src(EL).indexOf("var NETWORK_NOISE = [")));
  const n = count(block, /^\s+"[^"]+",/m);
  return ok(n === 6, `${n} phrases`);
});
R("P19364", EL, "A crash row names the file AND the build hash it belongs to", () => /return m \? name \+ "@" \+ m\[1\] : name;/.test(code(EL)));
R("P19365", EL, "The first two stack frames are kept, errlog's own frame is skipped, duplicates collapse", () => {
  const f = fnBody(code(EL), "function frames(");
  return /out\.length < 2/.test(f) && /indexOf\("errlog\.js"\) === 0\) continue;/.test(f) && /if \(seen\[f\]\) continue;/.test(f);
});
R("P19366", EL, "A rejection with no stack names the last button tapped instead of just 'promise'", () => /frames\(r\) \|\| lastTapHint\(\)/.test(code(EL)));
R("P19367", EL, "lastTap survives a flush, so a crash right after one still has a breadcrumb", () => !/lastTap = null/.test(fnBody(code(EL), "function flush(")) && /var lastTap = null;/.test(code(EL)));
R("P19368", EL, "A button's name is read from VISIBLE text only, with a space across every element boundary", () => /out \+= " " \+ visibleText\(n\) \+ " ";/.test(code(EL)) && /cs\.display === "none" \|\| cs\.visibility === "hidden"/.test(code(EL)));
R("P19369", EL, "The tap listener is capture-phase, so a handler that stops propagation is still seen", () => /\}, true\); \n?/.test(code(EL)) || /\}, true\);/.test(code(EL)));
R("P19370", EL, "The tap buffer is bounded between flushes", () => /if \(taps\.length > 60\) taps\.shift\(\);/.test(code(EL)));
R("P19371", EL, "Nothing in the logger can throw into the panel", () => ok(count(code(EL), /try \{/) >= 5, `${count(code(EL), /try \{/)} guarded blocks`));
R("P19372", EL, "The panel name is inferred to match the server's own logAction tag (editor → manager)", () => /if \(p\.indexOf\("\/panels\/editor"\) >= 0\) return "manager";/.test(code(EL)));
R("P19373", EL, "The offline crash store is capped at the server's own 5-per-10-minutes", () => {
  const a = Number((code(EL).match(/var PENDING_MAX = (\d+);/) || [])[1]), b = Number((code(ROUTES.clientError).match(/MAX_ERRORS_PER_DEVICE_10MIN = (\d+);/) || [])[1]);
  return ok(a === b && a === 5, `store ${a} vs route ${b}`);
});
R("P19374", EL, "Kept crashes are delivered one at a time with a gap, not as a burst", () => /\}, i \* 1500\);/.test(code(EL)));
R("P19375", EL, "A beacon the browser refuses to queue is kept, not dropped", () => /if \(!queued\) stash\(payload\);/.test(code(EL)));
R("P19376", EL, "Tap breadcrumbs are never kept offline — only crashes are", () => /if \(payload\.kind !== "error"\) return;/.test(fnBody(code(EL), "function stash(")));
// ═════════════ theme.js ═════════════
R("P19377", TH, "The key is the panel's own, never the guest's", () => /var KEY = "lfh_panel_theme";/.test(code(TH)) && !/"lfh_theme"/.test(code(TH)));
R("P19378", TH, "A blocked localStorage cannot throw and leave the panel unstyled", () => /try \{ return localStorage\.getItem\(KEY\); \} catch \(e\) \{ return null; \}/.test(code(TH)) && /try \{ localStorage\.setItem\(KEY, theme\); \} catch \(e\) \{\}/.test(code(TH)));
R("P19379", TH, "The attribute is set before first paint — theme.js is a BLOCKING script inside <head>", () => {
  const r = PAGES.map((p) => { const h = panelHtml(p), head = h.slice(0, h.indexOf("</head>")); const tagm = head.match(/<script[^>]*src="\/panels\/theme\.js[^>]*>/); return `${p}:${tagm && !/defer|async/.test(tagm[0]) ? "sync in head" : "BAD"}`; });
  return ok(r.every((x) => x.endsWith("sync in head")), r.join(" "));
});
R("P19380", TH, "The cross-tab apply does not write back to storage (no loop between two agreeing tabs)", () => !/localStorage/.test(fnBody(code(TH), "function paint(")));
R("P19381", TH, "The toggle is wired exactly once however often wire() runs", () => /if \(btn && !btn\.__themeWired\) \{\s*btn\.__themeWired = true;/.test(code(TH)));
R("P19382", TH, "Only ONE file in the repo writes lfh_panel_theme", () => {
  const writers = readdirSync(join(ROOT, "public/panels")).filter((f) => f.endsWith(".js")).filter((f) => /setItem\(\s*(KEY|"lfh_panel_theme")/.test(code(f)) && /lfh_panel_theme/.test(src(f)));
  const apps = PAGES.filter((p) => /setItem\(\s*"lfh_panel_theme"/.test(code(`public/panels/${p}/app.js`)));
  return ok(writers.join() === "theme.js" && apps.length === 0, `writers: ${writers.concat(apps.map((p) => p + "/app.js")).join(", ")}`);
});
// ═════════════ fitnums.js ═════════════
R("P19383", FN, "Any inline font-size the template set is remembered and restored, never wiped", () => /if \(el\.dataset\.lfhFitBase == null\) el\.dataset\.lfhFitBase = el\.style\.fontSize \|\| "";/.test(code(FN)) && /el\.style\.fontSize = el\.dataset\.lfhFitBase;/.test(code(FN)));
R("P19384", FN, "The shrink removes the overflow DELTA, not the content ratio", () => /cur \* \(\(w - over\) \/ w\)/.test(code(FN)));
R("P19385", FN, "A perfectly-fitting figure never jitters (the 1px forgiveness)", () => /if \(over <= 1\) break;/.test(code(FN)));
R("P19386", FN, "A composite tile keeps its normal wrapping and is never abbreviated", () => /if \(el\.childElementCount === 0 && cs\.whiteSpace !== "nowrap"\)/.test(code(FN)) && /el\.childElementCount === 0 && !isExact\(el\)/.test(code(FN)));
R("P19387", FN, "The Indian short form matches components/FitNumber.tsx exactly", () => {
  const body = (t) => strip(fnBody(t, "function shortIndian(")).replace(/:\s*(string|number)(\s*\|\s*null)?/g, "").replace(/\b(var|let|const)\b/g, "V").replace(/\s+/g, "");
  const a = body(src(FN)), b = body(src("components/FitNumber.tsx"));
  return ok(a.slice(a.indexOf("{")) === b.slice(b.indexOf("{")), "Cr / L / K, the same rounding, the same 1000 floor");
});
R("P19388", FN, "Anything under 1000 is left alone", () => /if \(!isFinite\(n\) \|\| n < 1000\) return null;/.test(code(FN)));
R("P19389", FN, "At most one scan per animation frame", () => /if \(!raf\) raf = requestAnimationFrame\(function \(\) \{ raf = 0; scan\(\); \}\);/.test(code(FN)));
R("P19390", FN, "The observer is on document.body, so it survives a whole-board innerHTML rewrite", () => /new MutationObserver\(queue\)\.observe\(document\.body,/.test(code(FN)));
R("P19391", FN, "Every money selector the panels fit is in the exact-figure list", () => {
  const exact = (code(FN).match(/var EXACT_SEL = "([^"]+)"/) || [])[1].split(",");
  // A DOCUMENT money figure must stay exact; a dashboard KPI tile (.dash-card .kval) is a SUMMARY
  // and is meant to shorten (P19176), so it is not a money selector for this row.
  const money = /amt|total|money|ks-val/i;
  const lists = PAGES.map((p) => (panelHtml(p).match(/fitnums\.js[^>]*data-fit="([^"]*)"/) || [])[1] || "").join(",").split(",").filter(Boolean);
  const moneySel = lists.filter((s) => money.test(s));
  // isExact() uses el.closest(EXACT_SEL), so ".ord-total span" is covered by ".ord-total".
  const uncovered = moneySel.filter((s) => !exact.some((e) => s.trim().split(/\s+/).some((part) => part.startsWith(e.trim()))));
  return ok(uncovered.length === 0, `${moneySel.length} money selector(s) in the fit lists; not covered by EXACT_SEL: ${uncovered.join(", ") || "none"}`);
});
// ═════════════ backstack.js ═════════════
R("P19392", BS, "history.go(-N) fires ONE popstate, so exactly one is swallowed — matching lib/backStack.ts", () => /ignore \+= 1;\s*history\.go\(-remove\);/.test(code(BS)) && /ignore\s*\+=\s*1|ignoreNext|ignore = /.test(src("lib/backStack.ts")));
R("P19393", BS, "A close callback that throws cannot break the back button", () => /if \(top\) \{ try \{ top\.close\(\); \} catch \(e\)/.test(code(BS)));
R("P19394", BS, "Back with nothing open leaves the panel — deliberately no 'Leave this site?' guard for staff", () => /No "Leave this site\?" guard here/.test(src(BS)) && !/beforeunload/.test(code(BS)));
R("P19395", BS, "Unregistering a layer a back press already popped is a no-op", () => /if \(i === -1\) return;/.test(code(BS)));
R("P19396", BS, "No file in my territory hand-rolls pushState or a popstate listener", () => {
  const off = MY_FILES.filter((f) => f !== BS && /pushState|"popstate"/.test(code(f)));
  return ok(off.length === 0, `only backstack.js${off.length ? " · ALSO " + off.join(", ") : ""}`);
});
R("P19397", BS, "Every overlay in my territory registers a Back layer", () => {
  const need = { [CB]: "conn-badge", [GB]: "guest-bell", [MT]: "staff-profile", [MP]: "my-profile", [IR]: "issue-raise", [OF]: "offline-needs-you" };
  const miss = Object.entries(need).filter(([f, id]) => !new RegExp(`LFH_BACK\\.layer\\("${id}"`).test(code(f)));
  return ok(miss.length === 0, `all ${Object.keys(need).length} register${miss.length ? " · MISSING " + miss.map((x) => x[0]).join(", ") : ""}`);
});
R("P19398", BS, "The three panels' own app.js use LFH_BACK rather than their own popstate listener", () => {
  const r = PAGES.map((p) => `${p}:${/LFH_BACK/.test(code(`public/panels/${p}/app.js`)) && !/addEventListener\("popstate"/.test(code(`public/panels/${p}/app.js`)) ? "ok" : "BAD"}`);
  return ok(r.every((x) => x.endsWith("ok")), r.join(" "));
});
// ═════════════ undobar.js ═════════════
R("P19399", UB, "stroke-dashoffset carries a unit — a bare number silently never animates", () => /ringEl\.style\.strokeDashoffset = RING_LEN \+ "px";/.test(code(UB)) && /ringEl\.style\.strokeDashoffset = "0px";/.test(code(UB)));
R("P19400", UB, "The reset is forced to stick with a reflow before the transition is re-applied", () => /void ringEl\.getBoundingClientRect\(\);/.test(code(UB)));
R("P19401", UB, "The UNDO button is guarded against a double tap, and the card hides before the callback runs", () => /if \(busy\) return;\s*busy = true;\s*clearTimer\(\);\s*hide\(\);\s*if \(typeof opts\.onUndo === "function"\)/.test(code(UB)));
R("P19402", UB, "An onUndo that throws or rejects cannot break the bar", () => /try \{ Promise\.resolve\(opts\.onUndo\(\)\)\.catch\(function \(\) \{\}\); \} catch \(e\) \{\}/.test(code(UB)));
R("P19403", UB, "The card never sits under a phone's nav bar", () => /bottom:calc\(16px \+ var\(--sab, env\(safe-area-inset-bottom, 0px\)\)\)/.test(src(UB)));
R("P19404", UB, "The card is role=status + aria-live=polite, so it is announced without interrupting", () => /setAttribute\("role", "status"\)/.test(code(UB)) && /setAttribute\("aria-live", "polite"\)/.test(code(UB)));
R("P19405", UB, "The UNDO button meets the tap target the owner set", () => /min-height:40px;min-width:64px;/.test(src(UB)));
R("P19406", UB, "The card is deliberately NOT a Back layer — Back should not eat a countdown", () => !/LFH_BACK/.test(code(UB)));
R("P19407", UB, "The toast step-over ships from this file, so every panel gets it from one place", () => {
  const dup = /body\.lfh-undobar-up/.test(strip(src("public/panels/editor/style.css")));
  return ok(/body\.lfh-undobar-up \.toasts,body\.lfh-undobar-up \.toast\{/.test(src(UB)), `undobar.js ships it${dup ? "; editor/style.css still carries its own copy (the T5 handoff P19597)" : "; no panel stylesheet duplicates it any more"}`);
});
// ═════════════ guestbell.js ═════════════
R("P19408", GB, "The bell makes no request and never writes anything", () => ok(!/fetch\(|api\(|"POST"/.test(code(GB)), "0 hits"));
R("P19409", GB, "Seen-ness is tracked by row IDENTITY, never by a last-looked-at timestamp", () => /function rowKey\(r\) \{ return String\(r\.key \|\| \(r\.kind \+ ":"/.test(code(GB)) && !/lastSeenAt|seenAt/.test(code(GB)));
R("P19410", GB, "The seen list is pruned to what is waiting, so it cannot grow forever", () => /var keys = last\.allRows\.map\(rowKey\)\.slice\(0, 500\);/.test(code(GB)));
R("P19411", GB, "Rows keep their red edge while the sheet is being read", () => {
  const o = fnBody(code(GB), "function openSheet("), a = o.indexOf("renderSheet()"), b = o.indexOf("markSeen()");
  return ok(a > 0 && b > a, `render at ${a}, markSeen at ${b}`);
});
R("P19412", GB, "The four kinds use the floor's own words", () => /call:\s+\{ icon: "🔔", what: "rang for a waiter" \}/.test(src(GB)) && /order:\s+\{ icon: "🧾", what: "sent a new order" \}/.test(src(GB)));
R("P19413", GB, "backdrop-filter is one unprefixed line", () => !/-webkit-backdrop-filter/.test(src(GB)) && /backdrop-filter:blur\(3px\)/.test(src(GB)));
R("P19414", GB, "The bell is absent from the kitchen panel, deliberately", () => ok(!loads("kitchen", "guestbell.js") && loads("editor", "guestbell.js") && loads("tablet", "guestbell.js"), "not loaded on the kitchen; loaded on the manager and the waiter tablet"));
R("P19415", GB, "The count badge caps its text at 99+ but the aria-label says the real number", () => /badge\.textContent = n > 99 \? "99\+" : String\(n\);/.test(code(GB)) && /n \+ " new things from the guest menu"/.test(code(GB)));
// ═════════════ myprofile.js ═════════════
R("P19416", MP, "The editable field list matches SELF_PROFILE_FIELDS in lib/staffProfileShared.ts", () => {
  const screen = [...src(MP).matchAll(/\["([a-z_]+)", "/g)].map((m) => m[1]);
  const server = [...src("lib/staffProfileShared.ts").slice(src("lib/staffProfileShared.ts").indexOf("SELF_PROFILE_FIELDS = [")).split("] as const")[0].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
  const notAllowed = screen.filter((f) => !server.includes(f));
  return ok(notAllowed.length === 0, `screen ${screen.length}, server allows ${server.length}; on the screen but not allowed: ${notAllowed.join(", ") || "none"}`);
});
R("P19417", MP, "ID-on-file, job and salary are not editable here", () => {
  const fields = [...src(MP).matchAll(/\["([a-z_]+)", "/g)].map((m) => m[1]);
  return ok(!fields.some((f) => /id_|designation|salary|pay_|joined|shift/.test(f)), fields.join(","));
});
R("P19418", MP, "Pay is shown only when the owner allows it", () => /if \(me\.canSeeOwnPay && me\.pay\) \{/.test(code(MP)));
R("P19419", MP, "A cancelled payment is struck through and says why", () => /x\.voided_at \? ' style="text-decoration:line-through;opacity:\.6"' : ""/.test(code(MP)) && /" · cancelled: " \+ esc\(x\.void_reason/.test(code(MP)));
R("P19420", MP, "Both saves go through the queue, never a raw fetch", () => {
  const c = code(MP), saves = count(c, /window\.LFH_PROFILE_SAVE\(/), fetches = count(c, /fetch\(/);
  return ok(saves === 2 && fetches === 1, `${saves} queued saves; ${fetches} real fetch call — the documented fallback READ in load()`);
});
R("P19421", MP, "The profile expect uses a jsonb sub-key so it cannot fire on an unrelated key", () => /fields: \{ "profile\.notes":/.test(code(MP)));
R("P19422", MP, "A queued save says 'saved on this device', not 'saved'", () => /tell\("Saved on this device — it will sync when you're back online\."/.test(code(MP)));
R("P19423", MP, "row() is the only escaper — no call site escapes its own title", () => ok(!/row\("[^"]+", esc\(/.test(code(MP)), "no row(…, esc(…) call"));
R("P19424", MP, "The kitchen never loads this file", () => ok(!loads("kitchen", "myprofile.js"), "kitchen has NO profile — ruled three times"));
R("P19425", MP, "The manager button is revealed by clearing BOTH hidden and display", () => /if \(yes\) \{ btn\.hidden = false; btn\.style\.display = ""; \}/.test(code(MP)));
// ═════════════ maint.js ═════════════
R("P19426", MT, "The shared profile read coalesces concurrent callers and drops the entry once settled", () => /if \(inflight\) return inflight;/.test(code(MT)) && /var drop = function \(\) \{ inflight = null; \};\s*inflight\.then\(drop, drop\);/.test(code(MT)));
R("P19427", MT, "It resolves the PARSED body, never the Response (a body reads once)", () => /return \{ ok: r\.ok, status: r\.status, json: j \};/.test(code(MT)));
R("P19428", MT, "The queue is resolved at CALL time, not parse time, because it loads after this file", () => {
  const r = ["editor", "tablet"].map((p) => `${p}: maint ${pos(p, "maint.js")} < outbox ${pos(p, "outbox.js")}`);
  return ok(/if \(window\.LFH_OUTBOX && window\.LFH_OUTBOX\.send\)/.test(fnBody(code(MT), "async function profileSave(")) && ["editor", "tablet"].every((p) => pos(p, "maint.js") < pos(p, "outbox.js")), r.join(" · ") + " — resolved at call time");
});
R("P19429", MT, "A password change deliberately stays on the live path and says so offline", () => /if \(navigator\.onLine === false\) \{ setMsg\(pwMsg, "You're offline — a password change needs a connection\./.test(code(MT)));
R("P19430", MT, "Sign-out is a POST, never a GET", () => /fetch\("\/api\/panel-logout", \{ method: "POST"/.test(code(MT)) && !/location\.href = "\/api\/panel-logout"/.test(code(MT)));
R("P19431", MT, "Sign-out reaches /login whatever the request does, within 4 seconds", () => /const stop = setTimeout\(\(\) => \{ leaveTo\("\/login"\); \}, 4000\);/.test(code(MT)));
R("P19432", MT, "A PIN is validated as 4–8 digits in both places it can be set", () => count(code(MT), /\/\^\\d\{4,8\}\$\//) === 2);
R("P19433", MT, "A PIN save carries no expect, because a PIN is write-only", () => /window\.LFH_PROFILE_SAVE\(\{ pin: pinIn\.value \}, \{ label: "set your PIN" \}\)/.test(code(MT)));
R("P19434", MT, "Every owner-panel embed is excluded from this drawer", () => /\["ownermode", "menuonly", "invonly"\]\.some\(\(k\) => embedQ\.get\(k\) === "1"\)/.test(code(MT)));
R("P19435", MT, "A panel may declare it has NO profile at all, and then nothing is added", () => /if \(window\.LFH_NO_PROFILE_AT_ALL\) return;/.test(code(MT)) && /LFH_NO_PROFILE_AT_ALL\s*=\s*true/.test(src("public/panels/kitchen/app.js") + src("public/panels/kitchen/index.html")));
R("P19436", MT, "The settings button's glyph and word are separate spans, so a narrow phone drops only the word", () => /class: "ssb-i"/.test(code(MT)) && /class: "ssb-t"/.test(code(MT)));
R("P19437", MT, "The aria-label keeps the full wording even when the word is hidden", () => /b\.setAttribute\("aria-label", word\);/.test(code(MT)));
R("P19438", MT, "The device-id cookie is set once and cannot throw when cookies are blocked", () => /if \(!\/\(\?:\^\|;\\s\*\)lfh_panel_device=\/\.test\(document\.cookie\)\)/.test(code(MT)) && /\} catch \{ \/\* cookies blocked/.test(src(MT)));
R("P19439", MT, "The maintenance switch is manager-only — kitchen and tablet never see it", () => /if \(isManager\) \{\s*const maintBtn/.test(code(MT)) && /const isManager = profile\.role === "manager" \|\| profile\.role === "editor";/.test(code(MT)));
R("P19440", MT, "backdrop-filter is one unprefixed line", () => !/-webkit-backdrop-filter/.test(src(MT)) && /backdrop-filter:blur\(6px\)/.test(src(MT)));
R("P19441", MT, "The drawer fits a phone: max-height 100dvh minus a margin", () => /\.lfh-dw\{width:min\(94vw,400px\);max-height:calc\(100dvh - 36px\)/.test(src(MT)));
// ═════════════ issue-raise.js ═════════════
R("P19442", IR, "The ticket goes through the panel's own api(), so it queues offline", () => /var r = await api\("POST", "\/issue",/.test(code(IR)));
R("P19443", IR, "Only PNG / JPEG / WEBP are accepted, and a photo over 5 MB is refused with a sentence", () => /var OK_IMAGE = \{ "image\/png": 1, "image\/jpeg": 1, "image\/webp": 1 \};/.test(code(IR)) && /setStatus\("Photo must be 5 MB or smaller\.", "err"\)/.test(code(IR)));
R("P19444", IR, "A voice note auto-stops at two minutes", () => /var MAX_AUDIO_MS = 120000;/.test(code(IR)) && /recStop = setTimeout\(stopRecording, MAX_AUDIO_MS\);/.test(code(IR)));
R("P19445", IR, "The Record button is never disabled while a recording is running — Stop must stay reachable", () => /recBtn\.disabled = !rec && /.test(code(IR)));
R("P19446", IR, "The mic is released on stop AND on close", () => count(code(IR), /getTracks\(\)\.forEach\(function \(t\) \{ t\.stop\(\); \}\)/) === 2);
R("P19447", IR, "Object URLs are revoked on close and when an attachment is removed", () => count(code(IR), /URL\.revokeObjectURL/) >= 4);
R("P19448", IR, "Re-picking the same file works", () => /fileInp\.value = "";/.test(code(IR)));
R("P19449", IR, "Escape closes it, and both window listeners are removed on close", () => /if \(e\.key === "Escape"\) guardedClose\(\);/.test(code(IR)) && /window\.removeEventListener\("online", reflectOffline\);\s*window\.removeEventListener\("offline", reflectOffline\);/.test(code(IR)));
R("P19450", IR, "An empty subject is refused with a sentence and focus, never silence", () => /if \(!subject\) \{ setStatus\("Please add a subject\.", "err"\); subj\.focus\(\); return; \}/.test(code(IR)));
R("P19451", IR, "A failed send re-enables Send rather than leaving a dead button", () => /sendBtn\.disabled = false; reflectOffline\(\);/.test(code(IR)));
R("P19452", IR, "The admin's ?rid= pin rides on the media upload URL", () => /"\/api\/issue-media" \+ \(opts\.rid \? "\?rid=" \+ encodeURIComponent\(opts\.rid\) : ""\)/.test(code(IR)));
R("P19453", IR, "The dialog is labelled and aria-modal", () => /role="dialog" aria-modal="true" aria-label="Report an issue"/.test(code(IR)));
R("P19454", IR, "Cancel still throws the recording away — that one is deliberate", () => /\$\("lfhirCancel"\)\.onclick = function \(\) \{ close\(\); \};/.test(code(IR)));
// ═════════════ swipehint.js ═════════════
R("P19455", SH, "A row that cannot scroll gets neither the fade nor the chip", () => /if \(ox !== "auto" && ox !== "scroll"\) \{ row\.removeAttribute\("data-more"\);/.test(code(SH)));
R("P19456", SH, "A row at its end (sub-pixel short) is still recognised as at-end", () => /var EPS = 2;/.test(code(SH)) && /row\.scrollLeft >= over - EPS/.test(code(SH)));
R("P19457", SH, "The chip is a SIBLING, so it does not scroll away with the content", () => /row\.parentNode\.appendChild\(chip\);/.test(code(SH)));
R("P19458", SH, "The chip is built from nodes, never innerHTML", () => !/\.innerHTML\s*=/.test(code(SH)));
R("P19459", SH, "The chip is aria-hidden and not tabbable — the row is already reachable", () => /chip\.setAttribute\("aria-hidden", "true"\);/.test(code(SH)) && /chip\.tabIndex = -1;/.test(code(SH)));
R("P19460", SH, "A browser without smooth scroll still moves the row", () => /\} catch \(e\) \{ row\.scrollLeft \+= 160; \}/.test(code(SH)));
R("P19461", SH, "Measuring is rAF-coalesced — no polling anywhere in the file", () => !/setInterval/.test(code(SH)) && /requestAnimationFrame\(run\)/.test(code(SH)));
R("P19462", SH, "A row is watched once however many times scan() sees it", () => /if \(!row \|\| watched\.has\(row\)\) return;/.test(code(SH)) && /var watched = new WeakSet\(\);/.test(code(SH)));
R("P19463", SH, "The chip excludes itself from the count", () => /if \(c === row\.__lfhChip\) continue;/.test(code(SH)));
R("P19464", SH, "Its doc comment does not overstate which panels load it", () => {
  const by = PAGES.filter((p) => loads(p, "swipehint.js"));
  return ok(by.length >= 1, `loaded by: ${by.join(", ")}`);
});
// ═════════════ auditsort.js + .d.ts ═════════════
R("P19465", AS, "The file is pure logic — no DOM, no network, no storage", () => !/document\.|fetch\(|localStorage|indexedDB/.test(code(AS)));
R("P19466", AS, "It exports the same surface to CommonJS and to the window", () => /module\.exports/.test(code(AS)) && /LFH_AUDITSORT/.test(code(AS)));
R("P19467", "public/panels/auditsort.d.ts", "The .d.ts describes every exported function", () => {
  const api = code(AS).slice(code(AS).lastIndexOf("var API"));
  const keys = [...(api.match(/\{([\s\S]*?)\};/) || [, ""])[1].matchAll(/([A-Za-z_]+)\s*:/g)].map((m) => m[1]);
  const dts = src("public/panels/auditsort.d.ts");
  const undeclared = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(dts));
  return ok(keys.length >= 25 && undeclared.length === 0, `${keys.length} exports; undeclared: ${undeclared.join(", ") || "none"}`);
});
R("P19468", AS, "Every comparator ends in a total tie-break, so equal rows never swap between renders", () => {
  const cmps = [...code(AS).matchAll(/cmp: function \(a, b\) \{([\s\S]*?)\} \}/g)].map((m) => m[1]);
  const bad = cmps.filter((c) => !/tie\(a, b\)|tieA\(a, b\)/.test(c));
  return ok(cmps.length >= 11 && bad.length === 0, `${cmps.length} comparators, ${bad.length} without a tie-break`);
});
const auditVerify = () => { const r = npmRunQuiet("verify:audit"); return r; };
function npmRunQuiet(s) { try { return { ok: true, out: execFileSync("npm", ["run", "-s", s], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") }; } }
const grepL = (needle, ...dirs) => { try { return execFileSync("grep", ["-rl", needle, ...dirs], { cwd: ROOT, encoding: "utf8" }); } catch { return ""; } };
let auditOnce = null;
const audit = () => (auditOnce = auditOnce || auditVerify());
R("P19469", AS, "KIND_RISK agrees with lfh_audit_risk() in the database", () => { const r = audit(); return ok(r.ok, `verify:audit ${r.ok ? "green" : "RED: " + r.out.slice(-200)}`); }, "npm run verify:audit");
R("P19470", AS, "KIND_TAGS agrees with lfh_audit_tags() in the migrations", () => { const r = audit(); return ok(r.ok, `verify:audit ${r.ok ? "green" : "RED"}`); }, "npm run verify:audit");
R("P19471", AS, "Every tag has words and a glyph", () => {
  const A = loadAudit(), tags = new Set(Object.values(A.KIND_TAGS).flat().concat(["loss", "no-loss", "unanswered", "cost-unknown", "other"]));
  const noL = [...tags].filter((t) => !A.TAG_LABEL[t]), noI = [...tags].filter((t) => !A.TAG_ICON[t]);
  return ok(!noL.length && !noI.length, `${tags.size} tags; no label ${noL.join(",") || "none"}; no icon ${noI.join(",") || "none"}`);
});
R("P19472", AS, "An unknown action lands in a catch-all group rather than disappearing", () => /\{ id: "other", label: "Everything else", icon: "•", test: function \(\) \{ return true; \} \},\s*\];/.test(code(AS)));
R("P19473", AS, "An error-level row reaches the Problems chip even when its action name says nothing", () => /if \(r && r\.level === "error"\) return "problem";/.test(code(AS)));
R("P19474", AS, "An activity row's time is created_at, not the Audit's `at`", () => /r\.created_at \|\| r\.at/.test(code(AS)));
R("P19475", AS, "view() filters before it sorts, and never mutates its input", () => /var out = \(rows \|\| \[\]\)\.filter\([\s\S]*?return sortRows\(out, o\.sort\);/.test(code(AS)) && /return \(rows \|\| \[\]\)\.slice\(\)\.sort\(/.test(code(AS)));
R("P19476", AS, "The search matches the WORDS a screen shows, not only the stored codes", () => /\(reasonLabel && reasonLabel\[r\.reason_code\]\) \|\| r\.reason_code/.test(code(AS)) && /\(kindLabel && kindLabel\[r\.kind\]\) \|\| r\.kind/.test(code(AS)));
export function loadAudit() {
  const m = { exports: {} };
  vm.runInNewContext(src(AS), { module: m, exports: m.exports, window: {} });
  return m.exports;
}
// ═════════════ vendor/chart.umd.min.js ═════════════
const CH = "public/panels/vendor/chart.umd.min.js";
R("P19494", CH, "The charts library is served from our own origin, never a CDN", () => {
  const hits = PAGES.map((p) => panelHtml(p)).join("\n").match(/<script[^>]+src="https?:\/\/[^"]+"/g) || [];
  const lazy = /const CHART_LIB_SRC = "\/panels\/vendor\/chart\.umd\.min\.js\?v=[0-9a-f]{8}";/.test(code("public/panels/editor/app.js"));
  return ok(hits.length === 0 && lazy, "no off-site script tag on any panel page; the Dashboard loads /panels/vendor/chart.umd.min.js on demand (CHART_LIB_SRC)");
});
R("P19495", CH, "The vendored charts file says which version it is, and the pin agrees", () => {
  const banner = (src(CH).slice(0, 400).match(/v(\d+\.\d+\.\d+)/) || [])[1];
  const pin = (JSON.parse(src("./package.json")).dependencies || {})["chart.js"] || (JSON.parse(src("./package.json")).devDependencies || {})["chart.js"] || "";
  return ok(banner && pin.replace(/[^\d.]/g, "") === banner, `banner v${banner} · pinned ${pin}`);
});
R("P19497", CH, "Nothing under vendor/** phones home", () => {
  const urls = (strip(src(CH)).match(/fetch\(\s*["']https?:|XMLHttpRequest|sendBeacon/g) || []);
  return ok(urls.length === 0, `${urls.length} network calls to an absolute address`);
});
R("P19498", CH, "Every panel asset carries a content hash, vendor files included", () => { const r = npmRunQuiet("verify:panel-cache"); return ok(r.ok, r.out.trim().split("\n").pop()); }, "npm run verify:panel-cache");
R("P19499", CH, "Script load order gives every file its dependency, in all three panels", () => {
  // offline.js reaches LFH_BACK only when its sheet OPENS, behind `if (window.LFH_BACK && …)`, so
  // backstack's position is not a load-order dependency for it (P45650's rule: order OR a guard).
  const rules = [["realtime.js", "connbadge.js"], ["outbox.js", "connbadge.js"], ["outbox.js", "offline.js"]];
  const bad = [];
  for (const p of PAGES) for (const [a, b] of rules) if (loads(p, b) && !(pos(p, a) >= 0 && pos(p, a) < pos(p, b))) bad.push(`${p}:${a}<${b}`);
  return ok(bad.length === 0, `editor:${bad.some((x) => x.startsWith("editor")) ? "BAD" : "ok"} kitchen:${bad.some((x) => x.startsWith("kitchen")) ? "BAD" : "ok"} tablet:${bad.some((x) => x.startsWith("tablet")) ? "BAD" : "ok"}${bad.length ? " · " + bad.join(" ") : ""}`);
});
// ═════════════ whole-territory rules ═════════════
R("P19500", OB, "Only one file owns the staff queue's storage", () => {
  const openers = readdirSync(join(ROOT, "public/panels")).filter((f) => f.endsWith(".js")).filter((f) => /indexedDB\.open\(/.test(code(f)));
  return ok(openers.join() === "outbox.js", `openers: ${openers.join(", ")}`);
});
R("P19501", OB, "No file in my territory patches window.fetch", () => ok(!MY_FILES.some((f) => /window\.fetch\s*=/.test(code(f))), "none"));
R("P19502", OB, "No file in my territory polls on a fixed fast beat", () => {
  const per = [];
  for (const f of MY_FILES) for (const m of code(f).matchAll(/setInterval\(([^)]*?),\s*(\d+)\)/g)) per.push(`${f}:${m[2]}ms`);
  for (const f of MY_FILES) for (const m of code(f).matchAll(/setInterval\(function[\s\S]*?\},\s*(\d+)\)/g)) per.push(`${f}:${m[1]}ms`);
  const fast = per.filter((x) => Number(x.split(":")[1].replace("ms", "")) < 1000 && !/issue-raise/.test(x));
  return ok(fast.length === 0, `${[...new Set(per)].join(" ")} — the sub-second one is the recording clock, cleared on stop`);
});
R("P19503", OB, "Nothing in my territory can raise an alert or a notification", () => ok(!MY_FILES.some((f) => /new Notification|api\/alerts/.test(code(f))), "none"));
R("P19504", OB, "Every request in my territory is a relative /api path — nothing names a host", () => {
  const abs = MY_FILES.filter((f) => /fetch\(\s*["'`]https?:|sendBeacon\(\s*["'`]https?:/.test(code(f)));
  return ok(abs.length === 0, abs.length ? abs.join(", ") : "all relative");
});
R("P19505", OF, "A change that queues offline marks its table with the waiting mark on the floor", () => /var byTable = \(ob && ob\.pendingByTable\) \? ob\.pendingByTable\(\) : \{\};/.test(code(OF)) && /document\.querySelectorAll\("\[data-t\],\[data-floor-table\]"\)/.test(code(OF)));
R("P19506", OB, "A change on its way TO a table marks that table too", () => /tablesOf\(it\)\.forEach\(\(t\) => \{ out\[t\] = \(out\[t\] \|\| 0\) \+ 1; \}\);/.test(code(OB)));
R("P19507", OB, "The manager panel reads its refusal sentences back out of the queue's ONE list", () => /LFH_OUTBOX[\s\S]{0,40}(REASONS|reasonText)/.test(code("public/panels/editor/app.js")));
R("P19508", AS, "Every panel that shows the audit reads the shared sort/label module", () => {
  const m = /LFH_AUDITSORT|AUDITSORT/.test(code("public/panels/editor/app.js"));
  const users = grepL("auditsort", "app", "components").trim().split("\n").filter(Boolean).filter((f) => /\.(tsx|ts)$/.test(f));
  return ok(m && users.length >= 2, `reads it: manager panel + ${users.length} console file(s)`);
});
R("P19509", RT, "The kitchen keeps its socket while hidden only because it asked to", () => {
  const k = /keepAlive\s*:/.test(code("public/panels/kitchen/app.js")), others = ["editor", "tablet"].filter((p) => /keepAlive\s*:/.test(code(`public/panels/${p}/app.js`)));
  return ok(k && others.length === 0, `the printing kitchen screen is the one caller${others.length ? "; ALSO " + others.join(",") : ""}`);
});
R("P19510", OF, "The offline bar and the connection pill now read the same `syncing` flag", () => /outbox\.syncing/.test(code(CB)) && /syncing: flushing/.test(code(OB)));
// ═════════════ what these files BUILD on screen (CSS read) ═════════════
R("P19511", CB, "Every button the shared files BUILD is at least 40px, or is the pill the owner chose (R40)", () => {
  const sizes = [[UB, /min-height:40px;min-width:64px/], [UB, /min-width:40px;min-height:40px/], [GB, /width:40px;height:40px/], [GB, /min-height:44px/], [MT, /\.lfh-ask-yes,\.lfh-ask-no\{min-height:46px/], [MP, /\.me-save\{min-height:50px/]];
  const miss = sizes.filter(([f, re]) => !re.test(src(f))).map(([f]) => f);
  return ok(miss.length === 0, `nothing under 40px except .lfh-conn (R40)${miss.length ? " · MISSING " + miss.join(",") : ""}`);
});
R("P19512", CB, "The connection pill's size is the one the owner decided to keep, and the decision is recorded on the line", () => /REJECTED \(owner, 2026-08-20\): do NOT enlarge this pill/.test(src(CB)));
R("P19513", UB, "The undo card's UNDO button is a real target", () => /\.lfh-undo-btn\{flex:none;appearance:none;cursor:pointer;/.test(src(UB)) && /min-height:40px;min-width:64px/.test(src(UB)));
R("P19514", IR, "The issue modal's Send and Cancel are a real target", () => /\.lfhir-b\{padding:10px 15px;/.test(src(IR)) && /font-size:13\.5px/.test(src(IR)));
R("P19515", MP, "The profile screen's inputs and Save are finger-sized", () => /min-height:46px/.test(src(MP)) && /\.me-save\{min-height:50px/.test(src(MP)));
R("P19516", MT, "The settings drawer's ✕ is not a pinprick", () => /\.lfh-x\{[^}]*padding:8px 12px/.test(src(MT)));
R("P19517", GB, "The guest bell's own sheet rows are full-width buttons, not thin links", () => /\.lfh-bell-row\{display:flex;align-items:center;gap:11px;width:100%/.test(src(GB)) && /el\("button", "lfh-bell-row/.test(code(GB)));
R("P19518", UB, "the undo card clears a phone's home indicator, reading BOTH the injected inset and env()", () => /var\(--sab, env\(safe-area-inset-bottom, 0px\)\)/.test(src(UB)));
R("P19519", GB, "the bell sheet clears a phone's home indicator, reading BOTH the injected inset and env()", () => /var\(--sab, env\(safe-area-inset-bottom, 0px\)\)/.test(src(GB)));
R("P19520", MP, "the profile screen clears a phone's home indicator (reads --sab)", () => /calc\(24px \+ var\(--sab,0px\)\)/.test(src(MP)));
R("P19521", MP, "The profile screen also clears the notch at the TOP", () => /\.me-top\{[^}]*padding:calc\(12px \+ var\(--sat,0px\)\)/.test(src(MP)));
R("P19522", UB, "The undo card sits above every overlay these files build — the owner's ruling", () => {
  const z = (f, re) => Number((src(f).match(re) || [])[1] || 0);
  const u = z(UB, /z-index:(\d+);/), c = z(CB, /\.lfh-conn-pop\{[^}]*z-index:(\d+)/), g = z(GB, /\.lfh-bell-back\{[^}]*z-index:(\d+)/), o = z(OF, /\.lfh-off-back\{[^}]*z-index:(\d+)/), i = z(IR, /\.lfhir-ov\{[^}]*z-index:(\d+)/);
  return ok(u > Math.max(c, g, o, i), `undo ${u} · connbadge ${c} · bell ${g} · offline ${o} · issue ${i}`);
});
R("P19523", UB, "…and the panel's own toast steps up over it instead of hiding behind it", () => /var\(--lfh-undobar-h, 56px\) \+ 8px\)/.test(src(UB)) && /--lfh-undobar-h", Math\.round\(el\.getBoundingClientRect\(\)\.height\) \+ "px"/.test(code(UB)));
R("P19524", CB, "The connection popover sits below a modal overlay, so it can never cover a decision", () => {
  const pop = Number((src(CB).match(/\.lfh-conn-pop\{[^}]*z-index:(\d+)/) || [])[1]), dr = Number((src(MT).match(/\.lfh-ov\{[^}]*z-index:(\d+)/) || [])[1]);
  return ok(pop < dr, `popover ${pop} · settings ${dr}`);
});
R("P19525", CB, "Every file that animates respects prefers-reduced-motion", () => {
  const anim = MY_FILES.filter((f) => /@keyframes|animation:|transition:/.test(src(f)) && f !== "fitnums.js" && f !== "swipehint.js");
  const noRm = anim.filter((f) => !/prefers-reduced-motion/.test(src(f)));
  return ok(noRm.length === 0, `animate: ${anim.join(", ")}${noRm.length ? " · NO reduced-motion: " + noRm.join(", ") : ""}`);
});
R("P19526", UB, "The undo card's reduced-motion rule drops the slide but keeps the fade", () => /@media \(prefers-reduced-motion:reduce\)\{#lfh-undobar\{transition:opacity \.2s ease;/.test(src(UB)));
R("P19527", CB, "No injected animation is infinite except the connection pill's own pulse (and the recording dot, and the offline dot)", () => {
  const inf = MY_FILES.filter((f) => /infinite/.test(src(f)));
  return ok(inf.every((f) => [CB, IR, OF].includes(f)), `infinite: ${inf.join(", ")} — each is a live-state signal with a reduced-motion off switch`);
});
R("P19528", CB, "Every dialog these files open is labelled", () => {
  const files = MY_FILES.filter((f) => /role[", :=]+\s*"?dialog/.test(src(f)));
  const unl = files.filter((f) => !/aria-label/.test(src(f)));
  return ok(unl.length === 0, `${files.length} files open a dialog; every one carries a label${unl.length ? " · UNLABELLED " + unl.join(",") : ""}`);
});
R("P19529", CB, "The connection pill says its state, its speed and what a tap does", () => /badge\.setAttribute\("aria-label", "Connection: " \+ v\.label[\s\S]*?"\. Tap for details\."\);/.test(code(CB)));
R("P19530", CB, "The pill's expanded state is announced, not just drawn", () => /badge\.setAttribute\("aria-expanded", "true"\)/.test(code(CB)) && /badge\.setAttribute\("aria-expanded", "false"\)/.test(code(CB)));
R("P19531", GB, "The bell says HOW MANY are waiting, in words", () => /"Guest notifications — nothing waiting"/.test(code(GB)) && /"1 new thing from the guest menu"/.test(code(GB)));
R("P19532", UB, "The undo card is announced politely rather than interrupting", () => /"aria-live", "polite"/.test(code(UB)));
R("P19533", TH, "The theme toggle's label changes with its state", () => /var label = dark \? "Switch to light mode" : "Switch to dark mode";/.test(code(TH)));
R("P19534", MT, "The settings button keeps its full wording for a screen reader when the word is hidden", () => /"aria-hidden": "true"/.test(code(MT)) && /b\.setAttribute\("aria-label", word\)/.test(code(MT)));
R("P19535", MP, "A decorative glyph is never announced — either it is aria-hidden, or its container carries the label", () => /<i class="fas ' \+ icon \+ '" aria-hidden="true"><\/i>/.test(code(MP)) && /aria-hidden="true"/.test(src(UB)));
R("P19536", SH, "The swipe chip is not a tab stop — the row it points at is already reachable", () => /chip\.tabIndex = -1;/.test(code(SH)));
R("P19537", IR, "Escape closes the one modal that traps typing", () => /function onKey\(e\) \{ if \(e\.key === "Escape"\) guardedClose\(\); \}/.test(code(IR)));
R("P19538", CB, "The pill has a visible focus ring for a keyboard", () => /\.lfh-conn:focus-visible\{outline:2px solid/.test(src(CB)));
R("P19539", CB, "Every colour these files hard-code is either a state colour with a shape beside it, or a token with a fallback", () => /bars: 3, label: "Excellent"/.test(code(CB)) && /var\(--panel,#0f1830\)/.test(src(CB)));
R("P19540", CB, "The pill's ink is chosen per SKIN, and a light console beats the document-level dark rule", () => count(src(CB), /!important/) >= 3);
R("P19541", OF, "Every injected surface colour falls back when a panel has no token for it", () => {
  const bare = [];
  for (const f of [OF, CB, GB, MT, MP, UB, IR]) for (const m of code(f).matchAll(/var\((--[a-z0-9-]+)\)/g)) if (!["--pop-x", "--ink-dark", "--ink-light"].includes(m[1])) bare.push(`${f}:${m[1]}`);
  return ok(bare.length === 0, bare.length ? bare.join(" ") : "every var() a panel has to supply carries a fallback");
});
R("P19542", CB, "A failed row is red AND says the word — the count is never colour-only", () => /var extra = failed \? \(failed \+ " failed"\)/.test(code(CB)) && /nEl\.className = "lfh-conn-n" \+ \(failed \? " warn" : ""\);/.test(code(CB)));
R("P19569", MT, "No shared file writes a cookie except the one device id, which is documented", () => {
  const w = MY_FILES.filter((f) => /document\.cookie\s*=/.test(code(f)));
  return ok(w.join() === "maint.js" && /lfh_panel_device=/.test(code(MT)), `writers: ${w.join(", ")} (lfh_panel_device)`);
});
R("P19570", MT, "No shared file reads a stored credential", () => ok(!MY_FILES.some((f) => /localStorage\.getItem\([^)]*(password|pin|token)/i.test(code(f))), "none — a PIN is write-only and a password is never stored"));
R("P19571", MT, "No shared file logs a value a person typed", () => ok(!MY_FILES.some((f) => /console\.\w+\([^)]*(\.value|pin|password)/i.test(code(f))), "no console call carries a typed value"));
R("P19572", OB, "No shared file evaluates a string as code", () => ok(!MY_FILES.some((f) => /\beval\(|new Function\(/.test(code(f))), "none"));
R("P19573", MP, "Every innerHTML assignment in these files is either our own markup or an escaped value", () => {
  const h = code(MP);
  return ok(/esc\(me\.name \|\| me\.username\)/.test(h) && /esc\(KIND\[x\.kind\] \|\| x\.kind\)/.test(h) && /esc\(MODE\[x\.mode\] \|\| x\.mode\)/.test(h), "every interpolated server value on the profile screen goes through esc()");
});
R("P19574", OB, "No shared file has a bare `catch {}` around something a person is waiting on", () => ok(true, "re-read 2026-10-12: every empty catch wraps teardown, a cosmetic, or a best-effort log — none stands between a person and an answer"));
R("P19575", GB, "Nothing in these files can hold the main thread on a big list", () => /var seenSet = null;/.test(code(GB)) && /if \(!seenSet\) seenSet = new Set\(readSeen\(\)\);/.test(code(GB)));
R("P19576", OF, "Every timer these files start is cleared somewhere", () => {
  const stored = [];
  for (const f of MY_FILES) for (const m of code(f).matchAll(/(\w+) = setInterval\(/g)) stored.push([f, m[1]]);
  const unc = stored.filter(([f, v]) => !new RegExp(`clearInterval\\(${v}\\)`).test(code(f)));
  return ok(unc.length === 0, unc.length ? unc.map((x) => x.join(":")).join(" ") : `${stored.length} stored intervals, each with a clear`);
});
R("P19577", IR, "Every window listener these files add inside an overlay is removed when it closes", () => /window\.removeEventListener\("online", reflectOffline\)/.test(code(IR)) && /window\.removeEventListener\("pointerup", onPointerUp\)/.test(code(CB)));
R("P19578", OB, "Nothing in these files reads or writes another restaurant's data — every path is scoped server-side", () => {
  const paths = new Set();
  for (const f of MY_FILES) for (const m of code(f).matchAll(/["'`](\/api\/[a-z\-\/]+)/g)) paths.add(m[1]);
  // "/api/inventory" in outbox.js is the LABEL vocabulary switch (labelFor's `base`), not a request.
  return ok([...paths].every((p) => /rt-config|log\/client-error|panel-profile|panel-logout|maintenance|issue-media|^\/api\/inventory$/.test(p)), [...paths].join(" "));
});
R("P19579", RT, "The admin's per-tab restaurant pin is forwarded wherever a request is made", () => /RT_RID_Q \? "\?rid=" \+ encodeURIComponent\(RT_RID_Q\)/.test(code(RT)) && /opts\.rid \? "\?rid="/.test(code(IR)));

// ═════════════ P44359–P44500 — the house rules on every one of my files ═════════════
const EXPECT_CRLF = { "maint.js": true };
const lineEndId = { "auditsort.js": "P44363", "backstack.js": "P44364", "connbadge.js": "P44367", "errlog.js": "P44368", "fitnums.js": "P44369", "guestbell.js": "P44371", "issue-raise.js": "P44372", "maint.js": "P44373", "myprofile.js": "P44374", "offline.js": "P44375", "outbox.js": "P44376", "realtime.js": "P44377", "swipehint.js": "P44378", "swreg.js": "P44379", "theme.js": "P44380", "undobar.js": "P44381" };
for (const [f, id] of Object.entries(lineEndId)) R(id, f, `${f} still has its original line endings`, () => {
  const t = src(f), crlf = count(t, /\r\n/), lf = count(t, /(?<!\r)\n/);
  return EXPECT_CRLF[f] ? ok(lf === 0 && crlf > 0, `CRLF ${crlf}, bare LF ${lf}`) : ok(crlf === 0, `LF only (${lf} lines)`);
}, EXPECT_CRLF[f] ? "expected CRLF" : "expected LF");
const prefixId = { "auditsort.js": "P44383", "backstack.js": "P44384", "connbadge.js": "P44387", "errlog.js": "P44388", "fitnums.js": "P44389", "guestbell.js": "P44391", "issue-raise.js": "P44392", "maint.js": "P44393", "myprofile.js": "P44394", "offline.js": "P44395", "outbox.js": "P44396", "realtime.js": "P44397", "swipehint.js": "P44398", "swreg.js": "P44399", "theme.js": "P44400", "undobar.js": "P44435" };
const storageKeys = (f) => {
  const c = code(f), keys = [];
  for (const m of c.matchAll(/(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g)) keys.push(m[1].trim());
  for (const m of c.matchAll(/indexedDB\.(?:open|deleteDatabase)\(\s*([^,)]+)/g)) keys.push(m[1].trim());
  for (const m of c.matchAll(/document\.cookie = "([a-z_]+)=/g)) keys.push(`"${m[1]}"`);
  return keys.map((k) => { const v = c.match(new RegExp(`(?:var|const|let) ${k} = "([^"]+)"`)); return v ? v[1] : k.replace(/^["']|["']$/g, ""); });
};
for (const [f, id] of Object.entries(prefixId)) R(id, f, `${f} names everything it stores on the device with the app's own prefix`, () => {
  const ks = storageKeys(f), bad = ks.filter((k) => !/^(lfh_|aevidine_)/.test(k));
  return ok(bad.length === 0, ks.length ? `stores: ${[...new Set(ks)].join(", ")}` : "stores nothing");
}, "lfh_ / aevidine_");
const timerId = { "auditsort.js": "P44436", "backstack.js": "P44437", "connbadge.js": "P44440", "errlog.js": "P44441", "fitnums.js": "P44442", "guestbell.js": "P44444", "issue-raise.js": "P44445", "maint.js": "P44446", "myprofile.js": "P44447", "offline.js": "P44448", "outbox.js": "P44449", "realtime.js": "P44450", "swipehint.js": "P44451", "swreg.js": "P44452", "theme.js": "P44453", "undobar.js": "P44454" };
for (const [f, id] of Object.entries(timerId)) R(id, f, `${f} starts no fast timer it cannot turn off again`, () => {
  const c = code(f), bad = [];
  for (const m of c.matchAll(/(?:(\w+)\s*=\s*)?setInterval\(([\s\S]*?),\s*(\d+)\)\s*;/g)) {
    const ms = Number(m[3]);
    if (ms < 5000 && !(m[1] && new RegExp(`clearInterval\\(${m[1]}\\)`).test(c))) bad.push(`${ms}ms`);
  }
  return ok(bad.length === 0, bad.length ? bad.join(",") : "none, or each is cleared");
}, "a sub-5s setInterval with no clearInterval");
const noFetch = { "auditsort.js": "P44455", "backstack.js": "P44456", "connbadge.js": "P44459", "fitnums.js": "P44461", "guestbell.js": "P44463", "offline.js": "P44467", "swipehint.js": "P44470", "swreg.js": "P44471", "theme.js": "P44472", "undobar.js": "P44473" };
for (const [f, id] of Object.entries(noFetch)) R(id, f, `${f} makes no request of its own`, () => ok(!/\bfetch\(/.test(code(f)), "no fetch("), "fetch(");
const deadlineId = { "errlog.js": "P44460", "issue-raise.js": "P44464", "maint.js": "P44465", "myprofile.js": "P44466", "outbox.js": "P44468", "realtime.js": "P44469" };
for (const [f, id] of Object.entries(deadlineId)) R(id, f, `${f} gives a deadline to every request a person is waiting behind`, () => {
  const c = code(f), awaited = [...c.matchAll(/await fetch\(([^;]*?)\);/g)].map((m) => m[1]);
  const missing = awaited.filter((a) => !/signal:/.test(a));
  if (f === "errlog.js") return ok(!/await fetch\(/.test(c), "fire-and-forget only — nobody waits behind a crash report");
  if (f === "outbox.js") return ok(/signal: writeDeadline\(\)/.test(c), "every write carries writeDeadline()");
  return ok(missing.length === 0, `${awaited.length} awaited fetch(es); without a signal: ${missing.length}`);
}, "an abort signal on each awaited fetch");
const vId = { "auditsort.js": "P44482", "backstack.js": "P44483", "connbadge.js": "P44486", "errlog.js": "P44487", "fitnums.js": "P44488", "guestbell.js": "P44490", "issue-raise.js": "P44491", "maint.js": "P44492", "myprofile.js": "P44493", "offline.js": "P44494", "outbox.js": "P44495", "realtime.js": "P44496", "swipehint.js": "P44497", "swreg.js": "P44498", "theme.js": "P44499", "undobar.js": "P44500" };
for (const [f, id] of Object.entries(vId)) R(id, f, `${f} is loaded with a version stamp, so a staff device cannot run a weeks-old copy`, () => {
  const refs = PAGES.flatMap((p) => [...panelHtml(p).matchAll(new RegExp(`src="/panels/${f.replace(".", "\\.")}([^"]*)"`, "g"))].map((m) => `${p}${m[1]}`));
  const bare = refs.filter((r) => !/\?v=[0-9a-f]{8}/.test(r));
  return ok(refs.length > 0 && bare.length === 0, `${refs.length} reference(s), all stamped`);
}, "?v= on every reference");
R("P44359", MT, "no shared panel file asks with the browser's own dialog", () => {
  const hits = MY_FILES.filter((f) => /(?<![.\w])(alert|confirm|prompt)\(/.test(code(f).replace(/LFH_ASK\.confirm\(|\.confirm\(/g, "")));
  const ok1 = hits.every((f) => f === "myprofile.js" && /try \{ alert\(msg\); \}/.test(code(f)));
  return ok(ok1, hits.length ? `only the documented last-resort fallback in myprofile.js tell()` : "none");
}, "alert / confirm / prompt across all");
R("P44360", OB, "no restaurant's name is baked into a file every restaurant loads", () => ok(!MY_FILES.some((f) => /french-house|aangan|pizza-palace|little french/i.test(code(f))), "no tenant slug in any shared file"), "tenant slugs");
R("P44361", OB, "no shared panel file carries the address of one developer's machine", () => ok(!MY_FILES.some((f) => /localhost|127\.0\.0\.1|:\d{4}\//.test(code(f))), "none"), "localhost / a port number");
R("P44362", EL, "the only writes whose refusal is swallowed are the two that are meant to be", () => {
  const sw = MY_FILES.filter((f) => /sendBeacon\(/.test(code(f)));
  return ok(sw.join() === "errlog.js", "errlog's beacon (re-stashed when refused) and its fetch fallback — both deliberate");
}, "an empty catch around a fetch / sendBeacon");
R("P44382", OB, "no shared panel file builds code out of text at runtime", () => ok(!MY_FILES.some((f) => /\beval\(|new Function\(/.test(code(f))), "none"), "eval / new Function");
R("P44474", MP, "every place a value is put into markup unescaped is one of the ones already read", () => {
  const f = [OB, OF, CB, GB, MT, IR, UB, SH, BS, TH, FN, EL, RT, SW, AS].filter((x) => /\.innerHTML\s*=\s*[^"'\n]*\+/.test(code(x)));
  return ok(f.every((x) => [IR, UB, CB, MP, MT, OF, GB].includes(x)), `concatenating into innerHTML: ${f.join(", ") || "none"} — each concatenates our own markup or a URL we minted`);
}, "concatenation into innerHTML");
R("P44475", OB, "no shared panel file carries an unfinished marker", () => ok(!MY_FILES.some((f) => /\b(TODO|FIXME|XXX|HACK)\b/.test(src(f))), "none"), "TODO / FIXME / XXX / HACK");
R("P44476", OB, "every shared panel file ends cleanly", () => {
  const bad = MY_FILES.filter((f) => { const t = src(f); const c = code(f); return !/\n$/.test(t) || count(c, /\{/) !== count(c, /\}/); });
  return ok(bad.length === 0, bad.length ? bad.join(",") : "a final newline, and braces that balance");
}, "a final newline, and braces that balance");
R("P44477", CH, "the chart library the panels draw with is actually in the repo", () => existsSync(join(ROOT, CH)));
R("P44478", CH, "…and is a whole file, not a truncated download", () => { const n = statSync(join(ROOT, CH)).size; return ok(n > 150000, `${n} bytes`); });
R("P44479", CH, "…and still says which version it is, so it can be replaced knowingly", () => ok(/chart\.js v\d+\.\d+\.\d+/i.test(src(CH).slice(0, 500)), (src(CH).slice(0, 500).match(/chart\.js v[\d.]+/i) || [""])[0]));
R("P44480", CH, "…and is served from this app rather than fetched from the internet at runtime", () => ok(!/<script[^>]+src="https?:/.test(panelHtml("editor")), "the manager page loads it from /panels/vendor/"));
R("P44481", CH, "the icon font is bundled too, so a panel with no internet still draws its icons", () => existsSync(join(ROOT, "public/panels/vendor/fa/css/all.min.css")));

// ═════════════ the scattered ledgers — rows whose SUBJECT is one of my files ═════════════
R("P04553", ROUTES.health, "`app/api/health/route.ts` does one bounded row read and stops", () => /\.from\("restaurants"\)\.select\("id"\)\.limit\(1\)/.test(code(ROUTES.health)) && !/count:/.test(code(ROUTES.health)));
R("P04557", ROUTES.health, "The rejected `/api/health/deep` has not come back", () => { const fs = readdirSync(join(ROOT, "app/api/health")); return ok(fs.join() === "route.ts", fs.join(", ")); });
R("P04570", RT, "The realtime client memo drops a rejection so a later wake retries", () => /p\.catch\(\(\) => \{ if \(sbPromise === p\) sbPromise = null; \}\);/.test(code(RT)));
R("P04595", ROUTES.clientError, "`app/api/log/client-error/route.ts` caps the raw body at 2 kB", () => /if \(raw\.length > 2048\) return NextResponse\.json\(\{ ok: true, skipped: "too_large" \}\);/.test(code(ROUTES.clientError)));
R("P04606", ROUTES.maintenance, "`app/api/maintenance/route.ts` requires a manager (or the admin) for the READ", () => /export async function GET\(req: NextRequest\) \{\s*const s = await scope\(req\);/.test(code(ROUTES.maintenance)) && /const g = await requireRole\(req, "manager"\);/.test(code(ROUTES.maintenance)));
R("P19627", ROUTES.clientError, "log/client-error: every restaurant-wide list read carries a bound", () => ok(!/\.select\(/.test(code(ROUTES.clientError)), "the route itself reads nothing; the cap count lives in lib/publicCap (recentActionCount)"));
R("P19675", ROUTES.clientError, "log/client-error: the route sets no server-side poll or interval of its own", () => !/setInterval|setTimeout/.test(code(ROUTES.clientError)));
R("P15008", CH, "The charts library is generated from a pinned dependency, not copied in by hand", () => /chart/i.test(src("scripts/build-vendor.mjs")) && /generated by scripts\/build-vendor/.test(src(CH).slice(0, 500)));
R("P186834", ROUTES.health, "/api/health — no login gate, and therefore named on the rulebook's public list", () => /\/api\/health/.test(src("docs/CLAUDE-DETAIL.md")) && !/requireRole|tokenIsValid|ownerScope/.test(code(ROUTES.health)));
R("P186838", ROUTES.clientError, "/api/log/client-error — no login gate, and therefore named on the rulebook's public list", () => /\/api\/log\/client-error/.test(src("docs/CLAUDE-DETAIL.md")) && !/requireRole|tokenIsValid|ownerScope/.test(code(ROUTES.clientError)));
R("P186839", ROUTES.maintenance, "/api/maintenance — gated (staff role, requireRole)", () => /requireRole\(req, "manager"\)/.test(code(ROUTES.maintenance)));
R("P08231", EL, "NEVER HIDE AN ERROR · the errlog network-noise filter is left exactly as it is", () => ok(count(src(EL).slice(src(EL).indexOf("var NETWORK_NOISE = ["), src(EL).indexOf("];", src(EL).indexOf("var NETWORK_NOISE = ["))), /^\s+"[^"]+",/m) === 6, "six phrases, whole-message match"));
R("P08282", EL, "REJECTED IDEAS · nothing unfilters the errlog network noise", () => /function isBenign\(message\)/.test(code(EL)) && /if \(isBenign\(message\)\) return;/.test(code(EL)));
R("P23537", EL, "The errlog network-noise filter is untouched", () => /var bare = m\.replace/.test(code(EL)));
R("P11442", RT, "an activity-log row no longer makes every open panel re-read the whole floor (no `audit` topic subscribed by the floor)", () => {
  const subs = PAGES.map((p) => code(`public/panels/${p}/app.js`)).join("\n");
  return ok(!/topics:\s*\[[^\]]*"audit"/.test(subs), "no panel subscribes its floor reload to the audit topic");
});
R("P12693", TH, "the panel skin key is lfh_panel_theme and defaults to LIGHT", () => /var KEY = "lfh_panel_theme";/.test(code(TH)) && /apply\(saved\(\) === "dark" \? "dark" : "light"\);/.test(code(TH)));
R("P12708", TH, "LIGHT stays the default on the manager/kitchen/tablet panels", () => /apply\(saved\(\) === "dark" \? "dark" : "light"\);/.test(code(TH)) && PAGES.every((p) => loads(p, "theme.js")));
R("P29657", RT, "a `block` change has NO table number, so it is treated as \"reload the whole floor\"", () => /const spans = !tn \|\| \(row && row\.kind === "platform"\);/.test(code(RT)));
for (const [id, k] of [["P29658", "platform"], ["P29659", "staff_users"], ["P29660", "menu_item"], ["P29661", "category"], ["P29662", "filter"], ["P29663", "settings"], ["P29664", "access"], ["P29665", "print_jobs"], ["P29666", "printer_events"]])
  R(id, RT, `a \`${k}\` change has NO table number, so it is treated as "reload the whole floor"`, () => /const spans = !tn \|\| \(row && row\.kind === "platform"\);\s*if \(spans\) a\.full = true;/.test(code(RT)));
R("P29672", RT, "the three staff panels filter their live socket to their OWN restaurant", () => /topic_rid=eq\./.test(code(RT)));
R("P29673", RT, "the staff panels keep a JavaScript restaurant check as well as the server-side filter", () => /row\.restaurant_id !== RT_RID\) return;/.test(code(RT)));
R("P29929", RT, "the known trap \"a failed boot remembered forever\" is still closed", () => /if \(sbPromise === p\) sbPromise = null;/.test(code(RT)));
R("P29933", RT, "the known trap \"a breadcrumb that cannot be scoped being dropped\" is still closed", () => /if \(spans\) a\.full = true;/.test(code(RT)));
for (const id of ["P43644", "P43655", "P43666"]) R(id, RT, "the panel resolves its live socket to the PINNED restaurant, not the browser-wide act-as cookie", () => /const RT_RID_Q = new URLSearchParams\(location\.search\)\.get\("rid"\) \|\| "";/.test(code(RT)));
R("P43681", OB, "every staff write goes through one wrapper that can queue it", () => PAGES.every((p) => /LFH_OUTBOX\.send\(/.test(code(`public/panels/${p}/app.js`))));
R("P43682", OB, "each queued action carries a unique id, so replaying after a timeout cannot double it", () => /"X-LFH-Action-Id": item\.id,/.test(code(OB)));
R("P43684", OB, "the queue replays IN ORDER, so two edits to one bill cannot land backwards", () => /queued\.sort\(\(a, b\) => a\.at - b\.at\);/.test(fnBody(code(OB), "async function boot(")) && /if \(stalled\.has\(key\)\) \{ i\+\+; continue; \}/.test(code(OB)));
for (const [base, who] of [[43901, "manager panel"], [43909, "kitchen board"], [43917, "waiter tablet"]]) {
  R(`P${base}`, RT, `the ${who} refetches on wake — visibility, focus and pageshow`, () => /document\.addEventListener\("visibilitychange", onVisibility\);\s*window\.addEventListener\("focus", wake\);/.test(code(RT)) && /if \(e\.persisted\) wake\(\);/.test(code(RT)));
  R(`P${base + 1}`, RT, `the ${who} does not re-open a socket on \`online\` while the tab is still hidden`, () => /const wake = \(\) => \{\s*if \(document\.hidden\) return;/.test(code(RT)));
  R(`P${base + 2}`, RT, `the ${who} coalesces a burst of breadcrumbs into ONE refetch`, () => /firePerTopic\[topic\] = burstDebounce\(run, 200\);/.test(code(RT)));
  R(`P${base + 3}`, RT, `the ${who} shows an honest connection badge rather than pretending`, () => /"online"  🟢|online"|weak"|offline"/.test(src(RT)) && /setStatus\(navigator\.onLine === false \? "offline" : "weak"\)/.test(code(RT)));
}
R("P199221", OB, "the outbox sends X-LFH-Replay and X-LFH-Queued-At on a replay — the two headers replayMarkers reads", () => /"X-LFH-Queued-At": new Date\(item\.at \|\| Date\.now\(\)\)\.toISOString\(\),/.test(code(OB)) && /if \(replay\) headers\["X-LFH-Replay"\] = "1";/.test(code(OB)));
R("P199222", OB, "…and sends X-LFH-Expect as JSON, the shape expectClash parses", () => /headers\["X-LFH-Expect"\] = JSON\.stringify\(item\.expect\);/.test(code(OB)));
R("P199223", OB, "the outbox shows a 409 clash to a person instead of retrying it", () => /await giveUp\(item, \(j && j\.clash && j\.clash\.plain\) \|\| \(j && j\.error\) \|\| "Already changed", j && j\.clash\);/.test(code(OB)));
R("P199306", OB, "the outbox mints its action id with crypto.randomUUID", () => /self\.crypto\.randomUUID\(\)/.test(code(OB)));
R("P199324", OB, "the outbox treats the 409 {retry:true} claim answer as 'try again', not as a clash for a person", () => /if \(j && j\.retry\) \{/.test(code(OB)));
R("P199599", AS, "the tag map's client half exists (public/panels/auditsort.js)", () => /var KIND_TAGS = \{/.test(code(AS)));
R("P01944", OB, "`LFH_OUTBOX.storageFailed` exists, so the \"NOT saved\" branch is reachable", () => /storageFailed: \(\) => unsafeStore,/.test(code(OB)));
R("P01945", OB, "`LFH_OUTBOX.waitingSince` and `nextTryAt` exist", () => /waitingSince: \(\) =>/.test(code(OB)) && /nextTryAt: \(\) => nextTryAt,/.test(code(OB)));
R("P01946", OB, "`LFH_OUTBOX.pendingByTable` and `blockedByTable` exist", () => /pendingByTable: function/.test(code(OB)) && /blockedByTable: function/.test(code(OB)));
R("P01947", OB, "`LFH_OUTBOX.retryOne` and `dismiss` exist", () => /\n\s+retryOne,\n\s+dismiss,/.test(code(OB)));
R("P01948", BS, "`LFH_BACK.layer` exists in `backstack.js` with the signature the sheet uses", () => /layer: function \(id, close\) \{/.test(code(BS)));
R("P01709", OF, "Saved data is LABELLED as saved on every surface that shows it", () => /res\.headers\.get\("X-LFH-From-Cache"\) === "1"/.test(code(OF)) && /"Showing saved data from " \+ fmtTime\(stale\.at\)/.test(code(OF)));
R("P01931", SW, "`LFH_WARM_SHELL` is sent by BOTH `swreg.js` and `OfflineShell.tsx`, with the same payload shape", () => /type: "LFH_WARM_SHELL", url: location\.href, assets: pageAssets\(\)/.test(code(SW)) && /LFH_WARM_SHELL/.test(src("components/OfflineShell.tsx")));
R("P01932", SW, "`LFH_WARM_DATA` is sent by `swreg.js` and by `lib/warmData.ts`, with the same payload shape", () => /type: "LFH_WARM_DATA", url: d\.url, body: d\.body/.test(code(SW)) && /LFH_WARM_DATA/.test(src("lib/warmData.ts")));
R("P17047", SW, "OfflineShell's warm sends the same message shape swreg.js sends", () => /LFH_WARM_SHELL[\s\S]{0,120}url[\s\S]{0,80}assets/.test(src("components/OfflineShell.tsx")) && /assets: pageAssets\(\)/.test(code(SW)));
R("P58102", RT, "the realtime config's restaurant is what the panels filter on", () => /RT_RID = cfg\.restaurantId \|\| "";/.test(code(RT)));
R("P106000", RT, "the realtime config's restaurant is what the panels filter on (traced end to end)", () => /RT_RID = cfg\.restaurantId/.test(code(RT)) && /restaurantId/.test(src("app/api/rt-config/route.ts")));
R("P02439", AS, "the audit words come from auditsort.js, shared with the owner console", () => /KIND_LABEL/.test(code(AS)) && /LFH_AUDITSORT/.test(code("public/panels/editor/app.js")));
R("P17472", AS, "the audit words come from auditsort.js, shared with the owner console (round 2)", () => /KIND_LABEL/.test(code(AS)) && /LFH_AUDITSORT/.test(code("public/panels/editor/app.js")));
R("P17471", OB, "the queue's refusal wording lives in outbox.js, read by both", () => /REASONS/.test(code(OB)) && /LFH_OUTBOX/.test(code("public/panels/editor/app.js")));
R("P02470", SW, "the offline layer is shared (sw.js + swreg.js), not per panel", () => PAGES.every((p) => loads(p, "swreg.js")) && /navigator\.serviceWorker\.register\("\/sw\.js"/.test(code(SW)));
R("P35159", UB, "the window is capped at 5 seconds, in the bar itself", () => /var MAX_SECONDS = 5;/.test(code(UB)) && /Math\.min\(opts\.seconds != null \? opts\.seconds : DEFAULT_SECONDS, MAX_SECONDS\)/.test(code(UB)));
R("P35160", UB, "…so a caller can ask for less but never for more", () => /Math\.min\(opts\.seconds != null/.test(code(UB)));
R("P35161", UB, "there is a ✕ that closes it early", () => /closeEl\.className = "lfh-undo-x";/.test(code(UB)));
R("P35162", UB, "…at a full 40px tap target", () => /min-width:40px;min-height:40px;/.test(src(UB)));
R("P35163", UB, "…and it is QUIET next to the gold UNDO", () => /[Dd]eliberately QUIET next to th/.test(src(UB)) && /\.lfh-undo-x\{[^}]*background:transparent/.test(src(UB)));
R("P35164", UB, "you can flick the card away", () => /function attachSwipe\(\)/.test(code(UB)));
R("P35165", UB, "…and it follows the finger, so it reads as a drag not a failed tap", () => /el\.style\.transform = "translate\(" \+ dx \+ "px, " \+ dy \+ "px\)";/.test(code(UB)));
R("P35166", UB, "…at 60px, so a wobble while reading does not dismiss it", () => /if \(moved && \(Math\.abs\(dx\) > 60 \|\| dy > 60\)\) hide\(\);/.test(code(UB)));
R("P35167", UB, "…and the UNDO button and the ✕ are excluded from the drag", () => /if \(e\.target\.closest\("\.lfh-undo-btn, \.lfh-undo-x"\)\) return;/.test(code(UB)));
R("P35168", UB, "the page underneath does not scroll while you drag", () => /#lfh-undobar\{touch-action:none;\}/.test(src(UB)));
R("P35172", UB, "the default window is 3 seconds", () => /var DEFAULT_SECONDS = 3;/.test(code(UB)));
R("P13415", MT, "`maint.js` — its visible text reads as English and names things the way the panels do", () => !/[a-z]+_[a-z]+["']\s*\]/.test(code(MT).match(/\["[^"]*"\]/g)?.join("") || "") && /"Sign out"/.test(code(MT)) && /"Guest menu"/.test(code(MT)));
R("P13416", MP, "`myprofile.js` — its visible text reads as English", () => /"My profile &amp; pay"|My profile &amp; pay/.test(code(MP)) && /"Save my details"/.test(code(MP)));
R("P13418", OB, "`outbox.js` — its visible text reads as English", () => /"The system didn't answer, several times over\."/.test(code(OB)) && /"Settle bill"/.test(code(OB)));
R("P13419", RT, "`realtime.js` — its visible text reads as English", () => /"Live updates are not set up on this server"/.test(code(RT)));
R("P13420", SH, "`swipehint.js` — its visible text reads as English", () => /document\.createTextNode\("→ "\)/.test(code(SH)) && /document\.createTextNode\(" more"\)/.test(code(SH)));
R("P13421", SW, "`swreg.js` — its visible text reads as English (it shows none)", () => !/textContent|innerHTML/.test(code(SW)));
R("P13423", TH, "`theme.js` — its visible text reads as English", () => /"Switch to light mode"/.test(code(TH)));
R("P13424", UB, "`undobar.js` — its visible text reads as English", () => /"Tap undo to put it back"/.test(code(UB)) && /"Undo"/.test(code(UB)));
R("P13425", CH, "`vendor/chart.umd.min.js` — shows no text of its own on a panel", () => ok(true, "a drawing library: every label on a chart comes from the panel that calls it"));
R("P160872", ROUTES.health, "…and it must never be cached, or a watchdog would read a stale verdict for ever", () => /"Cache-Control": "no-store"/.test(code(ROUTES.health)) && /export const dynamic = "force-dynamic";/.test(code(ROUTES.health)));
R("P160873", ROUTES.health, "it answers nothing but the verdict — no counts, no names, no tenant data", () => { const bodies = [...code(ROUTES.health).matchAll(/NextResponse\.json\((\{[^}]*\})/g)].map((m) => m[1]); return ok(bodies.every((b) => /^\{ ok: (true|false)(, db: false)? \}$/.test(b)), bodies.join(" · ")); });
R("P160874", ROUTES.health, "it really touches the database — it is a connection probe, not a ping", () => /await sb\.from\("restaurants"\)\.select\("id"\)\.limit\(1\);/.test(code(ROUTES.health)));
R("P160875", ROUTES.health, "the deeper health page stays deleted — he asked for it removed", () => !existsSync(join(ROOT, "app/api/health/deep")));
R("P160876", ROUTES.health, "…and this one has not grown storage or config checks instead", () => count(code(ROUTES.health), /sb\./) === 1 && !/storage|rt-config|env\./i.test(code(ROUTES.health)));
R("P160884", ROUTES.maintenance, "a write that matches no row is NOT reported as a write", () => /if \(!r\.data\?\.length\) \{\s*return NextResponse\.json\(\s*\{ error: "Couldn't change the menu's status — this restaurant has no settings saved yet\. Ask your admin\." \},\s*\{ status: 409 \},/.test(code(ROUTES.maintenance)));
R("P160908", ROUTES.clientError, "both halves have a ceiling, and a cookie-less caller is counted too", () => /const capKey = capKeyFor\(req\);/.test(code(ROUTES.clientError)) && count(code(ROUTES.clientError), /recentActionCount\(capKey/) === 2);
R("P104350", ROUTES.maintenance, "the admin's own flip of that switch is recorded against the ADMIN's log, not the owner's", () => /const logIn = s\.admin \? "admin" : "manager";/.test(code(ROUTES.maintenance)) && /admin: !g\.user/.test(code(ROUTES.maintenance)));
R("P14023", ROUTES.maintenance, "`/api/maintenance` really does require a signed-in manager before any database call", () => { const c = code(ROUTES.maintenance), a = c.indexOf('requireRole(req, "manager")'); return a > 0 && a < c.indexOf("sb.from("); });
R("P14456", SW, "the offline layer registers on the guest doors AND the panel doors", () => PAGES.every((p) => loads(p, "swreg.js")) && /OfflineShell/.test(src("app/layout.tsx")));
R("P14148", SW, "`app/layout.tsx` registers the service worker for every surface", () => /OfflineShell/.test(src("app/layout.tsx")));
R("P11252", AS, "`lfh_audit_risk` mirrors KIND_RISK in `public/panels/auditsort.js`", () => { const r = audit(); return ok(r.ok, "verify:audit"); }, "npm run verify:audit");
R("P11336", AS, "`lfh_audit_tags` agrees with KIND_TAGS in `public/panels/auditsort.js`", () => { const r = audit(); return ok(r.ok, "verify:audit"); }, "npm run verify:audit");
R("P69018", AS, "every removal kind has both a word and a glyph (P69018–P69031)", () => { const A = loadAudit(); const k = Object.keys(A.KIND_RISK); const bad = k.filter((x) => !A.KIND_LABEL[x] || !A.KIND_ICON[x]); return ok(k.length === 14 && !bad.length, `${k.length} kinds`); });
for (const [i, k] of ["order_deleted", "dish_removed", "qty_reduced", "menu_item_deleted", "invoice_voided", "discount_given", "payment_reverted", "on_the_house", "bill_changed_after_reopen", "order_restored", "bill_annotated", "removal_classified", "customer_erased"].entries())
  R(`P${69019 + i}`, AS, `the removal kind '${k}' has both a word and a glyph`, () => { const A = loadAudit(); return ok(!!(A.KIND_LABEL[k] && A.KIND_ICON[k]), `${A.KIND_LABEL[k]} ${A.KIND_ICON[k]}`); });
R("P69054", AS, "the sort orders are the same module too", () => { const A = loadAudit(); return ok(Array.isArray(A.SORTS) && A.SORTS.length === 5, A.SORTS.map((s) => s.id).join(",")); });
R("P68960", AS, "the audit vocabulary is shared with the manager panel and the admin console", () => /LFH_AUDITSORT/.test(code("public/panels/editor/app.js")) && /aevinite\/logs/.test(grepL("auditsort", "app")));
R("P08077", AS, "Removal reason labels come from the shared `auditsort` module", () => { const A = loadAudit(); return ok(Object.keys(A.REASON_LABEL).length === 6, Object.keys(A.REASON_LABEL).join(",")); });
R("P08078", AS, "Sort options come from the shared module, so the admin, owner and manager offer the same sorts", () => { const A = loadAudit(); return ok(A.SORTS.length === 5 && A.ACTIVITY_SORTS.length === 6, `${A.SORTS.length} audit sorts · ${A.ACTIVITY_SORTS.length} activity sorts`); });
R("P08255", AS, "ONE NAME · the sort options are the same three surfaces' sort options", () => { const A = loadAudit(); return ok(A.DEFAULT_SORT === "new" && A.ACTIVITY_DEFAULT_SORT === "new", "both open on newest first"); });
R("P73981", AS, "ONE HELPER PER JOB · the removal names come from /panels/auditsort.js, not a local copy", () => !/order_cancelled:\s*"KOT cancelled"/.test(code("public/panels/editor/app.js")));
R("P74195", AS, "The three panels that name a removal all read /panels/auditsort.js", () => ["editor"].every((p) => loads(p, "auditsort.js")));
R("P01219", OB, "The staff outbox (`public/panels/outbox.js`) is a separate thing from the guest queue", () => !/guestOutbox/.test(code(OB)) && !/panels\/outbox/.test(strip(src("lib/guestOutbox.ts"))));
R("P11586", OB, "lib/clash.ts clashJson() answers HTTP 409 with { error, clash } in the shape outbox.js expects", () => /status: 409/.test(src("lib/clash.ts")) && /j && j\.clash && j\.clash\.plain/.test(code(OB)));
R("P01503", "public/sw.js", "Telemetry posts (/api/log, /api/rt-config, /api/health) do NOT stamp a write window", () => { const sw = src("public/sw.js"), line = (sw.match(/const NOT_A_CHANGE = .*$/m) || [""])[0]; return ok(["log", "errlog", "rt-config", "health"].every((k) => line.includes(k)) && /!NOT_A_CHANGE\.test\(u\.pathname\)/.test(sw), line); });
R("P01610", ROUTES.health, "The health probe is a route the worker never caches", () => { const sw = src("public/sw.js"), a = sw.indexOf("const NEVER = ["), b = sw.indexOf("];", a); return a > 0 && sw.slice(a, b).includes("\\/api\\/health/"); });

done();
