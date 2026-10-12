// BLOCK F · from P175560 — THE PROJECT'S OWN RULES, AS THEY APPLY TO MY HALF: the owner's recorded
// refusals still sit on the lines they protect, the guards that read this file are green (each run as
// a child process), and the standing rules — taps never vanish, nothing scrolls the window, a new way
// replaces the old one, a sale can be cancelled but never disappear — hold here. Subject named.
import { check, APP, MINE, CODE, MY_END_AT, rd, guard, fnText } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
const MINE_C = CODE.slice(0, MY_END_AT);
const REJ = rd("docs/REJECTED-IDEAS.md");
let n = 175560;
const id = () => "P" + n++;
const S = (what, fn) => check(id(), `${F} — ${what}`, "SRC: read in place", fn);
const G = (script, what) => check(id(), `\`${script}\` — ${what} (reads ${F})`, `GUARD: node ${script}`, () => { const g = guard(script); return { ok: g.ok, note: g.ok ? "green" : g.out.slice(-200) }; });

// ── the owner's refusals, on the lines they protect ──────────────────────────────────────────
S("R47 — no bill-level cancel; the refusal sits on billState()", () => /REJECTED \(owner, 2026-08-26\) — docs\/REJECTED-IDEAS\.md R47/.test(APP.slice(APP.indexOf("// ── THE ONE PLACE A BILL'S STATE IS DECIDED"), APP.indexOf("function billState("))) && /\| R47 \|/.test(REJ));
S("…and there is still no '✕ Cancel this bill' anywhere in my half", () => !/Cancel this bill|data-bill-cancel|cancel_bill/.test(MINE_C));
S("R62 — a guest bill's button always says Print; the refusal sits on billPrintLabel()", () => /REJECTED \(owner, 2026-10-10\)/.test(APP.slice(APP.indexOf("A GUEST BILL'S BUTTON ALWAYS SAYS"), APP.indexOf("function billPrintLabel("))) && /\| R62 \|/.test(REJ));
S("…and no 'Reprint' word is drawn on any bill button in my half", () => !/>[^<]*Reprint[^<]*</.test(MINE.replace(/\/\/[^\n]*/g, "")) && !/"[^"]*🖨 Reprint/.test(MINE));
S("R67 — the Table setting card shows facts, with its refusal comment in place", () => /REJECTED \(owner, 2026-10-11\) — docs\/REJECTED-IDEAS\.md → R67/.test(fnText("tableSeatingCardHtml")) && /\| R67 \|/.test(REJ));
S("…and nowhere in my half is a power shown greyed or 'ask your owner'", () => !/Ask your owner|ask the admin|🔒 <b>Set by/i.test(MINE.replace(/\/\/[^\n]*/g, "")));
S("R53 — no second door to the waiter rota from the floor (obituary + refusal in place)", () => /REJECTED \(owner, 2026-07-31\): "I do not want\s*\n?\s*\/\/ this option completely on top"/.test(APP) && !/function openSectionsModal\(/.test(APP));
S("2026-08-19 refusal — the bill SHEET carries no reprint band, and printBill passes no reprint flag", () => /REJECTED \(owner, 2026-08-19\)/.test(fnText("printBill")) && !/reprint:\s*(true|printedBefore)/.test(fnText("printBill").replace(/\/\/[^\n]*/g, "")));
S("R27 — the panel holds no delete-a-bill PERMISSION: only the server's canDeleteBill answer", () => !/delete_bill|deleteBillPower|perm.*delete.*bill/i.test(MINE_C));
G("scripts/verify-rejected-ideas.mjs", "every refusal recorded in docs/REJECTED-IDEAS.md still sits on its code line");

// ── the guards that read this file ───────────────────────────────────────────────────────────
G("scripts/verify-bills-screen.mjs", "the Bills screen keeps its shape (sections 7 and 8 added by this run)");
G("scripts/verify-queued-truth.mjs", "a write only saved on this device is never reported as done (D2 added by this run)");
G("scripts/verify-manager-behaviour.mjs", "the manager panel's fixes still work (groups I, J, K added by this run)");
G("scripts/verify-ui-integrity.mjs", "nothing would print code on someone's screen (section 16 added by this run)");
G("scripts/verify-panel-scope.mjs", "every helper exists where its caller can see it");
G("scripts/verify-panel-names.mjs", "every name a panel reads exists where it is read");
G("scripts/verify-panel-dialogs.mjs", "no bare prompt()/confirm() — the themed dialogs only");
G("scripts/verify-clash-coverage.mjs", "first save wins: every protected write names its expectation");
G("scripts/verify-panel-cache.mjs", "the panel's ?v= hash matches the file, so no browser keeps a stale copy");
G("scripts/verify-xray-marks.mjs", "the admin's X-ray marks and the manager's hidden controls agree");
G("scripts/verify-bill-reprint-is-silent.mjs", "the bill says nothing about being a second copy");
G("scripts/verify-tap-guard.mjs", "no tap in the panels can vanish in silence");
G("scripts/verify-panel-secrets.mjs", "no secret can reach a panel file");
G("scripts/verify-wording.mjs", "the panels' words follow the house vocabulary");

// ── standing rules ──────────────────────────────────────────────────────────────────────────
S("nothing in my half scrolls the WINDOW (the manager panel never does)", () => !/window\.scroll(To|By)?\(|document\.(documentElement|body)\.scrollTop\s*=/.test(MINE_C));
S("the only scroll in my half is an element bringing ITSELF into view", () => (MINE_C.match(/scrollIntoView\(/g) || []).length === 2);
S("a disabled control that would swallow a tap explains itself (title) — Mark paid before Accept", () => /disabled title="Accept the order first — the bill can only be paid once accepted\."/.test(fnText("mergedOrderCardHtml")));
S("the split's Take payment stays ENABLED and says why it won't go (never a dead button)", () => /Stays ENABLED and says WHY it won.t go/.test(APP) && !/class="[^"]*pay-split-go[^"]*"[^>\n]*\bdisabled\b/.test(APP));
S("every popup my half builds is one the back-button watcher tracks (its overlay class is in the list)", () => {
  const SEL = (APP.match(/const SEL = "([^"]+)";\s*\n\s*const off = new WeakMap\(\);/) || [])[1] || "";
  const classes = [...MINE.matchAll(/className = "([a-z-]+-overlay)|class="(sx-modal-overlay)[ "]/g)].map((m) => m[1] || m[2]);
  const wraps = [...MINE.matchAll(/el\(`<div class="sx-modal-overlay ([a-z-]+)/g)].length;
  return { ok: classes.every((c) => SEL.includes("." + c)) && wraps >= 7, note: `${classes.length} overlay class(es), ${wraps} sx-modal popups — all tracked` };
});
S("a popup with an awaited answer closes through __lfhClose, so BACK resolves the promise", () => ["confirmDialog", "promptDialog", "openPaymentMethodModal", "openKhataPersonPicker", "openBillModal"].every((f) => /\.__lfhClose = /.test(fnText(f))));
S("a new way replaces the old one: numSel, the access cards, the record cards and the QR links list stay deleted", () => !/function (numSel|accessDefaultsCardHtml|accessUsersCardHtml|billRecordCardHtml|parcelRecordCardHtml|triSel)\(/.test(APP) && /OBITUARY: the per-table "Guest QR links" list/.test(APP));
S("…and the old 'Kitchen · KOT printing' Settings card is gone, with one Printing row left", () => !/id: "kitchen"/.test(APP.slice(APP.indexOf("const SETTINGS_SECTIONS"), APP.indexOf("const SETTINGS_SECTIONS") + 6000)) && /id: "printing"/.test(APP));
S("a sale can be cancelled, never disappear: delete is refused for a PAID bill on screen too", () => /const isRecord = \(o\) => o\.payment_status === "paid" && o\.status !== "cancelled";/.test(fnText("deleteOrders")));
S("a cancelled bill draws no invoice number (Print issue is not offered on an all-cancelled bill)", () => /if \(sid2 && o0\.invoice_no == null && liveOrders\.length\) acts\.push/.test(fnText("openBillModal")));
S("a settled bill is corrected by Reopen or a credit note — the Discount button only on open money", () => /if \(sid2 && anyUnpaid2 && !invoiced2\) acts\.push\(`<button class="btn ghost" data-bm-disc/.test(fnText("openBillModal")));
S("every reason a removal can give is the shared list (REMOVAL_REASONS), never a private one here", () => !/const REASONS_DELETE|const REASONS_CLOSE/.test(APP) && /REMOVAL_REASONS\.find\(/.test(fnText("deleteOrders")));
S("the 60s backstop is the slowest refresh my half sets — no fast poll (loadBillsRecord ≥ 60s idle)", () => /\(force \? 3000 : 60000\)/.test(fnText("loadBillsRecord")) && !/setInterval\(/.test(MINE_C));
S("egress: no read in my half asks for more than the server's own bounded window", () => !/limit=\d{4,}|\?all=1/.test(MINE));
S("the dashboard's charting library is fetched only when a chart is drawn", () => /const CHART_LIB_SRC = "\/panels\/vendor\/chart\.umd\.min\.js\?v=/.test(APP) && !/chart\.umd/.test(rd("public/panels/editor/index.html").replace(/<!--[\s\S]*?-->/g, "")));
S("the skin has ONE writer (applyEmbedSkin) and it clears the other class first", () => /cl\.remove\("skin-light", "skin-dark"\);\s*\n\s*cl\.add\("skin-" \+ CUR_SKIN\);/.test(fnText("applyEmbedSkin")));
S("the skin message is accepted only from this site's own origin", () => /if \(e\.origin !== location\.origin\) return;/.test(APP));
S("every restaurant is different: no restaurant #1 name or logo is hard-coded in my half's bill path", () => !/littlefrenchhouse\.in/.test(CODE.slice(0, MY_END_AT)) && /function billLogo\(\)/.test(APP));
S("…the performance report's 'Little French House' fallback is reached ONLY by restaurant #1 itself", () => /const isDefault = r\.slug === "french-house" \|\| r\.id === "00000000-0000-0000-0000-000000000001";/.test(fnText("printManagerReport")));
