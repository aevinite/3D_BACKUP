// SWEEP #8 · T9 · NEW CHECKS, block A+B — P62701–P62800.
//
// PLANNED FROM A MEASUREMENT, not from a fresh idea: 251 named things exist in this territory and
// 69 of them are named by NO row in any of the 30 existing ledgers. Two whole features are in that
// list — the blocked-device wall, and the ☰ menu → ⚙️ Settings sheet — so they go first.
import { row, APP, APPC, HTML, CSS, ROUTE, ROUTEC, has, hasRe, lacks, lacksRe, P } from "./lib.mjs";
import { readFileSync } from "node:fs";

const slice = (from, to) => { const a = APPC(); const i = a.indexOf(from); const j = a.indexOf(to); return i < 0 || j < 0 ? "" : a.slice(i, j); };

// ══ A · A BLOCKED DEVICE GOES COMPLETELY BLACK (owner, 2026-08-18) — P62701–P62740 ══
const WALL = () => slice("function showBlockedWall()", "const blockedError =");
row("P62701", "the panel has a full-screen wall for a device staff have blocked", () => has(APPC(), "function showBlockedWall()"));
row("P62702", "the wall is painted once and never re-created", () => hasRe(WALL(), /if \(blockedWallUp\) return;\s*\n?\s*blockedWallUp = true;/));
row("P62703", "the wall covers the whole viewport", () => hasRe(WALL(), /position:fixed;inset:0/));
row("P62704", "the wall sits above every other layer on the panel", () => hasRe(WALL(), /z-index:2147483647/));
row("P62705", "the wall is genuinely black, not a dark panel colour", () => hasRe(WALL(), /background:#000/));
row("P62706", "the wall's styles are INLINE, so it still goes dark if the stylesheet failed to load", () => {
  const w = WALL();
  return (/style\.cssText = "position:fixed/.test(w) && !/classList\.add|className = "/.test(w)) || "the wall depends on the stylesheet";
});
row("P62707", "the wall announces itself to a screen reader as a dialog", () => hasRe(WALL(), /setAttribute\("role", "alertdialog"\)/));
row("P62708", "the wall carries an accessible label", () => hasRe(WALL(), /setAttribute\("aria-label", "This device has been blocked"\)/));
row("P62709", "the wall says WHAT happened in plain words", () => has(WALL(), 'head.textContent = "This device has been blocked"'));
row("P62710", "the wall says WHO to ask, rather than leaving a dead end", () => has(WALL(), 'sub.textContent = "Ask a manager to unblock it."'));
row("P62711", "the wall gives no reason — the person holding the tablet is not always the person it is about", () =>
  lacksRe(WALL(), /because|reason|why|manager blocked you/i));
row("P62712", "the wall has nothing to dismiss it with", () => lacksRe(WALL(), /onclick|addEventListener|remove\(\)/));
row("P62713", "the wall's text cannot be selected and dragged off", () => hasRe(WALL(), /user-select:none/));
row("P62714", "the wall uses a system font, so it cannot depend on a webfont that did not load", () => hasRe(WALL(), /font-family:system-ui,sans-serif/));
row("P62715", "the wall puts itself back in front if a later timer paints over it", () =>
  hasRe(WALL(), /setInterval\(\(\) => \{ if \(document\.body\.lastElementChild !== w\) document\.body\.appendChild\(w\); \}, 3000\)/));
row("P62716", "that re-assert is CONDITIONAL, not an unconditional re-append every tick", () =>
  hasRe(WALL(), /if \(document\.body\.lastElementChild !== w\)/));
row("P62717", "a walled panel stops talking to the server at all", () => hasRe(APPC(), /if \(blockedWallUp\) throw blockedError\(\);/));
row("P62718", "that short-circuit is the FIRST thing api() does, before the network", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const api = async (method, path, body, opts) => {"));
  return (fn.indexOf("if (blockedWallUp)") < fn.indexOf("fetch(")) || "api() reaches the network before checking the wall";
});
row("P62719", "the refusal it throws carries the 403 status and a blocked flag", () =>
  hasRe(APPC(), /const blockedError = \(\) => \{ const e = new Error\("This device has been blocked by staff\."\); e\.status = 403; e\.blocked = true; return e; \}/));
row("P62720", "the wall goes up on the server's CODE, never on its wording", () =>
  hasRe(APPC(), /if \(r\.status === 403 && j && j\.reason === "device_blocked"\) \{ showBlockedWall\(\); throw blockedError\(\); \}/));
row("P62721", "the board READ refuses a blocked device, not only the writes", () =>
  hasRe(ROUTEC(), /if \(await blockedForRead\(deviceIdFrom\(req\), rid\)\) return BLOCKED_READ\(\);/));
row("P62722", "that refusal answers the CODE the panel branches on", () => hasRe(ROUTEC(), /reason: "device_blocked"/));
row("P62723", "the refusal is a 403, which is what the panel's wall branch keys on", () => hasRe(ROUTEC(), /blocked: true \},\s*\n?\s*\{ status: 403 \}/));
row("P62724", "the block check on the hot READ path is memoised, so a realtime burst cannot multiply it", () =>
  hasRe(ROUTEC(), /const blockMemo = new Map<string, \{ at: number; blocked: boolean \}>\(\);/));
row("P62725", "that memo lasts 30 seconds — the same TTL the panel-entitlement cache uses", () => hasRe(ROUTEC(), /const BLOCK_TTL_MS = 30_000;/));
row("P62726", "the memo is keyed by restaurant AND device, so one tenant's block cannot answer another's", () =>
  hasRe(ROUTEC(), /const key = `\$\{rid\}:\$\{dev\}`;/));
row("P62727", "the memo has a ceiling and prunes expired entries, so it cannot grow for ever", () =>
  hasRe(ROUTEC(), /if \(blockMemo\.size > 500\) for \(const \[k, v\] of blockMemo\) \{ if \(Date\.now\(\) - v\.at > BLOCK_TTL_MS\) blockMemo\.delete\(k\); \}/));
row("P62728", "a request with no device id is never treated as blocked", () => hasRe(ROUTEC(), /if \(!dev\) return false;/));
row("P62729", "a WRITE is never memoised — it asks every time", () => {
  const r = ROUTEC();
  const post = r.slice(r.indexOf("async function postImpl("));
  return (/if \(await deviceBlocked\(dev, rid\)\)/.test(post) && !/blockedForRead/.test(post)) || "the write path reads the read-path memo";
});
row("P62730", "the write refusal is scoped to THIS restaurant, not platform-wide", () => hasRe(ROUTEC(), /deviceBlocked\(dev, rid\)/));
row("P62731", "the read refusal is scoped to this restaurant too", () => hasRe(ROUTEC(), /blockedForRead\(deviceIdFrom\(req\), rid\)/));
row("P62732", "the block is checked AFTER the restaurant is resolved, or it could not be scoped", () => {
  const r = ROUTEC();
  const get = r.slice(r.indexOf("export async function GET("), r.indexOf("const { path = [] } = await ctx.params;"));
  return (get.indexOf("const rid = panelRestaurantId") < get.indexOf("blockedForRead")) || "the block is read before the restaurant is known";
});
row("P62733", "the wall's own module state starts down", () => hasRe(APPC(), /let blockedWallUp = false;/));
row("P62734", "nothing in the panel ever takes the wall back down", () => {
  // `let blockedWallUp = false;` is the DECLARATION and must not be counted as a reset — the row
  // is about a second assignment somewhere that would let a walled screen quietly come back.
  const a = APPC();
  const sets = (a.match(/blockedWallUp = false/g) || []).length;
  const declared = /let blockedWallUp = false;/.test(a);
  return (declared && sets === 1) || `${sets} assignment(s) to false, declaration present: ${declared}`;
});
row("P62735", "the wall is appended to the body, not inside a scrolling container it could be clipped by", () =>
  hasRe(WALL(), /document\.body\.appendChild\(w\);/));
row("P62736", "the wall centres its message rather than pinning it to a corner", () =>
  hasRe(WALL(), /align-items:center;justify-content:center/));
row("P62737", "the wall's message is width-limited so it cannot render as one long line on a big display", () =>
  hasRe(WALL(), /max-width:34ch/));
row("P62738", "the wall carries a recognisable stop mark as well as words", () => has(WALL(), 'icon.textContent = "\\u26D4"'));
row("P62739", "the wall's ink is light on black, not a token that might resolve dark", () => hasRe(WALL(), /color:#e5e7eb/));
row("P62740", "the blocked-device wall has an id, so a later guard can find it on the page", () => has(WALL(), 'w.id = "lfh-blocked-wall"'));

// ══ B · ☰ MENU → ⚙️ SETTINGS → SIGN OUT (owner, 2026-08-19) — P62741–P62800 ══
const MENU = () => slice("function openKitchenMenu()", "let kdsSetOff = null;");
const SET = () => slice("function renderKitchenSettings()", "function waitingWords()");
row("P62741", "the kitchen has a ☰ menu at all — it is the panel's only way to sign out", () => has(APPC(), "function openKitchenMenu()"));
row("P62742", "the ☰ button in the markup opens it", () => {
  return (hasRe(HTML(), /id="hamburger"/) === true && hasRe(APPC(), /ham\.onclick = openKitchenMenu/) === true) || "the ☰ button is not wired";
});
row("P62743", "the ☰ button has an accessible name", () => hasRe(HTML(), /id="hamburger"[^>]*aria-label="Menu &amp; settings"/));
row("P62744", "the menu cannot be opened twice on top of itself", () => hasRe(MENU(), /if \(document\.querySelector\("\.kds-dw"\)\) return;/));
row("P62745", "the menu registers a back layer the moment it opens", () => hasRe(MENU(), /LFH_BACK\.layer\("kitchen-menu", close\)/));
row("P62746", "the menu closes on its ✕", () => hasRe(MENU(), /dw\.querySelector\("\.dw-close"\)\.onclick = close;/));
row("P62747", "the menu closes on its backdrop", () => hasRe(MENU(), /back\.onclick = close;/));
row("P62748", "closing the menu removes BOTH the drawer and its backdrop", () => hasRe(MENU(), /const close = \(\) => \{ back\.remove\(\); dw\.remove\(\);/));
row("P62749", "closing the menu releases its back layer exactly once", () => hasRe(MENU(), /if \(kdsDrawerOff\) \{ const o = kdsDrawerOff; kdsDrawerOff = null; o\(\); \}/));
row("P62750", "the menu names the restaurant it belongs to", () => hasRe(MENU(), /const rest = restDisplayName\(state\.restaurant\)\.replace\(\/\\\*\/g, ""\) \|\| "this restaurant";/));
row("P62751", "the restaurant name in the menu is escaped", () => has(MENU(), '<div class="dw-sub">${esc(rest)}</div>'));
row("P62752", "the menu offers Settings, Printer and Report an issue, and nothing else", () => {
  const rows = [...MENU().matchAll(/data-kdw="(\w+)"/g)].map((m) => m[1]);
  return (rows.length === 3 && rows.join(",") === "settings,printer,issue") || `the menu rows are: ${rows.join(", ")}`;
});
row("P62753", "the menu has NO profile row — the kitchen has no profile (R7, ruled three times)", () =>
  lacksRe(MENU(), /Profile|profile|My details|Finish setup/));
row("P62754", "every menu row closes the menu before opening what it points at", () =>
  hasRe(MENU(), /const what = b\.dataset\.kdw; close\(\);/));
row("P62755", "the Settings row opens the settings sheet", () => hasRe(MENU(), /if \(what === "settings"\) openKitchenSettings\(\);/));
row("P62756", "the Printer row opens the printer sheet", () => hasRe(MENU(), /else if \(what === "printer"\) openPrinterSheet\(\);/));
row("P62757", "the issue row hands the shared widget this panel's own api() and restaurant pin", () =>
  hasRe(MENU(), /LFH_ISSUE\.open\(\{ api, rid: PANEL_RID, notify: \(m\) => toast\(m\) \}\)/));
row("P62758", "the issue row does nothing rather than throwing if the shared widget did not load", () =>
  hasRe(MENU(), /what === "issue" && window\.LFH_ISSUE/));
row("P62759", "the menu shows a build tag so \"is this screen running the latest code?\" has an answer", () => has(MENU(), 'id="kdsBuild"'));
row("P62760", "that build tag READS the loaded script's own hash — never a typed-in string", () =>
  hasRe(MENU(), /document\.querySelectorAll\('script\[src\*="app\.js"\]'\)[\s\S]{0,140}searchParams\.get\("v"\)/));
row("P62761", "the build tag says so honestly when it cannot read a hash", () => has(MENU(), '"kitchen (unknown)"'));
row("P62762", "reading the build tag is wrapped, so a odd URL cannot break the menu", () => hasRe(MENU(), /\} catch \(e\) \{\}/));
row("P62763", "the settings sheet exists", () => has(APPC(), "function openKitchenSettings()"));
row("P62764", "the settings sheet cannot be opened twice", () => hasRe(APPC(), /if \(document\.querySelector\("\.kset-ov"\)\) return;/));
row("P62765", "the settings sheet registers a back layer", () => hasRe(APPC(), /LFH_BACK\.layer\("kitchen-settings", close\)/));
row("P62766", "the settings sheet closes on its backdrop but not on a click inside it", () =>
  hasRe(APPC(), /ov\.onclick = \(e\) => \{ if \(e\.target === ov\) close\(\); \};/));
row("P62767", "the settings sheet is announced as a dialog with a label", () => hasRe(APPC(), /class="kset" role="dialog" aria-label="Kitchen settings"/));
row("P62768", "the sheet publishes an open flag, so a board read knows to repaint it", () => has(APPC(), "window.__kdsSettingsOpen = true"));
row("P62769", "that flag is cleared on close, so a closed sheet is never repainted", () => hasRe(APPC(), /const close = \(\) => \{\s*\n?\s*window\.__kdsSettingsOpen = false;/));
row("P62770", "a board read repaints an OPEN settings sheet, so it can never sit stale while a cook reads it", () =>
  hasRe(APPC(), /if \(window\.__kdsSettingsOpen\) renderKitchenSettings\(\);/));
row("P62771", "the sheet exposes its own close function for the ✕ inside the re-rendered markup", () => has(APPC(), "window.__kdsSettingsClose = close"));
row("P62772", "the ✕ inside the sheet calls it", () => hasRe(SET(), /\[data-kset-close\]"\)\.onclick = \(\) => window\.__kdsSettingsClose && window\.__kdsSettingsClose\(\);/));
row("P62773", "renderKitchenSettings bails harmlessly when the sheet is not on screen", () => hasRe(SET(), /if \(!box\) return;/));
// EXPECTATION CHANGED (T9 sweep #8, this run) — not a failure, the product moved. The rule this row
// defends is unchanged: printing is ABSENT, not greyed, when it is genuinely off. The CONDITION
// gained `&& !hlp`, because a print helper owning the paper is not "off" — the sheet used to go
// silent in exactly the case a cook most needs an answer (see P63207).
row("P62774", "printing is ABSENT, not greyed, when it is off for the restaurant (his standing rule)", () =>
  hasRe(SET(), /const printSection = \(!auto && tgt !== "counter" && !hlp\) \? "" :/));
row("P62775", "the sheet reads whether THIS screen may print, not merely whether the feature is on", () =>
  hasRe(SET(), /const auto = !!state\.autoPrintKot;/));
row("P62776", "the sheet says where tickets print in words, not in a code", () => {
  const s = SET();
  return (/the counter screen/.test(s) && /the kitchen screen/.test(s)) || "the target is shown as a raw value";
});
row("P62777", "the sheet says whether THIS screen is the one printing right now", () => hasRe(SET(), /const printingHere = !!\(st && st\.mine\);/));
row("P62778", "the sheet can name the OTHER screen that holds the printer", () =>
  hasRe(SET(), /const heldByOther = !!\(st && st\.active && !st\.mine && !st\.stale\);/));
row("P62779", "a station that has gone quiet says so rather than looking live", () => has(SET(), '" (gone quiet)"'));
row("P62780", "the holder's label and the person who claimed it are both escaped", () =>
  hasRe(SET(), /esc\(st\.active\.label[\s\S]{0,120}esc\(st\.active\.claimed_by\)/));
row("P62781", "a counter screen holding the printer is called \"A counter screen\", not \"editor\"", () =>
  has(SET(), 'st.active.panel === "editor" ? "A counter screen" : "A kitchen screen"'));
row("P62782", "the sheet tells a cook printing keeps working while this window is minimised", () =>
  has(SET(), "they keep coming when this window is minimised or covered"));
row("P62783", "the sheet says who decides which screen prints, rather than offering a control that would be refused", () =>
  has(SET(), "Aevidine chooses which screen prints, on the Printing screen."));
row("P62784", "the OLD take-over / stop-printing controls are gone (one printing system, not two)", () =>
  lacksRe(SET(), /data-kstation|Print here|Take the printer|Stop printing here/));
row("P62785", "the sheet holds the three device preferences", () => {
  const ids = [...SET().matchAll(/data-kset-click="(\w+)"/g)].map((m) => m[1]);
  return (ids.includes("muteBtn") && ids.includes("viewBtn") && ids.includes("themeToggle")) || `it offers: ${ids.join(", ")}`;
});
row("P62786", "those three are CLICKED THROUGH to the real buttons, never re-implemented", () =>
  hasRe(SET(), /const el = document\.getElementById\(b\.dataset\.ksetClick\);\s*\n?\s*if \(el\) el\.click\(\);/));
row("P62787", "the sheet repaints itself after one of those taps, so the label it shows is current", () =>
  hasRe(SET(), /if \(el\) el\.click\(\);\s*\n?\s*renderKitchenSettings\(\);/));
row("P62788", "the sheet says out loud that those three are remembered on this device only", () =>
  has(SET(), "These three are remembered on this device only."));
row("P62789", "the sheet has an Account section with a Sign out", () => {
  const s = SET();
  return (/<h4>Account<\/h4>/.test(s) && /Sign out<\/button>/.test(s)) || "there is no sign-out";
});
row("P62790", "Sign out is a FORM POST, never a link — a GET that ends a session fires from anything pointing at it", () =>
  hasRe(SET(), /<form method="post" action="\/api\/panel-logout"/));
row("P62791", "that form targets _top, or it would sign out the iframe and not the person", () =>
  hasRe(SET(), /action="\/api\/panel-logout" target="_top"/));
row("P62792", "the sign-out button is a real submit, so it works with no JavaScript at all", () =>
  hasRe(SET(), /<button type="submit" class="btn kset-danger"/));
row("P62793", "the sheet says what signing out does, and that the board keeps running for everyone else", () =>
  has(SET(), "The board keeps running for everyone else."));
row("P62794", "the settings sheet has NO profile surface of any kind", () => lacksRe(SET(), /Profile|My details|pay|payroll/i));
row("P62795", "every class the settings sheet renders is styled", () => {
  const used = new Set([...SET().matchAll(/class="(kset[\w-]*)"/g)].map((m) => m[1]));
  const c = CSS();
  const unstyled = [...used].filter((k) => !c.includes("." + k));
  return unstyled.length === 0 || `rendered but never styled: ${unstyled.join(", ")}`;
});
row("P62796", "every class the ☰ drawer renders is styled", () => {
  const used = new Set([...MENU().matchAll(/class="(kds-dw[\w-]*|dw-[\w-]+)"/g)].map((m) => m[1]));
  const c = CSS();
  const unstyled = [...used].filter((k) => !c.includes("." + k));
  return unstyled.length === 0 || `rendered but never styled: ${unstyled.join(", ")}`;
});
row("P62797", "the drawer and its backdrop are on different stacking layers, so the backdrop cannot cover the drawer", () => {
  const c = CSS();
  const dw = (c.match(/\.kds-dw\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
  const bd = (c.match(/\.kds-dw-backdrop\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
  return (dw && bd && Number(dw) > Number(bd)) || `drawer z=${dw}, backdrop z=${bd}`;
});
row("P62798", "the settings overlay sits above the ☰ drawer that opened it", () => {
  const c = CSS();
  const ov = (c.match(/\.kset-ov\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
  const dw = (c.match(/\.kds-dw\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
  return (ov && dw && Number(ov) >= Number(dw)) || `settings z=${ov}, drawer z=${dw}`;
});
row("P62799", "the sheet's own note class is styled in both skins or inherits a token", () => {
  const c = CSS();
  return has(c, ".kset-note");
});
row("P62800", "nothing in the ☰ menu or the settings sheet hard-codes a restaurant's name", () =>
  lacksRe(MENU() + SET(), /French House|Aangan|Pizza Palace/));
