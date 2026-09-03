// Replay of LEDGER/T6.md block 2 — "conformance to the project's own rules", P02701–P02800.
// The rows that need another guard to run, a browser, or a type-check are marked here as
// DEFERRED and are executed by the runner (see verify-kitchen-screen.mjs --with-gates) or by
// scripts/sweep/t9/live.mjs. Everything else is an assertion.
import { row, APP, APPC, HTML, CSS, ROUTE, ROUTEC, PAGE, has, hasRe, lacks, lacksRe, contentHash, P, src } from "./lib.mjs";
import { readFileSync } from "node:fs";

const slice = (from, to) => { const a = APPC(); const i = a.indexOf(from); const j = a.indexOf(to); return i < 0 || j < 0 ? "" : a.slice(i, j); };

// ── the redraw fingerprint (CLAUDE.md "Don't narrow boardSig") — P02701–P02705 ─
row("P02701", "boardSig is not narrowed to a hand-written field list", () => {
  const fn = slice("function boardSig(", "let lastSig = null");
  return (fn.includes("map(stableRow)") && !/\bo\.(kot_no|table_number|status)\b/.test(fn)) || "boardSig names individual columns again";
});
row("P02702", "the shipped stableRow still matches the one verify:board-sig tests", () => {
  const guard = readFileSync(P("scripts/verify-board-sig.mjs"), "utf8");
  return has(guard, "stableRow");
});
row("P02703", "RT_VOLATILE in the panel still matches the set the guard tests", () => {
  const guard = readFileSync(P("scripts/verify-board-sig.mjs"), "utf8");
  const mine = (APPC().match(/const RT_VOLATILE = new Set\(\[([^\]]*)\]\)/) || [])[1] || "";
  const keys = mine.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  const missing = keys.filter((k) => !guard.includes(k));
  return missing.length === 0 || `the guard does not know about: ${missing.join(", ")}`;
});
row("P02704", "boardSig is built FROM stableRow, not from a literal list", () =>
  ((slice("function boardSig(", "let lastSig = null").match(/map\(stableRow\)/g) || []).length >= 4) || "fewer than four row lists go through stableRow");
row("P02705", "a new volatile column would go in RT_VOLATILE, not into a field list", () =>
  hasRe(APP(), /Do NOT shrink\s*\n?\/\/ this back to a hand-picked field list/));

// ── the poll (CLAUDE.md rush rules) — P02706–P02723 ──────────────────────────
row("P02706", "the panel never polls faster than the 60s backstop while realtime is healthy", () => {
  const a = APPC();
  const bad = [...a.matchAll(/setInterval\(([\s\S]{0,200}?),\s*(\d+)\)/g)].filter((m) => Number(m[2]) < 60000 && Number(m[2]) > 1100 && /load\(/.test(m[1]));
  return bad.length === 0 || `a load() interval faster than 60s: ${bad.map((b) => b[2] + "ms").join(", ")}`;
});
row("P02707", "the 60s backstop does not fire while the tab is hidden (unless this screen is the printer)", () =>
  hasRe(APPC(), /setInterval\(\(\) => \{ if \(!document\.hidden \|\| state\.autoPrintKot\) load\(\)\.catch\(\(\) => \{\}\); \}, 60000\)/));
row("P02708", "there is no fixed fast poll anywhere in the file", () => {
  const a = APPC();
  return lacksRe(a, /setInterval\(load, \d+\)|setInterval\(\(\) => load\(\), (1|2|3|4|5)000\)/);
});
row("P02709", "the clock interval does nothing while the panel is hidden", () =>
  hasRe(APPC(), /if \(!el \|\| document\.hidden\) return;/));
row("P02710", "the clock interval does nothing while CSS has hidden the element", () =>
  hasRe(APPC(), /if \(getComputedStyle\(el\)\.display === "none"\) return;/));
row("P02711", "the no-realtime fallback backs off instead of hammering at a fixed 2s", () =>
  (hasRe(APPC(), /\} else \{[\s\S]{0,900}backoffPoll\(2000\);/) === true && lacksRe(APPC(), /setInterval\(load, 2000\)/) === true) || "the flat 2s poll is back");
// End marker must be CODE: slice() reads the comment-stripped source, so a `// ──` banner
// is not there to find and the slice comes back empty (a guard failing against nothing).
const BP = () => slice("function backoffPoll(baseMs)", "(function kitchenXray()");
row("P02712", "backoffPoll doubles its wait for as long as reads FAIL and resets on the first success", () => {
  const fn = BP();
  return (/try \{ await load\(\); step = 0; \}/.test(fn) && /catch \(e\) \{ step = Math\.min\(step \+ 1, 8\); \}/.test(fn)) || "the back-off/reset pair has drifted";
});
row("P02713", "backoffPoll caps at 60s", () => hasRe(BP(), /Math\.min\(baseMs \* Math\.pow\(2, step\), 60000\)/));
row("P02714", "backoffPoll jitters ±20% so twenty screens never poll on the same beat", () =>
  hasRe(BP(), /const spread = \(ms\) => Math\.round\(ms \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)\);/));
