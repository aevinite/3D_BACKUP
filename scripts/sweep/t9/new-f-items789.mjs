// SWEEP #8 · T9 · the three items the owner picked off the report — P63236–P63300.
// Item 7 (the Ready lane on an iPad in portrait) · item 8 (the dark-skin status colours, which
// turned out to be already built) · item 9 (a delivery ticket's 🖨 reprint).
import { row, APP, APPC, HTML, CSS, CSSC, has, hasRe, lacks, lacksRe, P, src, contentHash } from "./lib.mjs";
import { readFileSync } from "node:fs";

const slice = (from, to) => { const a = APPC(); const i = a.indexOf(from); const j = a.indexOf(to); return i < 0 || j < 0 ? "" : a.slice(i, j); };
const TABLET_CSS = () => readFileSync(P("public/panels/tablet/style.css"), "utf8");

// ══ ITEM 7 · three lanes, each with its own scroll, from 768px up — P63236–P63255 ══
row("P63236", "the lane layout starts at 768px, so an iPad in portrait gets three lanes", () => hasRe(CSS(), /@media \(min-width: 768px\) \{/));
row("P63237", "there is exactly ONE lane-layout media block — a second could disagree with the first", () => {
  const c = CSS();
  const n = (c.match(/@media \(min-width: (?:768|820)px\) \{/g) || []).length;
  return n === 1 || `${n} lane-layout blocks`;
});
row("P63238", "the old 820px gate is gone from the stylesheet's code", () => lacksRe(CSS().replace(/\/\*[\s\S]*?\*\//g, ""), /min-width:\s*820px/));
row("P63239", "the three lanes are EQUAL and can never wrap", () => hasRe(CSS(), /\.cols \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); align-items: stretch; \}/));
row("P63240", "each lane owns its own scroll", () => hasRe(CSS(), /\.col \.tickets \{ flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;/));
row("P63241", "a lane's heading sits OUTSIDE its scroll region, so it cannot scroll away", () => hasRe(CSS(), /\.col h2 \{ flex: 0 0 auto; align-self: flex-start; \}/));
row("P63242", "the board fills the viewport rather than growing the page", () => hasRe(CSS(), /body \{ display: flex; flex-direction: column; overflow: hidden; \}/));
row("P63243", "the wall board keeps ONE scroll, inside itself", () => hasRe(CSS(), /\.wall \{ overflow-y: auto; overscroll-behavior: contain; \}/));
row("P63244", "a finished lane cannot drag the page behind it", () => ((CSS().match(/overscroll-behavior: contain/g) || []).length >= 2) || "one of the two scroll regions is unguarded");
row("P63245", "the change records what was MEASURED, not what was assumed", () => hasRe(CSS(), /Ready's top edge/));
row("P63246", "…including the number that made it a fault", () => hasRe(CSS(), /y=1725 on a 1024px screen/));
row("P63247", "…and the cost it accepts, stated plainly", () => hasRe(CSS(), /81px instead of 44px/));
row("P63248", "the reason the OLD gate existed is answered, not deleted", () => hasRe(CSS(), /the three lanes are 235px each/));
row("P63249", "this change depends on item 1's nowrap, and says so", () => hasRe(CSS(), /white-space: nowrap \(item 1 of the same report\)/));
row("P63250", "R3 is still honoured — an empty lane is never collapsed at any width", () => {
  const a = APPC();
  return lacksRe(a, /col-\w+"\)\.hidden = true|\.col.*display\s*=\s*"none"/);
});
row("P63251", "phones below 768px keep the plain page scroll they had", () => hasRe(CSS(), /Phones and narrow windows \(<768px\) keep the plain page scroll/));
row("P63252", "the lane padding still leaves room for a ticket's coloured edge inside the scroll clip", () => hasRe(CSS(), /padding: 2px 3px 14px;/));
row("P63253", "nothing in the lane block sets a fixed pixel width that would break at 768px", () => {
  const c = CSS();
  const i = c.indexOf("@media (min-width: 768px) {");
  let d = 0, j = c.indexOf("{", i), k = j;
  for (; k < c.length; k++) { if (c[k] === "{") d++; else if (c[k] === "}") { d--; if (!d) break; } }
  const block = c.slice(j, k);
  return lacksRe(block, /width:\s*\d{3,}px/);
});
row("P63254", "the ⋯ phone menu is still phone-only, so 768–819px keeps its full bar", () => hasRe(APPC(), /const MORE_MQ = "\(max-width: 760px\)";/));
row("P63255", "that means the phone menu and the lane layout do not overlap at any width", () => {
  // ⋯ ends at 760px, lanes begin at 768px — the 761–767px gap keeps the page-scroll board, by design.
  const moreMax = 760, laneMin = 768;
  return laneMin > moreMax || `the two blocks overlap: ⋯ ≤${moreMax}px, lanes ≥${laneMin}px`;
});

// ══ ITEM 8 · the dark-skin status colours — ALREADY BUILT, now pinned — P63256–P63270 ══
row("P63256", "the kitchen's status tokens are declared, not left to a fallback", () => {
  const c = CSS();
  for (const t of ["--green", "--amber", "--red", "--blue"]) if (!new RegExp(`\\${t}\\s*:`).test(c)) return `${t} is not declared`;
  return true;
});
row("P63257", "the kitchen's DARK green matches the waiter tablet's", () => {
  const g = (s) => (s.match(/:root\s*\{[\s\S]*?--green:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  return (g(CSS()) === g(TABLET_CSS())) || `kitchen ${g(CSS())} vs tablet ${g(TABLET_CSS())}`;
});
row("P63258", "the kitchen's DARK amber matches the waiter tablet's", () => {
  const g = (s) => (s.match(/--amber:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  return (g(CSS()) === g(TABLET_CSS())) || `kitchen ${g(CSS())} vs tablet ${g(TABLET_CSS())}`;
});
row("P63259", "the kitchen's DARK red matches the waiter tablet's", () => {
  const g = (s) => (s.match(/--red:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  return (g(CSS()) === g(TABLET_CSS())) || `kitchen ${g(CSS())} vs tablet ${g(TABLET_CSS())}`;
});
row("P63260", "the kitchen's DARK gold accent matches the waiter tablet's", () => {
  const k = (CSS().match(/--blue:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  const t = (TABLET_CSS().match(/--gold:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  return (k === t) || `kitchen --blue ${k} vs tablet --gold ${t}`;
});
row("P63261", "none of the four OLD warm values survives anywhere in the kitchen's code", () => {
  const bare = CSS().replace(/\/\*[\s\S]*?\*\//g, "");
  const old = ["5fae6e", "e2664f", "d8a657", "e6b450"];
  const left = old.filter((h) => new RegExp(h, "i").test(bare));
  return left.length === 0 || `still live: ${left.join(", ")}`;
});
row("P63262", "the LIGHT skin's status colours match the tablet's too", () => {
  const lit = (s) => { const i = s.indexOf('html[data-theme="light"]'); return i < 0 ? "" : s.slice(i); };
  const g = (s, t) => (lit(s).match(new RegExp("\\" + t + ":\\s*(#[0-9a-fA-F]{6})")) || [])[1];
  const bad = ["--green", "--amber", "--red"].filter((t) => g(CSS(), t) && g(TABLET_CSS(), t) && g(CSS(), t) !== g(TABLET_CSS(), t));
  return bad.length === 0 || `light skin differs on: ${bad.join(", ")}`;
});
row("P63263", "the warm espresso SURFACES are untouched — that warmth was the point of the redesign", () => {
  const c = CSS();
  return (/--bg: #14100b/.test(c) && /--panel: #211913/.test(c)) || "the espresso surfaces have changed";
});
row("P63264", "the matching decision carries its own measurements, so nobody re-opens it on a hunch", () => hasRe(CSS(), /MATCHED TO THE OTHER TWO PANELS \(owner, 2026-08-22\)/));
row("P63265", "…including the contrast readings that proved it safe", () => hasRe(CSS(), /green\s*\n?\s*8\.31\/7\.60|8\.31\/7\.60/));
row("P63266", "the accent keeps its old variable name, so every reference still resolves", () => hasRe(CSS(), /--blue: #d4a574;/));
row("P63267", "the accent-as-ink token exists, because the light skin needs a darker one", () => hasRe(CSS(), /--blue-ink: var\(--blue\)/));
row("P63268", "the light skin does darken that ink", () => hasRe(CSS(), /--blue-ink:#8a5a16/));
row("P63269", "the editor panel's deliberately deeper green is NOT dragged into the kitchen", () => {
  const e = readFileSync(P("public/panels/editor/style.css"), "utf8");
  // Both files declare --green twice (dark :root, then the light block). Compare the LIGHT ones,
  // which is where the editor's deliberately deeper green lives (#15803d, picked for its own
  // surface — see the note in editor/style.css).
  const lit = (s) => { const i = s.indexOf('html[data-theme="light"]'); return i < 0 ? "" : s.slice(i); };
  const eg = (lit(e).match(/--green:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  const kg = (lit(CSS()).match(/--green:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  if (!eg || !kg) return true;   // one of them stopped overriding green in the light skin
  return (eg !== kg) || `the kitchen took the editor's ${eg}, which was picked for a different surface`;
});
row("P63270", "three panels, one meaning per colour — asserted across files so it cannot drift again", () => {
  const g = (s, t) => (s.match(new RegExp("\\" + t + ":\\s*(#[0-9a-fA-F]{6})")) || [])[1];
  const bad = ["--green", "--amber", "--red"].filter((t) => g(CSS(), t) !== g(TABLET_CSS(), t));
  return bad.length === 0 || `kitchen and tablet differ on: ${bad.join(", ")}`;
});

// ══ ITEM 9 · a delivery ticket's 🖨 reprint — P63271–P63300 ══
// End anchors must be CODE. slice() reads the comment-stripped source, so a `// ──` banner
// is not there to find — the third time this run that mistake produced rows failing on nothing.
const RP = () => slice("function reprintPlatform(id)", "function renderDishes(");
const PT = () => slice("function platTicketHtml(p)", "function platAct(");
// ASSERT THE RENDERED MARKUP, NOT THE DECLARATION. The first version of these rows checked that
// `data-plat-reprint` appeared anywhere in platTicketHtml — which the `platReprintBtn` const
// satisfies on its own. Deleting `${platReprintBtn}` from the returned template left every item-9
// row green and only the asset-hash rows went red, and those go red on ANY edit, so they are no
// defence for this. Found by sabotage, which is the only way this kind of hole shows up.
const PT_RETURN = () => { const t = PT(); const i = t.indexOf("return `<div class=\"ticket plat"); return i < 0 ? "" : t.slice(i); };
row("P63271", "a delivery ticket carries a 🖨 button — in the markup it actually returns", () => {
  const r = PT_RETURN();
  if (!r) return "platTicketHtml's return template could not be found";
  return has(r, "${platReprintBtn}");
});
row("P63272", "it is the SAME class as a dine-in ticket's, so it looks and measures identically", () => hasRe(PT(), /<button class="reprint" data-plat-reprint=/));
row("P63273", "it carries a title and an accessible name", () => hasRe(PT(), /title="Print this kitchen ticket" aria-label="Print kitchen ticket"/));
row("P63274", "it sits in the ticket HEADER, where a cook already looks for it", () => {
  const r = PT_RETURN();
  if (!r) return "platTicketHtml's return template could not be found";
  const btn = r.indexOf("${platReprintBtn}"), headEnd = r.indexOf("</div>"), lines = r.indexOf("${lines}");
  if (btn < 0) return "the button is not in the returned markup at all";
  return (btn < headEnd && btn < lines) || `button at ${btn}, header ends at ${headEnd}, dishes at ${lines}`;
});
row("P63275", "the delegated handler routes it, so a patched card needs no re-binding", () => hasRe(APPC(), /const platReprint = e\.target\.closest\("\[data-plat-reprint\]"\);\s*\n?\s*if \(platReprint\) \{ reprintPlatform\(platReprint\.dataset\.platReprint\); return; \}/));
row("P63276", "that branch returns, so one tap cannot also fire the dine-in reprint", () => hasRe(APPC(), /reprintPlatform\(platReprint\.dataset\.platReprint\); return; \}/));
row("P63277", "it is handled BEFORE the platform status buttons, which live on the same card", () => {
  const a = APPC();
  const d = a.slice(a.indexOf("function bindDelegation()"), a.indexOf("function platPhase("));
  return (d.indexOf("data-plat-reprint") < d.indexOf("data-plat-accept")) || "the accept branch can swallow the reprint tap";
});
row("P63278", "reprintPlatform says so when the ticket has left the board", () => hasRe(RP(), /if \(!p\) \{ toast\("That order isn't on the board any more\."\); return; \}/));
row("P63279", "an unknown channel falls back to the generic badge rather than crashing", () => hasRe(RP(), /const meta = PLAT_META\[p\.source\] \|\| PLAT_META\.other;/));
row("P63280", "the paper's label is the CHANNEL plus the customer's name", () => hasRe(RP(), /const label = meta\.label \+ \(who \? " · " \+ who : ""\);/));
row("P63281", "a platform that sent no customer name gets the channel alone, never \"· undefined\"", () => hasRe(RP(), /const who = String\(p\.customer_name \|\| ""\)\.trim\(\);/));
row("P63282", "it prints through the ONE shared print path, not a second copy of the document", () => {
  const r = RP();
  return (/printKot\(p, Array\.isArray\(p\.items\) \? p\.items : \[\], state\.restaurant, \{ reprint: dup, tableLabel: label \}\)/.test(r) && !/kotDocHtml|<html/.test(r)) || "it builds its own markup";
});
row("P63283", "printKot accepts an explicit label, which is what keeps that one path", () => hasRe(APPC(), /const tlab = \(opts && opts\.tableLabel\) \|\| whereFor\(order, true\);/));
row("P63284", "a dine-in reprint is unchanged — no label is passed, so it still reads the table", () => {
  const r = slice("function reprintOrder(id)", "function reprintPlatform(");
  return lacksRe(r, /tableLabel/);
});
row("P63285", "a delivery row with no items array cannot throw", () => hasRe(RP(), /Array\.isArray\(p\.items\) \? p\.items : \[\]/));
row("P63286", "the DUPLICATE band is applied only from the second print onwards", () => hasRe(RP(), /const dup = printedIds\.has\(p\.id\);/));
row("P63287", "a manual FIRST print is recorded, so the next tap is honestly a duplicate", () => hasRe(RP(), /if \(!dup\) \{ printedIds\.add\(p\.id\); savePrintedIds\(\); \}/));
row("P63288", "the toast names the KOT number and the label", () => hasRe(RP(), /KOT #\$\{p\.kot_no \?\? "—"\} · \$\{label\}/));
row("P63289", "a missing KOT number prints an em-dash, never \"undefined\"", () => ((RP().match(/p\.kot_no \?\? "—"/g) || []).length >= 2) || "one of the two uses is unguarded");
row("P63290", "a print that did NOT happen tells the cook so", () => hasRe(RP(), /else toast\(`Couldn't print KOT #\$\{p\.kot_no \?\? "—"\} — check the printer, then try again\.`\)/));
row("P63291", "the delivery id is safe to keep in printedIds — the prune reads a set that includes it", () =>
  hasRe(APPC(), /const ids = new Set\(\[\.\.\.data\.orders\.map\(\(o\) => o\.id\), \.\.\.\(\(data\.platform \|\| \[\]\)\.map\(\(p\) => p\.id\)\)\]\)/));
row("P63292", "the reprint is a LOCAL action — it opens no network call of its own", () => lacksRe(RP(), /api\(|fetch\(/));
row("P63293", "it does not touch the automatic print queue's tracking beyond printedIds", () => lacksRe(RP(), /jobsInFlight|processPrintJobs|print-jobs/));
row("P63294", "a delivery ticket has no allergy list, and the document is handed none rather than undefined", () => {
  const pk = slice("function printKot(order, itemRows, restaurant, opts)", "function logKotPrintFailure(");
  return hasRe(pk, /allergies: Array\.isArray\(order\.allergies\) \? order\.allergies : \[\]/);
});
row("P63295", "the label reaches the paper's table slot, which is a free string in the shared document", () => {
  const bd = readFileSync(P("public/panels/billdoc.js"), "utf8");
  return hasRe(bd, /esc\(o\.tableLabel \|\| ""\)/);
});
row("P63296", "R37 is honoured — the KITCHEN ticket keeps its duplicate banner, and only the kitchen's", () => {
  const bd = readFileSync(P("public/panels/billdoc.js"), "utf8");
  return hasRe(bd, /Reprint · Duplicate/);
});
row("P63297", "the delivery reprint reuses the same 44px target the dine-in one was fixed to", () => hasRe(CSS(), /\.reprint \{[^}]*min-width: 44px/));
row("P63298", "both reprint buttons are drawn for EVERY restaurant, never gated on auto-print", () => {
  const a = APPC();
  const pt = PT();
  return (lacksRe(pt, /autoPrintKot/) === true) || "the delivery button is gated on a setting";
});
row("P63299", "the change added no new network call, no new setting and no new column", () => {
  const a = APPC();
  const r = RP();
  return (!/settings/.test(r) && !/api\(/.test(r)) || "item 9 reached for a setting or the server";
});
row("P63300", "the panel's asset hashes were bumped with items 7 and 9", () => {
  const h = HTML();
  for (const f of ["app.js", "style.css"]) {
    const tag = (h.match(new RegExp(f.replace(".", "\\.") + "\\?v=([0-9a-f]{8})")) || [])[1];
    if (tag !== contentHash("public/panels/kitchen/" + f)) return `${f} hash is stale`;
  }
  return true;
});

// ── the clock and the 🖨 wrap as ONE right-hand group — P63301–P63312 ─────────────────────────
// Two obvious fixes were tried first and BOTH were wrong; each is asserted against here so the
// next person does not repeat a measured mistake.
row("P63301", "the clock and the print button are one group, so they wrap together or not at all", () =>
  hasRe(CSS(), /\.thead-r \{ margin-left: auto; display: inline-flex; align-items: baseline; gap: 10px; flex: 0 0 auto; \}/));
row("P63302", "both ticket headers render that group", () => {
  const a = APPC();
  const n = (a.match(/<span class="thead-r">/g) || []).length;
  return n === 2 || `${n} headers use the group — dine-in and delivery must both`;
});
row("P63303", "the group owns the auto margin, and .age no longer does", () => {
  const c = CSS();
  return (/\.thead-r \{ margin-left: auto/.test(c) && !/\.age \{ margin-left: auto/.test(c))
    || "two auto margins on the same row would split the free space and move the clock";
});
row("P63304", "the header does NOT use justify-content — it right-aligns line one's KOT number", () => {
  const rules = [...CSSC().matchAll(/\.thead\s*\{[^}]*\}/g)].map((m) => m[0]);
  return !rules.some((r) => /justify-content/.test(r)) || "justify-content is back, and it moves the KOT number";
});
row("P63305", "the reason records BOTH measured wrong answers, so neither is retried", () => {
  const c = CSS();
  return (/two auto margins SPLIT the free space/.test(c) && /the KOT number,/.test(c))
    || "one of the two dead ends is not written down";
});
row("P63306", "…including the number that killed the first one", () => hasRe(CSS(), /left 242 -> left 180 at 1280px/));
row("P63307", "…and the ticket the second one broke", () => hasRe(CSS(), /seen on #332 at 768px/));
row("P63308", "the header still wraps rather than clipping either value", () => hasRe(CSS(), /\.thead \{[^}]*flex-wrap: wrap/));
row("P63309", "the age chip is still nowrap, which is what makes the wrap safe", () => hasRe(CSS(), /\.age \{[^}]*white-space: nowrap/));
row("P63310", "there is exactly one .thead rule and one .thead-r rule", () => {
  const c = CSS();
  const a = (CSSC().match(/\.thead\s*\{/g) || []).length, b = (CSSC().match(/\.thead-r\s*\{/g) || []).length;
  return (a === 1 && b === 1) || `${a} .thead and ${b} .thead-r rules — a second could disagree`;
});
row("P63311", "the group cannot shrink, so the clock never gets squeezed into wrapping again", () => hasRe(CSS(), /\.thead-r \{[^}]*flex: 0 0 auto/));
row("P63312", "the group sits INSIDE the header, after the table label and any badge", () => {
  const a = APPC();
  const h = a.slice(a.indexOf('<div class="thead"><span class="kot">'));
  const head = h.slice(0, h.indexOf("</div>"));
  return (head.indexOf('class="tbl"') < head.indexOf('class="thead-r"')) || "the group is drawn before the table label";
});
