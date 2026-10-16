// BLOCK E · from P176601 — THE PROJECT'S OWN RULES, AS THEY APPLY TO MY THIRD. The owner's rejections
// that sit in this code are still there AND still honoured; the panel rules (taps never vanish, the
// back button, nothing scrolls the window, no browser dialogs, the 60s backstop, saved-is-not-sent)
// hold here; and every repo guard that reads the manager panel is run and must be green.
import { check, guard, MINE, MINE_CODE, APP, rd, lineAt, MY_START_AT, refs, DECLS, inMine } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
let n = 176601;
const id = () => "P" + n++;
const S = (what, how, fn) => check(id(), `${F} — ${what}`, `SRC: ${how}`, fn);
const REJ = rd("docs/REJECTED-IDEAS.md");
const fn = (name) => { const i = APP.indexOf(`\nfunction ${name}(`) >= 0 ? APP.indexOf(`\nfunction ${name}(`) : APP.indexOf(`\nasync function ${name}(`); if (i < 0) return ""; const j = APP.slice(i + 2).search(/\n(?:async )?function |\nconst [A-Za-z_$][\w$]* = /); return APP.slice(i, j < 0 ? APP.length : i + 2 + j); };

// ── the owner's rejections that live in this code ──────────────────────────────────────────────
const R = (r, what, codeOk) => S(`${r} — ${what}`, `docs/REJECTED-IDEAS.md has ${r}; the code still carries its REJECTED note and still honours it`, () => new RegExp(`\\| ${r} \\|`).test(REJ) && codeOk());
R("R9", "the merged-table chip shows no 'joined for 40m' duration", () => /R9/.test(fn("floorTileHtml")) && !/ft-merge[^`]*\bm\b`/.test(fn("floorTileHtml")) && !/mergedFor|merge(d)?Age/.test(fn("floorTileHtml")));
R("R10", "'To pay' on the floor header stays a count, never a rupee total", () => /R10/.test(APP.slice(APP.indexOf("function floorStatsHtml(") - 1500, APP.indexOf("function floorStatsHtml("))) && !/₹|inr\(/.test(fn("floorStatsHtml").replace(/\/\/[^\n]*/g, "")));
R("R25", "the floor legend explains its states and adds no amber/pink entries", () => /R25/.test(MINE) && !/["']Ready to serve["'][^\n]*LEG|LEG[^\n]*Ready to serve/.test(MINE_CODE));
R("R31", "the take button has exactly two faces — never a third 'Order' word", () => /R31/.test(fn("floorTileHtml")) && (fn("floorTileHtml").match(/class="ft-take-[a-z]"/g) || []).length === 2);
R("R32", "there is no one-tap 🍽️ Serve-all on a floor tile", () => /R32/.test(fn("floorTileHtml")) && !/data-serve-all|serveAll/.test(fn("floorTileHtml")));
R("R33", "a table whose tickets were all cancelled gets a statement, not a next-step button", () => /R33/.test(fn("tablePanelParts")) && /const voidNote = /.test(fn("tablePanelParts")));
R("R67", "a manager is never shown a power they were not given (retention, seating cards)", () => /R67/.test(fn("retentionControl")) && /XRAY_WHO\.higherView/.test(fn("retentionControl")));
S("R8 — the '→ N more' chip is gone from the floor and stays gone", "no syncFloorMore in the file", () => !DECLS.has("syncFloorMore"));
S("R53 — 'who serves which table' has no button on the floor", "no #floorSections binding, no data-sections on a tile", () => !/#floorSections|data-floor-sections/.test(MINE_CODE.replace(/\s+/g, " ")) && /No #floorSections binding/.test(MINE));
S("R47 — there is no '✕ Cancel this bill' (one act for a whole bill) in the table popup", "tablePanelParts offers per-ticket cancel only", () => !/cancel-bill|cancelBill|Cancel this bill/.test(fn("tablePanelParts")));
// ── the panel rules ────────────────────────────────────────────────────────────────────────────
S("no browser prompt(), confirm() or alert() in my third — the panel's own dialogs only", "stripped code", () => !/(?<![\w$.])(prompt|confirm|alert)\(/.test(MINE_CODE.replace(/confirmDialog\(|promptDialog\(/g, "")));
S("nothing in my third scrolls the WINDOW (the manager panel never scrolls the page)", "no window.scrollTo / scrollBy / document.scrollingElement writes", () => !/window\.scroll(To|By)?\(|scrollingElement\.scrollTop\s*=/.test(MINE_CODE));
S("every scrollIntoView in my third keeps to its own box (block: 'nearest') — except the ONE documented phone jump to a picked bill", "each call names block nearest, or is the ≤1080px 'take them to the bill' jump (2026-08-22)", () => [...MINE.matchAll(/scrollIntoView\(([^)]*)\)/g)].every((m) => /nearest/.test(m[1]) || ((/block: "start"/.test(m[1]) || /block: "start"/.test(MINE.slice(Math.max(0, m.index - 140), m.index))) && /if \(window\.innerWidth <= 1080\)/.test(MINE.slice(Math.max(0, m.index - 400), m.index)) && /TAKE THEM TO THE BILL/.test(MINE.slice(Math.max(0, m.index - 1200), m.index)))));
S("no timer in my third polls faster than the 60s backstop (a 1-second clock tick is not a read)", "every setInterval period ≥ 60000 or a local tick with no api() inside", () => [...MINE.matchAll(/setInterval\(([\s\S]{0,300}?),\s*(\d+)\)/g)].every((m) => Number(m[2]) >= 60000 || !/api\(|loadSessions|loadAll|fetch\(/.test(m[1])));
S("every popup my third appends either wears a class the back-button adapter watches, or registers its own layer", "appendChild(...) targets vs .sx-modal-overlay|.bill-overlay|.confirm-overlay|LFH_BACK.layer", () => { const ok = /sx-modal-overlay|bill-overlay|confirm-overlay/; const blocks = [...MINE.matchAll(/document\.body\.appendChild\((\w+)\)/g)]; return blocks.every((b) => { const before = MINE.slice(Math.max(0, b.index - 4000), b.index); const after = MINE.slice(b.index, b.index + 600); return ok.test(before.slice(before.lastIndexOf("el(`") >= 0 ? before.lastIndexOf("el(`") : 0)) || /LFH_BACK\.layer\(/.test(before.slice(-2500) + after); }); });
S("every popup that is awaited (a question) hands the back button its own closer, so Back answers it", "askRemovalReason / askReopenReason set __lfhClose = () => done(null)", () => /wrap\.__lfhClose = \(\) => done\(null\);/.test(fn("askRemovalReason")) && /wrap\.__lfhClose = \(\) => done\(null\);/.test(fn("askReopenReason")));
S("the price pad and the allergy pad register their own back layers and drop them on every close", "LFH_BACK.layer + backOff() in both", () => /LFH_BACK\.layer\("editor-price"/.test(MINE) && /LFH_BACK\.layer\("editor-allergy"/.test(MINE));
S("an open table registers ONE hardware-back layer per popup and removes it when the popup goes", "syncTableBackLayers", () => /_tableBackLayers\.delete\(k\)/.test(fn("syncTableBackLayers")) && /LFH_BACK\.layer\("table-detail"/.test(fn("syncTableBackLayers")));
S("every write's success in my third is said through okToast()/wasQueued() — saved-on-this-device never reads as sent", "count api writes whose reply is ignored AND followed by a literal success toast", () => { const lines = MINE.split("\n"); let bad = 0; lines.forEach((l, i) => { if (!/await api\("(POST|PATCH|DELETE)"/.test(l)) return; if (/const (_\w+|r|saved|res|cn) = await api|wasQueued\(await api|okToast\(await api/.test(l)) return; const next = lines.slice(i, i + 3).join(" "); if (/toast\("[^"]*(✓|Saved|Done|added|updated)[^"]*", "ok"\)/.test(next)) bad++; }); return bad === 0; });
S("QUEUED_LINE is the one 'saved on this device' sentence my third uses for a queued order", "the take-order queued branch toasts QUEUED_LINE", () => /if \(r && r\.queued\) \{ release\(\); toast\(QUEUED_LINE/.test(fn("openTakeOrder")));
S("a tap never vanishes: the send buttons are disabled while a parcel is sending and given back if it fails", "parcel path: disabled = true … catch → disabled = false", () => /sendBtns\.forEach\(\(b\) => \(b\.disabled = true\)\);[\s\S]{0,4000}catch \(e\) \{\s*\n\s*sendBtns\.forEach\(\(b\) => \(b\.disabled = false\)\);/.test(fn("openTakeOrder")));
S("a refused take-order is never silent — every refusal path ends in a toast", "send(): handBack(msg) toasts; askDuplicate toasts or re-sends", () => /const handBack = async \(msg\) => \{\s*\n\s*release\(\);\s*\n\s*toast\(msg/.test(fn("openTakeOrder")) && /Nothing was sent — the order is back, unchanged/.test(fn("openTakeOrder")));
S("the floor's read is the slim /summary plus only the OPEN tables' slices (mig 101's two tiers)", "loadSessions asks /summary and ?table= per detail table", () => /api\("GET", "\/summary"\)/.test(fn("loadSessions")) && /"\?table=" \+ encodeURIComponent\(t\)/.test(fn("loadSessions")));
S("a stale table slice is dropped when a newer one for the SAME table has started", "loadTableSlice's per-table sequence", () => /if \(seq !== tableSliceSeq\[key\]\) return;/.test(fn("loadTableSlice")));
S("a server answer never overwrites an optimistic change still in flight (floorOpsInFlight)", "loadSessions merges only when floorOpsInFlight is 0", () => /if \(!floorOpsInFlight\) \{ state\.summary = mergeServerSummary\(summary\)/.test(fn("loadSessions")));
S("a poll never repaints the floor under a finger that is dragging a popup", "loadSessions defers while floatInteracting", () => /if \(fromPoll && floatInteracting\) \{ floatRenderPending = true; return; \}/.test(fn("loadSessions")));
S("…nor while someone is typing in the open table", "loadSessions defers to the input's blur", () => /addEventListener\("blur", \(\) => \{ state\._boardFlushArmed = false; loadSessions\(true\); \}, \{ once: true \}\)/.test(fn("loadSessions")));
S("an unchanged board is not redrawn (lastBoardSig)", "loadSessions compares the fingerprint on a poll", () => /if \(fromPoll && sig === lastBoardSig\) return;/.test(fn("loadSessions")));
S("every clock my third prints is the restaurant's (Asia/Kolkata) — item 3", "every date-shaped toLocale call names a timeZone", () => [...MINE.matchAll(/(\w+|\))\.toLocale(String|DateString|TimeString)\(([^;]*?)\)(?=[\s;),+.])/g)].filter((m) => /Date|\bd\b|\bx\b|now/.test(MINE.slice(Math.max(0, m.index - 30), m.index + 2))).every((m) => /timeZone/.test(m[3]) || !/\{/.test(m[3]) && false || /timeZone/.test(m[0])));
S("the take-order sheet asks no 'are you sure' before Send (owner, 2026-07-31: less clicks)", "dine-in send has no confirmDialog before the POST", () => { const t = fn("openTakeOrder"); const i = t.indexOf('NO "are you sure"'); return i > 0 && !/confirmDialog\(/.test(t.slice(i, t.indexOf('api("POST", "/order"', i))); });
S("an un-accepted ticket keeps its own Accept and its own ✕ in one amber box (owner, 2026-09-17)", "tablePanelParts draws sp-newbox with data-accept and the cancel offer", () => /sp-newbox/.test(fn("tablePanelParts")) && /data-accept="\$\{esc\(o\.id\)\}"/.test(fn("tablePanelParts")));
S("served dishes sink to the bottom of the bill (owner, 2026-09-17: 'mark as serve should go to bottom')", "the menu-order sort puts rowServed rows last", () => /\(rowServed\(a\) \? 1 : 0\) - \(rowServed\(b\) \? 1 : 0\)/.test(fn("tablePanelParts")));
S("the floating popup is phone-wide everywhere (owner, 2026-09-17: 'portrait form only')", "FLOAT_MAX_W is 392", () => /const FLOAT_MAX_W = 392;/.test(MINE));
S("a phone shows ONE full-width popup at a time (owner, 2026-07-03)", "addFloating on isPhoneLayout keeps one", () => /isPhoneLayout\(\)/.test(fn("addFloating")));
S("the floor tile's take button keeps the data-take-order hook the permission pass hides by", "floorTileHtml emits data-take-order", () => /data-take-order="\$\{i\}"/.test(fn("floorTileHtml")));
S("'Close table' (⏻) appears only on a finished table — everything served AND paid (no table ends itself)", "finishedHere gates the close icon", () => /finishedHere \? `<button class="ft-ico ft-ico-close"/.test(fn("floorTileHtml")));
S("the bell is synced after every render, on every tab — not only the floor", "renderEditor schedules syncGuestBell first", () => /setTimeout\(syncGuestBell, 0\);/.test(fn("renderEditor").slice(0, 1200)));
S("the Audit tab with every view switched off says so, never an empty shell", "renderEditor's log branch", () => /None of the Audit & logs views are enabled for managers here/.test(fn("renderEditor")));
S("removeRecord keeps its one caller (bindEditor's Delete) — the 2026-09-14 accident cannot recur silently", "refs(removeRecord) ≥ 1", () => refs("removeRecord") >= 1);
S("a deleted dish/category/tag can be UNDONE (a 5-second undo bar)", "removeRecord shows LFH_UNDO with an undo that re-creates", () => /LFH_UNDO\.show\(\{ message: `Deleted/.test(fn("removeRecord")) && /payload\.__create = true;/.test(fn("removeRecord")));
S("A NEW WAY REPLACES THE OLD ONE — my third holds no function nothing calls", "refs() of every top-level function declared in my third", () => { const dead = [...MINE.matchAll(/\n(?:async )?function ([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]).filter((f) => refs(f) === 0 && !new RegExp(`\\b${f}\\b`).test(rd("public/panels/editor/index.html"))); return dead.length === 0 || { ok: false, note: `${dead.join(", ")} — not a product fault: unblock() was replaced by unblockLog(), openTablePanel() by openFloatingTable(); listed for the owner (Part 4), not deleted` }; });
// ── the repo's guards that read the manager panel, run now ─────────────────────────────────────
const G = (name, script, args = []) => check(id(), `${F} — verify:${name} is green on this branch`, `GUARD: node ${script}`, () => { const r = guard(script, args); return { ok: r.ok, note: r.ok ? "green" : String(r.out).slice(-200) }; });
G("manager-behaviour", "scripts/verify-manager-behaviour.mjs");
G("clash-coverage", "scripts/verify-clash-coverage.mjs");
G("panel-names", "scripts/verify-panel-names.mjs");
G("panel-scope", "scripts/verify-panel-scope.mjs");
G("panel-dialogs", "scripts/verify-panel-dialogs.mjs");
G("panel-cache", "scripts/verify-panel-cache.mjs");
G("panel-plumbing", "scripts/verify-panel-plumbing.mjs");
G("panel-secrets", "scripts/verify-panel-secrets.mjs");
G("rejected", "scripts/verify-rejected-ideas.mjs");
G("abort-guard", "scripts/verify-abort-guard.mjs");
G("board-sig", "scripts/verify-board-sig.mjs");
G("taps", "scripts/verify-tap-guard.mjs");
G("queued-truth", "scripts/verify-queued-truth.mjs");
G("plain-refusals", "scripts/verify-plain-refusals.mjs");
G("twins", "scripts/verify-panel-twins.mjs");
G("floor-per-row", "scripts/verify-floor-per-row.mjs");
G("ready-tile", "scripts/verify-ready-tile-and-kitchen.mjs");
G("menu-parts", "scripts/verify-menu-parts.mjs");
G("xray", "scripts/verify-xray-marks.mjs");
G("no-attend-flash", "scripts/verify-open-no-attend-flash.mjs");
G("bills-screen", "scripts/verify-bills-screen.mjs");
G("manager-gates", "scripts/verify-manager-gates.mjs");
G("parcel-home", "scripts/verify-parcel-home.mjs");
G("retention", "scripts/verify-retention-lock.mjs");
G("panel-api", "scripts/verify-panel-api-guards.mjs");
G("no-ask", "scripts/verify-no-ask-before-delete.mjs");