row("P02715", "backoffPoll does nothing while hidden or while the device reports itself offline", () =>
  hasRe(BP(), /if \(document\.hidden \|\| navigator\.onLine === false\) step = 0;/));
row("P02716", "LFH_RT.catchUp is preferred and backoffPoll is only the fallback", () =>
  hasRe(APPC(), /if \(window\.LFH_RT\.catchUp\) window\.LFH_RT\.catchUp\(\(\) => load\(\)\);\s*\n?\s*else backoffPoll\(5000\);/));
row("P02717", "whole-board reads are collapsed onto one in-flight fetch with at most one trailing refresh", () => {
  const fn = slice("function load() {", "async function loadImpl()");
  return (/if \(loadInFlight\) \{ loadQueued = true; return loadInFlight; \}/.test(fn) &&
          /if \(loadQueued\) \{ loadQueued = false; load\(\); \}/.test(fn)) || "the coalescer has drifted";
});
row("P02718", "freshLoad() exists for the one caller that must see its own write", () =>
  hasRe(APPC(), /function freshLoad\(\) \{\s*\n?\s*return loadInFlight \? loadInFlight\.catch\(\(\) => \{\}\)\.then\(\(\) => loadImpl\(\)\) : loadImpl\(\);/));
row("P02719", "the 4s full-reload rate guard is TRAILING, so a suppressed burst still lands one reload", () =>
  hasRe(APPC(), /const wait = Math\.max\(0, lastFullAt \+ 4000 - Date\.now\(\)\);[\s\S]{0,140}setTimeout\(\(\) => \{ fullTimer = null; markFullRead\(\); load\(\)/));
row("P02720", "every whole-board read counts toward the 4s window, not only the ones the timer started", () =>
  (hasRe(APPC(), /markFullRead\(\);\s*\n?\s*const seq = \+\+loadSeq;/) === true && hasRe(APPC(), /markFullRead = \(\) => \{ lastFullAt = Date\.now\(\); \};/) === true) || "loadImpl does not mark the window");
row("P02721", "a breadcrumb naming tables takes the targeted ?table=N path, not a whole-board read", () =>
  hasRe(APPC(), /ops: \(detail\) => \(detail && !detail\.full && detail\.tables && detail\.tables\.length\) \? loadTables\(detail\.tables\) : fullSoon\(\)/));
row("P02722", "a menu breadcrumb takes the full path, because the 86 board and dish list must refresh", () =>
  hasRe(APPC(), /menu: \(\) => fullSoon\(\)/));
row("P02723", "the targeted read asks for one table at a time and merges by id", () =>
  hasRe(APPC(), /slices = await Promise\.all\(tables\.map\(\(t\) => api\("GET", "\/board\?table=" \+ encodeURIComponent\(t\) \+ jobsQ\)\)\)/));

// ── writes, the outbox and honest refusals — P02724–P02741 ───────────────────
row("P02724", "every write goes through the panel api() helper so the outbox can queue it", () => {
  const a = APPC();
  // Direct fetch() calls are allowed ONLY where the ledger says so: the print-job claim (P02725)
  // and the two act-as clears on the way out of an admin view.
  const fetches = [...a.matchAll(/(?<!\.)\bfetch\("([^"]+)"/g)].map((m) => m[1]);
  const allowed = new Set(["/api/kitchen", "/api/admin/act-as"]);
  const bad = fetches.filter((u) => ![...allowed].some((p) => u.startsWith(p)));
  return bad.length === 0 || `a raw fetch outside the outbox: ${bad.join(", ")}`;
});
row("P02725", "the print-job CLAIM is deliberately a plain fetch, never the outbox", () =>
  hasRe(APPC(), /async function claimPrintJobs\(ids\) \{\s*\n?\s*const r = await fetch\("\/api\/kitchen" \+ ridQ\("\/print-jobs\/claim"\)/));
row("P02726", "the print-job DONE report does ride the outbox", () =>
  hasRe(APPC(), /api\("POST", `\/print-jobs\/\$\{j\.id\}\/done`/));
row("P02727", "api() passes an expect parameter through to the outbox even though nothing sends one yet", () =>
  hasRe(APPC(), /expect: opts && opts\.expect/));
row("P02728", "api() bounces to /login on a 401 rather than showing an empty board", () =>
  hasRe(APPC(), /if \(r\.status === 401\) \{ location\.href = "\/login"; throw new Error\("login"\); \}/));
row("P02729", "api() marks a total network failure offline so the bar can say so", () =>
  hasRe(APPC(), /netErr\.offline = true;/));
row("P02730", "api() carries the server's busy flag through to the caller", () =>
  hasRe(APPC(), /e\.busy = \(j && j\.busy === true\) \|\| r\.headers\.get\("X-LFH-Busy"\) === "1"/));
row("P02731", "api() hands a first-visit GET to the warm-cache layer", () =>
  hasRe(APPC(), /if \(uncontrolled && method === "GET" && j && window\.LFH_WARM\)/));
row("P02732", "api() tells the offline bar about every response", () =>
  hasRe(APPC(), /if \(window\.LFH_OFF\) window\.LFH_OFF\.noteResponse\(r\);/));
row("P02733", "the first-load failure path stays quiet for plain \"no internet\"", () =>
  hasRe(APPC(), /if \(window\.LFH_OFF && window\.LFH_OFF\.isOfflineErr\(e\)\) return;/));
row("P02734", "a busy database gets plain words, not a raw TimeoutError", () =>
  hasRe(APPC(), /isBusyErr\(e\)\)[\s\S]{0,80}return toast\("The system is very busy right now/));
row("P02735", "that busy string is one line and does NOT import the shared errText() helper", () =>
  lacksRe(APPC(), /errText\(/));
row("P02736", "every write handler reports a queued offline save to the person who tapped", () => {
  const a = APPC();
  // Every `r.queued` branch must say something. Count them against the write call sites.
  const queuedBranches = (a.match(/r\.queued/g) || []).length;
  return queuedBranches >= 5 || `only ${queuedBranches} handlers check for a queued save`;
});
row("P02737", "the board refetches at once when the outbox drains on reconnect", () =>
  hasRe(APPC(), /window\.addEventListener\("lfh:outbox-flushed"/));
row("P02738", "the board refetches once when a read came from the device rather than the server", () =>
  hasRe(APPC(), /window\.addEventListener\("lfh:stale-refresh"/));
row("P02739", "both of those listeners do nothing while the tab is hidden", () => {
  const a = APPC();
  const flush = a.slice(a.indexOf('"lfh:outbox-flushed"'), a.indexOf('"lfh:stale-refresh"') + 260);
  return ((flush.match(/document\.hidden/g) || []).length >= 2) || "one of the two listeners runs while hidden";
});
row("P02740", "no user tap is dropped in silence", () => {
  // Every tap handler either acts, toasts, or refuses visibly. The two defensive `if (!x) return`
  // paths on a tap both toast first (P02629/P02656); assert neither has lost its sentence.
  const a = APPC();
  return (/if \(!it\) \{ toast\(/.test(a) && /if \(!o\) \{ toast\(/.test(a)) || "a tap handler returns without saying anything";
});
row("P02741", "every state.…find() followed by a bare if (!x) return says something first", () => {
  const a = APPC();
  const bad = [];
  for (const m of a.matchAll(/\.find\(\([^)]*\) => [^;]*\);\s*\n?\s*if \(!(\w+)\) (?!\{ toast)/g)) bad.push(m[0].trim().slice(0, 60));
  return bad.length === 0 || `a silent bail after a find(): ${bad.join(" | ")}`;
});

// ── back button + overlays (.claude/rules/panels.md) — P02742–P02748 ─────────
row("P02742", "every overlay registers with the back-button manager the moment it opens", () => {
  const a = APPC();
  const layers = [...a.matchAll(/LFH_BACK\.layer\("([^"]+)"/g)].map((m) => m[1]);
  const want = ["86-board", "printer-problem", "kitchen-menu", "kitchen-settings", "kds-more"];
  const missing = want.filter((w) => !layers.includes(w));
  return missing.length === 0 || `overlays with no back layer: ${missing.join(", ")}`;
});
row("P02743", "every overlay unregisters its back layer exactly once when it closes", () => {
  const a = APPC();
  // The shape is always: if (X) { const o = X; X = null; o(); } — capture-then-null, so a double
  // close cannot call the same off() twice.
  const offs = (a.match(/if \((\w+)\) \{ const (?:o|off) = \1; \1 = null; (?:o|off)\(\); \}/g) || []).length;
  return offs >= 4 || `only ${offs} overlays release their layer safely`;
});
row("P02744", "no overlay hand-rolls pushState/popstate", () => lacksRe(APPC(), /pushState|popstate/));
row("P02745", "the 86 drawer closes on ✕, on the backdrop and on the phone's Back", () => {
  const a = APPC();
  return (/\$\("#drawerClose"\)\.onclick = closeDrawer;/.test(a) &&
          /\$\("#drawerOverlay"\)\.onclick = \(e\) => \{ if \(e\.target\.id === "drawerOverlay"\) closeDrawer\(\); \};/.test(a) &&
          /LFH_BACK\.layer\("86-board", closeDrawer\)/.test(a)) || "one of the three exits is missing";
});
row("P02746", "the printer sheet closes on ✕, on the backdrop and on Back", () => {
  const fn = slice("function openPrinterSheet()", "const NET_AFTER_MS");
  return (/\[data-prclose\]"\)\.onclick = close;/.test(fn) &&
          /ov\.onclick = \(e\) => \{ if \(e\.target === ov\) close\(\); \};/.test(fn) &&
          /LFH_BACK\.layer\("printer-problem", close\)/.test(fn)) || "one of the three exits is missing";
});
row("P02747", "the ⋯ menu closes on Escape, on an outside click and on the phone's Back", () => {
  const fn = slice("function buildMoreMenu()", "function syncMoreMenu()");
  return (/if \(e\.key === "Escape"\) closeMore\(\)/.test(fn) &&
          /if \(!e\.target\.closest\("#morePop"\) && !e\.target\.closest\("#moreBtn"\)\) closeMore\(\)/.test(fn) &&
          /LFH_BACK\.layer\("kds-more", closeMore\)/.test(fn)) || "one of the three exits is missing";
});
row("P02748", "the ⋯ menu deliberately stays open after a sound tap", () =>
  hasRe(APPC(), /if \(row && row\.dataset\.for !== "muteBtn" && e\.target\.closest\("button"\)\) setTimeout\(closeMore, 120\)/));

// ── no profile, ever (R7) — P02749–P02751 ────────────────────────────────────
row("P02749", "the kitchen suppresses the shared everyday Profile button", () => has(APPC(), "window.LFH_SUPPRESS_SETTINGS_BTN = true"));
row("P02750", "the kitchen suppresses the one-time \"Finish setup\" profile card as well", () => has(APPC(), "window.LFH_NO_PROFILE_AT_ALL = true"));
row("P02751", "both flags are set at the very top of the file, before maint.js's async init", () => {
  const a = APP();
  const i = a.indexOf("window.LFH_SUPPRESS_SETTINGS_BTN"), j = a.indexOf("window.LFH_NO_PROFILE_AT_ALL");
  return (i > 0 && j > 0 && i < 2000 && j < 2500) || `the flags are at ${i}/${j} — too far down the file`;
});

// ── one ticket document (docs/NUMBERING, one print document) — P02752–P02755 ─
row("P02752", "the kitchen ticket is drawn by the ONE shared document file, not a hand-kept copy", () => {
  const a = APPC();
  if (!/LFH_BILLDOC\.kotDocHtml\(/.test(a)) return "printKot no longer calls the shared document";
  return lacksRe(a, /<html[\s>]|@page|<style>[\s\S]*font-family/);
});
row("P02753", "the DUPLICATE banner is rendered by that shared file, not by the kitchen", () => {
  const a = APPC();
  return (/reprint: !!\(opts && opts\.reprint\)/.test(a) && !/REPRINT · DUPLICATE/.test(a)) || "the kitchen draws the banner itself";
});
row("P02754", "the KOT's date/time line comes from the shared kotWhen()", () => has(APPC(), "LFH_BILLDOC.kotWhen(order.created_at)"));
row("P02755", "the KOT carries no prices", () => {
  const fn = slice("function printKot(", "function logKotPrintFailure(");
  return lacksRe(fn, /price|total|amount|₹/i);
});

// ── the rejections (docs/REJECTED-IDEAS.md) — P02756–P02757 ──────────────────
row("P02756", "nothing in the panel reopens a rejected idea", () => {
  const a = APPC();
  const sins = [];
  if (/data-accept="/.test(a)) sins.push("a kitchen accept button (owner: the waiter accepts)");
  if (/age-ready|readyAgeClass/.test(a)) sins.push("an ageing signal on the Ready column (R5)");
  if (/col-\w+"\)\.hidden = true/.test(a)) sins.push("collapsing an empty column (R3)");
  if (/Profile|profileBtn/.test(a)) sins.push("a kitchen profile (R7)");
  if (/errText\(/.test(a)) sins.push("the shared errText() helper (R21)");
  return sins.length === 0 || `reopened: ${sins.join("; ")}`;
});
row("P02757", "each honoured rejection still carries its REJECTED (owner, <date>) comment on the exact line", () => {
  const a = APP();
  const marks = (a.match(/REJECTED \(owner, 20\d\d-\d\d-\d\d/g) || []).length;
  return marks >= 4 || `only ${marks} REJECTED markers left in the file`;
});

// ── egress (docs/SAAS-EFFICIENCY-PLAYBOOK) — P02758–P02764 ───────────────────
row("P02758", "the panel issues no read that is not either the whole board or one named table", () => {
  const a = APPC();
  const gets = [...a.matchAll(/api\("GET", ("([^"]*)"|[^)]*)\)/g)].map((m) => m[1]);
  const bad = gets.filter((g) => !/\/board/.test(g) && !/\/whoami/.test(g));
  return bad.length === 0 || `an unexpected read: ${bad.join(", ")}`;
});
row("P02759", "the board read is not repeated per ticket — the item index is built once per paint", () => {
  const a = APPC();
  // rowsOf()'s per-order filter fallback is allowed only for the two surgical single-order callers.
  const fallbacks = (a.match(/state\.items\.filter\(\(i\) => i\.order_id === o\.id\)/g) || []).length;
  return fallbacks <= 1 || `${fallbacks} per-order filters — the index is not being passed down`;
});
row("P02760", "the panel never fetches a menu bundle or an image list of its own", () =>
  lacksRe(APPC(), /\/api\/menu|menuData|supabase\.storage|\/rest\/v1\//));
row("P02761", "realtime channels are started through the shared LFH_RT, never a hand-rolled subscription", () => {
  const a = APPC();
  return (/LFH_RT\.start\(\{/.test(a) && !/new WebSocket|createClient\(|\.channel\(/.test(a)) || "a hand-rolled subscription is present";
});
row("P02762", "the panel names only the two topics it needs (ops, menu)", () => {
  const fn = slice("LFH_RT.start({", "keepAlive:");
  const topics = [...fn.matchAll(/^\s*(\w+): \(/gm)].map((m) => m[1]);
  return (topics.length === 2 && topics.includes("ops") && topics.includes("menu")) || `topics are ${topics.join(", ")}`;
});
row("P02763", "a rush is treated like offline: a 5xx/timeout is queued, a 4xx is told to the person", () => {
  const a = APPC();
  return (/e\.busy = /.test(a) && /isBusyErr/.test(a)) || "the busy classification is missing";
});
row("P02764", "the board survives the server refusing to answer without a red toast at a cook", () =>
  hasRe(APPC(), /const refreshQuietly = \(\) => freshLoad\(\)\.catch\(\(\) => \{\}\);/));

// ── safe areas, hashes, secrets, the pin — P02765–P02771 ─────────────────────
row("P02765", "every fixed/docked element uses the safe-area tokens", () => {
  const c = CSS();
  const fixed = [...c.matchAll(/\.([a-z-]+)\s*\{[^}]*position:\s*fixed[^}]*\}/g)].map((m) => m[0]);
  // A rule that pins bottom:0 AND pays the inset in its padding is correct — .kds-dw is
  // full-height (top:0;bottom:0) and pads by var(--sab). So the test is "does this rule mention
  // the inset AT ALL", by either route, not "does `bottom` itself carry it".
  const bad = fixed.filter((b) => /bottom:\s*\d/.test(b) && !/safe-area-inset|--sa[btlr]?\b|--safe-[btlr]\b/.test(b));
  return bad.length === 0 || `${bad.length} bottom-docked fixed rules ignore the safe area`;
});
row("P02766", "the left/right safe-area tokens are actually USED, not merely declared", () => {
  const c = CSS();
  const declared = [...c.matchAll(/--(sa-[a-z]+):/g)].map((m) => m[1]);
  const unused = declared.filter((d) => (c.match(new RegExp(`var\\(--${d}`, "g")) || []).length === 0);
  return unused.length === 0 || `declared but never read: ${unused.join(", ")}`;
});
row("P02767", "the panel's assets are versioned by content hash, so a stale panel cannot run", () =>
  hasRe(HTML(), /app\.js\?v=[0-9a-f]{8}/));
row("P02768", "the ?v= hashes in index.html match the real content of the files they point at", () => {
  const h = HTML();
  const bad = [];
  for (const m of h.matchAll(/(?:src|href)="(?:\/panels\/)?([\w.-]+\.(?:js|css))\?v=([0-9a-f]{8})"/g)) {
    const rel = h.includes(`/panels/${m[1]}?v=${m[2]}`) ? `public/panels/${m[1]}` : `public/panels/kitchen/${m[1]}`;
    let real; try { real = contentHash(rel); } catch { continue; }
    if (real !== m[2]) bad.push(`${m[1]} tag=${m[2]} real=${real}`);
  }
  return bad.length === 0 || `stale asset hashes: ${bad.join("; ")}`;
});
row("P02769", "no secret, key or token appears anywhere in the panel", () => {
  const t = APP() + HTML() + CSS();
  return lacksRe(t, /sbp_|service_role|eyJ[A-Za-z0-9_-]{20,}|SUPABASE_SERVICE|ADMIN_PASSWORD/);
});
row("P02770", "the panel's own restaurant pin (?rid=) rides on every API call", () => {
  const a = APPC();
  if (!/const ridQ = \(path\) => \{/.test(a)) return "ridQ is gone";
  const calls = [...a.matchAll(/"\/api\/kitchen" \+ ([a-zA-Z(]+)/g)].map((m) => m[1]);
  const bad = calls.filter((c) => !c.startsWith("ridQ"));
  return bad.length === 0 || `a call that skips the pin: ${bad.join(", ")}`;
});
row("P02771", "?view=real and ?as= are only honoured when ?rid= is present", () => {
  const a = APPC();
  return (/const PANEL_VIEW_REAL = PANEL_RID &&/.test(a) && /const PANEL_AS = PANEL_RID \?/.test(a)) || "one of the two is honoured without a pin";
});

// ── the x-ray ribbon — P02772–P02777 ─────────────────────────────────────────
const XR = () => { const a = APPC(); return a.slice(a.indexOf("(function kitchenXray()")); };
row("P02772", "the x-ray ribbon is a boot-time single request, never a poll", () => {
  const fn = XR();
  return ((fn.match(/api\("GET", "\/whoami"\)/g) || []).length === 1 && !/setInterval/.test(fn)) || "whoami is polled";
});
row("P02773", "the x-ray ribbon wraps instead of pushing the panel sideways at 360px", () =>
  hasRe(XR(), /flex-wrap: wrap; row-gap: 6px; max-width: 100%; box-sizing: border-box;/));
row("P02774", "the x-ray ribbon's amber ink is deepened for the light skin", () =>
  hasRe(XR(), /html\[data-theme="light"\] #xrayRibbon \.rb-tag,[\s\S]{0,120}color: #8a5a06;/));
row("P02775", "the x-ray ribbon says out loud that nothing is restricted here", () =>
  has(XR(), '"nothing is restricted on this screen"'));
row("P02776", "leaving the real view also drops the person pin", () =>
  hasRe(XR(), /u\.searchParams\.delete\("view"\); u\.searchParams\.delete\("as"\);/));
row("P02777", "the x-ray marks guard still covers the kitchen", () => {
  const g = readFileSync(P("scripts/verify-xray-marks.mjs"), "utf8");
  return has(g, "kitchen");
});

// ── both skins, settings, alerts, tenancy — P02778–P02797 ────────────────────
row("P02778", "the panel has both skins and DARK is not forced", () => {
  const c = CSS();
  return (/\[data-theme="light"\]/.test(c) && !/data-theme="dark"\s*\]?\s*\{\s*\}/.test(c)) || "the light skin is missing";
});
row("P02779", "the skin choice is remembered when a cook reopens the panel", () => {
  const t = readFileSync(P("public/panels/theme.js"), "utf8");
  return has(t, 'localStorage.setItem(KEY, theme)');
});
row("P02780", "every colour the light skin overrides is a real token, not an undefined var()", () => {
  const c = CSS();
  const declared = new Set([...c.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  // Only a var() with NO fallback can render nothing. `var(--safe-b, 0px)` is safe by
  // construction, and --safe-t/--safe-b are injected into this iframe by components/PanelFrame.tsx
  // rather than declared here — which is exactly why the fallback is written.
  const naked = new Set([...c.matchAll(/var\(--([\w-]+)\s*\)/g)].map((m) => m[1]));
  const undef = [...naked].filter((u) => !declared.has(u));
  return undef.length === 0 || `read with no fallback and never declared: ${undef.join(", ")}`;
});
row("P02781", "no CSS rule leaves a word unreadable in either skin", () => {
  // Mechanical half: no rule sets a colour without a surface, or a surface without ink, in a way
  // that resolves to the same value. The judgment half is the screenshot rows (P02913–P02920).
  const c = CSS();
  return lacksRe(c, /color:\s*(#fff|white)\s*;[^}]*background:\s*(#fff|white)\s*;/i);
});
row("P02782", "the panel adds no column to settings and declares no new module", () => {
  const r = ROUTEC();
  const cols = new Set();
  for (const m of r.matchAll(/from\("settings"\)\s*\.select\("([^"]+)"\)/g)) for (const c of m[1].split(",")) cols.add(c.trim());
  const known = new Set(["kitchen_can_accept_platform", "auto_print_kot", "auto_print_kot_allowed", "platform_channels", "table_names"]);
  const extra = [...cols].filter((c) => !known.has(c));
  return extra.length === 0 || `settings columns this route reads that the ledger did not know: ${extra.join(", ")}`;
});
row("P02783", "every write the panel makes is idempotent-safe for an offline replay", () =>
  has(ROUTE(), 'export const POST = withIdempotency(invalidateFloorAfter(postImpl), "kitchen")'));
row("P02784", "the panel raises no notification of its own that could buzz a phone during a test", () =>
  lacksRe(APPC(), /new Notification|Notification\.requestPermission|navigator\.vibrate/));
row("P02785", "the panel scopes every read by restaurant through the route, never by client-side filtering", () => {
  const a = APPC();
  return lacksRe(a, /\.filter\(\([a-z]\) => [a-z]\.restaurant_id/);
});
row("P02786", "the panel does not read or draw any other restaurant's data", () => {
  const r = ROUTEC();
  // every by-id write on this route carries .eq("restaurant_id", rid)
  const writes = [...r.matchAll(/sb\.from\("(\w+)"\)\s*\.(update|insert|delete)\(([\s\S]{0,400}?)(?=\n\s*(?:await|must|const|if|return|\}))/g)];
  const bad = writes.filter((w) => w[1] !== "printer_events" && !/restaurant_id/.test(w[3]) && !/\.in\("id"/.test(w[3]));
  return bad.length === 0 || `${bad.length} write(s) with no restaurant scope: ${bad.map((b) => b[1]).join(", ")}`;
});
row("P02787", "the 86 board writes go to the scoped /dishes/:id/sold-out, which the route re-checks", () => {
  const r = ROUTEC();
  return hasRe(r, /a === "dishes" && c === "sold-out"[\s\S]{0,400}\.eq\("restaurant_id", rid\)/);
});
row("P02788", "the panel never assumes restaurant #1", () => lacksRe(APPC(), /restaurant_id\s*[:=]\s*1\b|DEFAULT_RESTAURANT/));
row("P02789", "the header shows WHICH restaurant this panel is scoped to", () =>
  hasRe(APPC(), /function setRestName\(r\) \{[\s\S]{0,220}el\.textContent = restDisplayName\(r\)/));
row("P02790", "nothing in the panel shows another tenant's branding", () => {
  const t = APPC() + HTML() + CSS();
  return lacksRe(t, /French House|Aangan|La Fiesta/);
});
row("P02791", "the panel's CSS uses the panel token set, not the guest menu's", () => {
  const c = CSS();
  return lacksRe(c, /--lfh-guest|--menu-accent/);
});
row("P02793", "the panel files keep the line endings they already had", () => {
  // NOT "everything is LF". `public/panels/kitchen/style.css` has shipped MIXED endings for a long
  // time (551 CRLF lines of 640) — see the project note "Some files are CRLF, Python writes destroy
  // them", and the Edit tool does it too. So this pins the SHAPE each file is known to have; a
  // wholesale flip in either direction is the fault, because it turns a one-line change into a
  // 640-line diff that hides it.
  const want = {
    "public/panels/kitchen/app.js": "lf",
    "public/panels/kitchen/index.html": "lf",
    "public/panels/kitchen/style.css": "mixed",
    "app/api/kitchen/[...path]/route.ts": "lf",
    "app/kitchen/page.tsx": "lf",
    "app/kitchen/layout.tsx": "lf",
  };
  for (const [rel, shape] of Object.entries(want)) {
    const t = src(rel);
    const crlf = (t.match(/\r\n/g) || []).length;
    const lines = t.split("\n").length;
    const got = crlf === 0 ? "lf" : crlf >= lines - 1 ? "crlf" : "mixed";
    if (got !== shape) return `${rel} was ${shape}, is now ${got} (${crlf} CRLF of ${lines} lines)`;
  }
  return true;
});
row("P02796", "the panel does not reach outside its own territory", () => {
  const a = APPC();
  return lacksRe(a, /\.\.\/\.\.\/|require\(|import .* from "\.\.\//);
});
row("P02797", "the panel does not import anything from app/ or from another panel's folder", () => {
  const a = APPC();
  const refs = [...a.matchAll(/"\/panels\/([a-z-]+)\//g)].map((m) => m[1]);
  return refs.length === 0 || `it reaches into another panel's folder: ${refs.join(", ")}`;
});
