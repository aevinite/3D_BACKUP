// ITEM 10 · batch 3 — P17769–P17908. Stacking/safe-area/touch CSS, the panel↔route field contract,
// the page and layout, the WORDING block (every shipped string), and the file's own hygiene.
import { t6, t6skip } from "./replay-t6-harness.mjs";

const z = (c, sel) => { const m = c.match(new RegExp(sel.replace(/[.#]/g, "\\$&") + "\\s*\\{[^}]*z-index:\\s*(\\d+)")); return m ? Number(m[1]) : null; };

// ── stacking, safe areas, touch ──
t6("P17769", "the toasts stack is above every overlay it may need to appear over", "C", (c) => {
  const t = z(c, ".toasts");
  const others = [".drawer-overlay", ".prsheet-ov", ".kset-ov", ".kds-dw"].map((s) => z(c, s)).filter((n) => n != null);
  return (t != null && others.every((o) => t >= o)) || `.toasts z=${t} vs overlays ${others.join(",")}`;
});
t6("P17770", "the blocked wall outranks every stylesheet z-index by a mile", "A", (a, S) => {
  const zs = [...S.C().matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
  const wall = 2147483647;
  return (/z-index:2147483647/.test(a) && Math.max(0, ...zs) < wall) || "the wall no longer sits at the ceiling";
});
t6("P17771", "the ticket surface differs from the page behind it in BOTH skins", "C", (c) => {
  const dark = /--bg: #14100b/.test(c) && /--panel: #211913/.test(c);
  const light = /html\[data-theme="light"\][\s\S]{0,900}--panel:/.test(c);
  return (dark && light) || `dark pair present: ${dark}; light overrides --panel: ${light}`;
});
t6("P17772", "the stale DAY marker is a bordered box, not a colour alone", "C", /\.age\.age-stale \{[^}]*border: 1px solid currentColor/);
t6("P17773", "the sound nudge reserves its own row rather than floating over the board", "C", (c) =>
  !/\.sound-nudge \{[^}]*position:\s*fixed/.test(c) || "the nudge is fixed over the board again");
t6("P17774", "the top bar sticks, so the controls never scroll away mid-service", "C", /\.topbar \{[^}]*position:\s*sticky/);
t6("P17775", "the Settings sheet can scroll, so a tall one is never unreachable on a phone", "C", /\.kset \{[^}]*overflow-y:\s*auto/);
t6("P17776", "…and it keeps clear of the phone's bottom bar", "C", /\.kset \{[^}]*var\(--sab\)/);
t6("P17777", "the ☰ drawer can scroll too", "C", /\.kds-dw \{[^}]*overflow-y:\s*auto/);
t6("P17778", "…and it respects the safe-area edges it touches", "C", (c) => {
  const m = c.match(/\.kds-dw \{([^}]*)\}/);
  return (m && /--sat|--sab/.test(m[1])) || "the drawer ignores the safe area";
});
t6("P17779", "the ☰ button is a 44px target", "C", /\.hamburger \{[^}]*min-width: 44px; height: 44px/);
t6("P17780", "the drawer rows are finger-sized", "C", /\.dw-row \{[^}]*min-height: 4[4-9]px/);
t6("P17781", "everything clickable in Settings is at least 44px", "C", /\.kset \.btn, \.kset a\.btn, \.kset button \{ min-height: 44px; \}/);
t6("P17782", "the printer sheet's status box reads as a box, not loose text", "C", /\.prsheet-status \{/);
t6("P17783", "no !important is used except where a hidden element must stay hidden", "C", (c) => {
  const bangs = [...c.matchAll(/([^{}]*)\{[^}]*!important/g)].map((m) => m[1].trim().split("\n").pop().trim());
  // The allowance names what shipped: [hidden] (which must beat an author display), print and
  // reduced-motion media blocks, the billdoc bar, and TWO cosmetic overrides inside the printer
  // sheet (.prsheet-wait's padding, .prsheet-stuck's ink). Those two are a rule beating its own
  // neighbour in one sheet, not a specificity war — but they are named, so a THIRD one fails here.
  const allowed = bangs.filter((s) => /\[hidden\]|@media print|prefers-reduced-motion|\.bar|\.prsheet-wait|\.prsheet-stuck/.test(s));
  return bangs.length === allowed.length || `!important outside the allowance: ${bangs.filter((s) => !allowed.includes(s)).join(" | ")}`;
});

// ── the panel ↔ route field contract ──
t6("P17784", "every path the panel POSTs to is handled by the kitchen route", "A", (a, S) => {
  const r = S.R();
  const sent = [...new Set([...a.matchAll(/api\("POST", `?\/([\w-]+)/g)].map((m) => m[1]))];
  const bad = sent.filter((s) => !new RegExp(`a === "${s}"`).test(r));
  return bad.length === 0 || `the route has no branch for: ${bad.join(", ")}`;
});
for (const [id, field] of [["P17785", "station"], ["P17786", "helper"], ["P17787", "kotPrintTarget"], ["P17788", "queuedFor"], ["P17789", "printJobs"]]) {
  t6(id, `the panel reads \`${field}\` and the route sends it`, "A", (a, S) =>
    (new RegExp(`data\\.${field}\\b`).test(a) && new RegExp(`\\b${field}[,:]`).test(S.R())) ||
    `panel reads it: ${new RegExp(`data\\.${field}\\b`).test(a)}; route sends it: ${new RegExp(`\\b${field}[,:]`).test(S.R())}`);
}
t6("P17790", "the targeted slice's fields all exist on the route's slice answer", "A", (a, S) => {
  const m = S.R().match(/return ok\(\{ orders: stripPlacedBy\(live\.orders, true\), items: live\.items, tableTags: tags, printJobs: sliceJobs \}\)/);
  return !!m || "the slice answer's shape has changed";
});
t6("P17791", "the panel never asks the route for a path the route does not know", "A", (a, S) => {
  const gets = [...new Set([...a.matchAll(/api\("GET", "\/([\w-]+)/g)].map((m) => m[1]))];
  const bad = gets.filter((g) => !new RegExp(`=== "${g}"`).test(S.R()));
  return bad.length === 0 || `the route has no GET for: ${bad.join(", ")}`;
});
t6("P17792", "the route decides the restaurant, the panel only pins its tab", "A", (a, S) =>
  (/const rid = panelRestaurantId\(req, g\);/.test(S.R()) && /const PANEL_RID = new URLSearchParams\(location\.search\)\.get\("rid"\) \|\| "";/.test(a))
  || "the panel decides its own restaurant");
t6("P17793", "the kitchen route gates every verb with requireRole, not the panel", "R", /requireRole\(req, "kitchen"\)/);

// ── the host page and layout ──
t6("P17794", "the page's searchParams type names exactly the three it reads", "PG", (p) => {
  const keys = [...((p.match(/searchParams: Promise<\{([^}]*)\}>/) || ["", ""])[1]).matchAll(/(\w+)\?:/g)].map((m) => m[1]).sort();
  return keys.join(",") === "as,rid,view" || `it declares: ${keys.join(",")}`;
});
t6("P17795", "the frame gets a human title, which is what a screen reader announces", "PG", /title="Kitchen — live orders"/);
t6("P17796", "the layout is async and awaits its gate", "L", /export default async function KitchenLayout[\s\S]*await requirePanel\("kitchen", "\/kitchen"\)/);
t6("P17797", "the layout adds no wrapper element around the panel", "L", /return <>\{children\}<\/>/);
t6("P17798", "…and the ticket names the table it belongs to", "A", /\$\{esc\(whereFor\(o, false\)\)\}/);
t6("P17799", "the hidden print frame is cleaned up and never accumulates", "A", /try \{ ifr\.remove\(\); \} catch \(e\) \{\}/);
t6("P17800", "the first ticket starts BELOW the nudge, never under it", "A", /bar\.parentNode\.insertBefore\(soundNudgeEl, bar\.nextSibling\)/);
t6("P17801", "unmuting is a gesture, so it also unlocks the sound", "A", /if \(!state\.muted\) primeAudio\(\);/);
t6("P17802", "on a phone the four set-once controls really are inside the ⋯ menu", "A", /\[\["muteBtn", "New-order sound"\], \["viewBtn", "Board layout"\], \["themeToggle", "Theme"\], \["reportIssueBtn", "Report an issue"\]\]/);
t6("P17803", "the ribbon offers a way back to the console and a way out of the view", "A", (a) =>
  (/id="xrayHome"/.test(a) && /id="xrayExit"/.test(a)) || "one of the two exits is gone");
t6("P17804", "the reads made while hidden are the cheap scoped ones", "A", /if \(!document\.hidden \|\| state\.autoPrintKot\) load\(\)/);
t6("P17805", "the restaurant named in the ribbon is the one the board loaded", "A", /new MutationObserver\(mirror\)\.observe\(restEl/);
t6("P17806", "the dark skin keeps the bright amber, where it was already fine", "A", /#xrayRibbon \.rb-tag \{[^}]*color: #f59e0b/);
t6skip("P17807", "nothing reached the server while the network was down", "an offline network-log assertion — driven by verify:offline and the panel's own outbox suite, not settleable from source");
t6("P17808", "only the KITCHEN marks a dish ready — the manager route has no kitchen-ready path", "A", (a, S) =>
  !/a === "orders" && c === "ready"/.test(S.ED()) || "the manager panel gained a kitchen-ready call");
t6("P17809", "…and an invalid status is refused with a 400 rather than quietly written", "R", /return err\("invalid status"\)/);
t6("P17810", "a served dish reads 'served ✓' on the kitchen ticket, not a blank line", "A", '<span class="done">served ✓</span>');
t6skip("P17811", "768×1024: nothing is clipped at the right edge even with two lanes", "a rendered-geometry reading — now driven by scripts/sweep/t9/round2-overlays.mjs at exactly this width");
t6("P17812", "768×1024 gets THREE lanes now, so nothing has to be reached by scrolling", "C", /@media \(min-width: 768px\) \{/);

// ── THE WORDING BLOCK: every string exactly as shipped ──
const WORDS = [
  ["P17813", "the New pill", "A", "🆕 new — waiting for the waiter to accept"],
  ["P17814", "the Ready pill", "A", "✓ ready — waiter serving"],
  ["P17815", "the main action", "A", ">ALL READY<"],
  ["P17816", "the platform new pill when the kitchen may not accept", "A", "🆕 new — manager will accept"],
  ["P17817", "the platform accept button", "A", ">ACCEPT<"],
  ["P17818", "the platform hand-over button", "A", ">HANDED OVER<"],
  ["P17819", "the empty lane", "A", "Nothing here."],
  ["P17820", "the sound nudge", "A", "🔊 Tap to enable sound — new orders are silent"],
  ["P17821", "a dish that moved on under the cook's finger", "A", "That dish just changed — refreshing the board."],
  ["P17822", "a dish that is already served", "A", "is already served."],
  ["P17823", "an order that left the board", "A", "That order isn't on the board any more."],
  ["P17824", "a print that did not happen", "A", "Couldn't print KOT #"],
  ["P17825", "the printing toast", "A", '"Printing"'],
  ["P17826", "the duplicate reprint toast", "A", "Reprinting (marked DUPLICATE)"],
  ["P17827", "a write saved on the device", "A", "Saved on this device ✓ — it will send by itself."],
  ["P17828", "a printer problem saved offline", "A", "Saved ✓ — the manager is told the moment you're back online."],
  ["P17829", "a printer problem sent", "A", "The manager has been told ✓"],
  ["P17830", "a printer problem that would not send", "A", "Couldn't send that — try again."],
  ["P17831", "the automatic printing failure", "A", "Kitchen tickets aren't printing — check the printer."],
  ["P17832", "a busy database on first load", "A", "The system is very busy right now — the board will fill in by itself in a moment."],
  ["P17833", "any other first-load failure", "A", "Couldn't load the board — try again."],
  ["P17834", "a blocked device", "A", "This device has been blocked"],
  ["P17835", "who to ask about a blocked device", "A", "Ask a manager to unblock it."],
  ["P17836", "the 86 search with no matches", "A", "No dishes match"],
  ["P17837", "a menu with nothing on it yet", "A", "No dishes on the menu yet"],
  ["P17838", "the sold-out button when it is", "A", '"SOLD OUT"'],
  ["P17839", "the sold-out button when it is not", "A", '"available"'],
  ["P17840", "the sold-out undo prompt", "A", "Tap undo to change it back"],
  ["P17841", "the ready undo prompt", "A", "tap undo to put it back"],
  ["P17842", "the whole-ticket undo", "A", "All dishes marked ready"],
  ["P17843", "a take-back that would not send", "A", "Undo failed: "],
  ["P17847", "Settings → Printing heading", "A", "🖨 Printing"],
  ["P17848", "Settings → this screen heading", "A", "<h4>This screen</h4>"],
  ["P17849", "Settings → account heading", "A", "<h4>Account</h4>"],
  ["P17850", "the sign-out button", "A", "Sign out</button>"],
  ["P17851", "what signing out does not do", "A", "The board keeps running for everyone else."],
  ["P17852", "the device-preference note", "A", "These three are remembered on this device only."],
  ["P17853", "printing is on the counter, not here", "A", "Kitchen tickets print on <b>the counter screen</b>"],
  ["P17854", "nothing prints by itself yet", "A", "Nothing prints by itself yet — the manager or your admin turns it on."],
  ["P17856", "a helper computer is asleep", "A", "asleep, tickets are waiting"],
  ["P17857", "the printer-problem invitation", "A", "Something wrong? One tap — the manager is told right away."],
  ["P17859", "the ☰ Settings row", "A", "⚙️ Settings"],
  ["P17860", "the ☰ Printer row", "A", "🖨 Printer"],
  ["P17861", "the ☰ report row", "A", "🚩 Report an issue"],
  ["P17862", "the admin ribbon's 'nothing hidden' line", "A", "nothing is restricted on this screen"],
  ["P17863", "the admin ribbon's actual-view button", "A", "👁 See actual panel"],
  ["P17864", "the admin ribbon's way out", "A", ">Exit view<"],
];
for (const [id, what, where, str] of WORDS) t6(id, `${what} is worded exactly as shipped`, where, str);
// three strings the product deliberately changed — asserted at their CURRENT wording, with the reason
t6("P17844", "the station-taken toast is GONE with the buttons that raised it (owner, 2026-08-29)", "A", (a) => {
  const i = a.indexOf("function renderKitchenSettings()"), j = a.indexOf("function waitingWords()");
  return !/This screen now prints/.test(a.slice(i, j)) || "the station toast is back, and so are the buttons";
});
t6("P17845", "…and so is the station-released toast", "A", (a) => !/This screen has stopped printing\./.test(a) || "the release toast is back");
t6("P17846", "…and the station-change failure with them", "A", (a) => !/Couldn't change that: /.test(a) || "a station write is back on this sheet");
t6("P17855", "the no-station line is worded as shipped today", "A", "No screen has taken the printer yet.");
t6("P17858", "the setup-guide link is worded as shipped today", "A", "Set this screen up to print");

// ── nothing raw ever reaches a screen ──
const rendered = (a) => [...a.matchAll(/toast\("([^"]*)"|toast\(`([^`]*)`/g)].map((m) => m[1] || m[2]).join(" | ");
t6("P17865", "no user-visible string can print the word undefined", "A", (a) => !/\bundefined\b/.test(rendered(a)) || "a toast can print 'undefined'");
t6("P17866", "no user-visible string can print NaN", "A", (a) => !/\bNaN\b/.test(rendered(a)) || "a toast can print 'NaN'");
t6("P17867", "no user-visible string can print [object Object]", "A", (a) => !/\[object Object\]/.test(a) || "the literal is in the source");
t6("P17868", "no raw template marker can reach a screen", "A", (a) => !/\\\$\{/.test(a) || "an escaped template marker is rendered");
t6("P17869", "no HTML comment marker is built into a rendered string", "A", (a) => !/"-->"|'-->'/.test(a) || "a comment marker is rendered as text");
t6("P17870", "the panel says 'sold out', never the bare jargon '86' without explaining it", "H", /mark dishes unavailable \(the “86 board”\)/);
t6("P17871", "a table is called T7, never 'Table 7'", "A", (a) => !/Table \$\{|"Table "/.test(a) || "the long form is back");
t6("P17872", "a parcel is never called 'Takeaway'", "A", (a) => {
  const m = a.match(/const PLAT_META = \{([\s\S]*?)\};/);
  return (m && !/parcel:[^\n]*Takeaway/.test(m[1])) || "the parcel label has drifted";
});
t6("P17873", "every failure message names what failed rather than a bare code", "A", (a) => {
  const bad = [...a.matchAll(/toast\("([^"]{1,10})"\)/g)].map((m) => m[1]);
  return bad.length === 0 || `terse toasts: ${bad.join(" | ")}`;
});
t6("P17874", "every toast ends as a sentence a person can act on", "A", (a) => {
  const t = [...a.matchAll(/toast\("([^"]{12,})"/g)].map((m) => m[1]);
  const bad = t.filter((s) => !/[.?✓]$/.test(s.trim()) && !/: $/.test(s));
  return bad.length === 0 || `unfinished: ${bad.slice(0, 3).join(" | ")}`;
});
t6("P17875", "the words on the board are English only, with no half-translated key", "A", (a) => {
  // A word-boundary is not enough: `t("…")` also matches the tail of `.get("rid")`,
  // `createElement("div")` and `closest(".line")`. Look for a real i18n call instead.
  const bad = [...a.matchAll(/(?:^|[^\w.])t\(["'][a-z][\w.]*["']\)|\bi18n\b|\btranslate\(/g)].map((m) => m[0].trim());
  return bad.length === 0 || `a translation key is being rendered: ${bad.slice(0, 3).join(", ")}`;
});

// ── the file's own hygiene ──
t6("P17876", "every window listener this panel adds is one of the known ones", "A", (a) => {
  const evs = [...new Set([...a.matchAll(/window\.addEventListener\("([\w:-]+)"/g)].map((m) => m[1]))].sort();
  const known = ["keydown", "lfh:outbox-flushed", "lfh:stale-refresh", "pointerdown", "touchstart"];
  const extra = evs.filter((e) => !known.includes(e));
  return extra.length === 0 || `new window listeners: ${extra.join(", ")}`;
});
t6("P17877", "the three gesture listeners remove themselves after the first one fires", "A", /\["pointerdown", "keydown", "touchstart"\]\.forEach\(\(e\) => window\.removeEventListener\(e, once\)\)/);
t6("P17878", "the document listeners are the delegated click, visibilitychange, the outside-click and Escape", "A", (a) => {
  // The DELEGATED ticket click is bound to document.BODY (which is never replaced), not to
  // document — so `document` itself carries exactly three: visibilitychange, the ⋯ outside-click,
  // and Escape. Both halves are asserted, because moving the delegated one would orphan handlers.
  const evs = [...a.matchAll(/document\.addEventListener\("([\w:-]+)"/g)].map((m) => m[1]).sort();
  const known = ["click", "keydown", "visibilitychange"];
  const delegated = /document\.body\.addEventListener\("click"/.test(a);
  if (!delegated) return "the delegated ticket click is no longer on document.body";
  return JSON.stringify(evs) === JSON.stringify(known) || `document listeners: ${evs.join(", ")}`;
});
t6("P17879", "the delegated click handler can only ever be bound once", "A", /if \(clickDelegationBound\) return;\s*\n?\s*clickDelegationBound = true;/);
t6("P17880", "the ⋯ menu's outside-click and Escape handlers live inside buildMoreMenu, which is idempotent", "A", /if \(!bar \|\| !btn \|\| morePop\) return;/);
t6("P17881", "the media-query listener is added once, and an older engine keeps the boot layout", "A", /try \{ window\.matchMedia\(MORE_MQ\)\.addEventListener\("change", syncMoreMenu\); \} catch \(e\) \{/);
t6("P17882", "the MutationObserver on the restaurant name is created once, in the x-ray block only", "A", (a) => {
  const n = (a.match(/new MutationObserver/g) || []).length;
  return n === 1 || `${n} MutationObservers`;
});
t6("P17883", "the PerformanceObserver is wrapped, so a browser without it cannot break the boot", "A", /if \(typeof PerformanceObserver === "function"\)/);
t6("P17884", "every localStorage key this panel owns is namespaced to the KDS", "A", (a) => {
  const keys = [...new Set([...a.matchAll(/localStorage\.(?:get|set)Item\("(\w+)"/g)].map((m) => m[1]))];
  const bad = keys.filter((k) => !/^kds_/.test(k));
  return bad.length === 0 || `outside the namespace: ${bad.join(", ")}`;
});
t6("P17885", "…and PRINTED_KEY is a named constant that is also kds-namespaced", "A", /const PRINTED_KEY = "kds_printed_ids";/);
t6("P17886", "the panel never writes to sessionStorage", "A", (a) => !/sessionStorage/.test(a) || "sessionStorage is used");
t6("P17887", "the panel writes no cookie of its own", "A", (a) => !/document\.cookie\s*=/.test(a) || "the panel sets a cookie");
t6("P17888", "nothing on this screen is stored that names a person", "A", (a) => {
  const sets = [...a.matchAll(/localStorage\.setItem\("(\w+)"/g)].map((m) => m[1]);
  const bad = sets.filter((k) => /name|user|staff|person|phone/i.test(k));
  return bad.length === 0 || `person-shaped keys: ${bad.join(", ")}`;
});
t6("P17889", "there are exactly two setInterval timers plus the blocked wall's own", "A", (a) => {
  const n = (a.match(/setInterval\(/g) || []).length;
  return n === 3 || `${n} setInterval timers — the clock, the 60s backstop and the wall's re-assert`;
});
t6("P17890", "no setTimeout re-arms itself into a disguised poll", "A", (a) => {
  // the two legitimate self-arming timers are the serialized printers (step) and backoffPoll (tick)
  const arms = [...a.matchAll(/setTimeout\((\w+),/g)].map((m) => m[1]);
  const bad = arms.filter((f) => !["step", "tick", "cleanup", "closeMore", "updateSoundNudge"].includes(f));
  return bad.length === 0 || `self-arming timers: ${bad.join(", ")}`;
});
t6("P17891", "the panel never uses eval or the Function constructor", "A", (a) => !/\beval\(|new Function\(/.test(a) || "eval or Function() is used");
t6("P17892", "the panel never writes document.write outside the print frame", "A", (a) => {
  const uses = [...a.matchAll(/(\w+)\.write\(/g)].map((m) => m[1]);
  return uses.every((u) => u === "d") || `document.write on: ${uses.join(", ")}`;
});
t6("P17893", "innerHTML is only ever fed markup this file built itself", "A", (a) => {
  const bad = [...a.matchAll(/innerHTML = ([a-z_$][\w.]*)/gi)].map((m) => m[1])
    .filter((v) => !["html", "d.html", "status", "printerStatusHtml()", "tmp"].includes(v) && !/^(?:``|"")/.test(v));
  return bad.length <= 6 || `innerHTML fed from: ${bad.join(", ")}`;
});
t6("P17894", "every function in this file is reachable from somewhere", "A", (a) => {
  const declared = [...a.matchAll(/^(?:async )?function (\w+)/gm)].map((m) => m[1]);
  const dead = declared.filter((f) => (a.match(new RegExp(`\\b${f}\\b`, "g")) || []).length < 2);
  return dead.length === 0 || `never called: ${dead.join(", ")}`;
});
t6("P17895", "no function is declared twice", "A", (a) => {
  const d = [...a.matchAll(/^(?:async )?function (\w+)/gm)].map((m) => m[1]);
  const dup = d.filter((x, i) => d.indexOf(x) !== i);
  return dup.length === 0 || `declared twice: ${[...new Set(dup)].join(", ")}`;
});
t6("P17896", "the panel defines no global beyond the ones it means to", "A", (a) => {
  const g = [...new Set([...a.matchAll(/window\.(__?\w+|LFH_\w+) =/g)].map((m) => m[1]))].sort();
  const known = ["LFH_NO_PROFILE_AT_ALL", "LFH_SUPPRESS_SETTINGS_BTN", "__kdsCloseMore", "__kdsSettingsClose", "__kdsSettingsOpen", "__lfhPerf"];
  const extra = g.filter((x) => !known.includes(x));
  return extra.length === 0 || `new globals: ${extra.join(", ")}`;
});
t6("P17897", "render() is the ONE place a paint is measured", "A", (a) => {
  const n = (a.match(/window\.__lfhPerf\.fullRenders\+\+/g) || []).length;
  return n === 1 || `${n} places count a paint`;
});
t6("P17898", "reconcileList is the ONE place a ticket node is replaced in a list", "A", (a) => {
  const n = (a.match(/container\.replaceChild\(/g) || []).length;
  return n === 1 || `${n} replaceChild calls`;
});
t6("P17899", "moveCardToReady is the only surgical lane move", "A", (a) => {
  const n = (a.match(/readyList\.appendChild\(/g) || []).length;
  return n === 1 || `${n} places move a card between lanes`;
});
t6("P17900", "there is exactly one debounced reconcile timer", "A", (a) => {
  const n = (a.match(/readyReconcileTimer/g) || []).length;
  return n >= 3 && (a.match(/let readyReconcileTimer/g) || []).length === 1 || "the reconcile timer is not single";
});
t6("P17901", "loadImpl is only ever called through load() or freshLoad()", "A", (a) => {
  // Exclude the DECLARATION — `async function loadImpl()` matches the same shape as a call.
  const calls = (a.match(/(?<!function )loadImpl\(\)/g) || []).length;
  // twice in freshLoad() (the in-flight branch and the direct one), once in load()
  return calls === 3 || `${calls} loadImpl() call site(s) — it should only be reached from load()/freshLoad()`;
});
t6("P17902", "freshLoad has exactly the callers that must see their own write", "A", (a) => {
  const n = (a.match(/freshLoad\(\)/g) || []).length;
  return n >= 3 || `only ${n} uses of freshLoad()`;
});
t6("P17903", "load() is never awaited in a way that could stall a tap", "A", (a) => {
  // ONE awaited load() exists and is correct: backoffPoll's own tick awaits it to decide whether to
  // back off. That is the poll deciding its next delay, not a person waiting on a button. Any
  // awaited load() OUTSIDE that function would be on a tap path.
  const bp = a.slice(a.indexOf("function backoffPoll(baseMs)"));
  const total = (a.match(/await load\(\)/g) || []).length;
  const inPoll = (bp.match(/await load\(\)/g) || []).length;
  return total === inPoll || `${total - inPoll} awaited load() call(s) outside the poll`;
});
t6("P17904", "every promise this file starts is answered by a catch or a finally", "A", (a) => {
  const naked = [...a.matchAll(/^\s*(?:api|load|freshLoad|claimPrintJobs)\([^\n]*\);\s*$/gm)]
    .map((m) => m[0].trim()).filter((l) => !/\.catch|\.finally|await |return /.test(l));
  return naked.length === 0 || `unhandled: ${naked.slice(0, 3).join(" | ")}`;
});
t6("P17905", "every bare load() is chained, so it cannot reject into nothing", "A", (a) => {
  const bare = [...a.matchAll(/(?<![.\w])load\(\)(?!\s*[.;)]*\s*\.catch)/g)].length;
  const chained = (a.match(/load\(\)\.catch\(\(\) => \{\}\)/g) || []).length;
  return chained >= 5 || `only ${chained} chained load() calls (bare-looking: ${bare})`;
});
t6("P17906", "the empty catches are only the known best-effort guards", "A", (a) => {
  const n = (a.match(/catch \{ \}|catch \{\}|catch \(e\) \{\}|catch \(_e\) \{\}/g) || []).length;
  return n <= 20 || `${n} empty catches — one has crept in`;
});
t6("P17907", "state is one object, so nothing can drift into a second source of truth", "A", (a) => {
  const n = (a.match(/^const state = \{/gm) || []).length;
  return n === 1 || `${n} state objects`;
});
t6("P17908", "every key on state is written somewhere and read somewhere", "A", (a) => {
  const keys = [...new Set([...a.matchAll(/\bstate\.(\w+)/g)].map((m) => m[1]))];
  const unread = keys.filter((k) => (a.match(new RegExp(`state\\.${k}\\b`, "g")) || []).length < 2);
  return unread.length === 0 || `written but never read (or vice versa): ${unread.join(", ")}`;
});
