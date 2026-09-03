// ITEM 10 · batch 2 — P17661–P17768. Settings' station rows, the printer sheet, the queue client,
// printKot, printedIds, index.html's script order and markup, and the stylesheet's own invariants.
import { t6, t6skip } from "./replay-t6-harness.mjs";

const setSec = (a) => { const i = a.indexOf("function renderKitchenSettings()"), j = a.indexOf("function waitingWords()"); return a.slice(i, j); };
const sheet  = (a) => { const i = a.indexOf("function openPrinterSheet()"), j = a.indexOf("const NET_AFTER_MS"); return a.slice(i, j); };
const status = (a) => { const i = a.indexOf("function printerStatusHtml()"), j = a.indexOf("function paintPrinterSheetStatus()"); return a.slice(i, j); };
const ppj    = (a) => { const i = a.indexOf("function processPrintJobs(jobs)"), j = a.indexOf("let kdsDrawerOff"); return a.slice(i, j); };
const net    = (a) => { const i = a.indexOf("function autoPrintNet("), j = a.indexOf('if (typeof document !== "undefined") {'); return a.slice(i, j); };
const pk     = (a) => { const i = a.indexOf("function printKot(order, itemRows, restaurant, opts)"), j = a.indexOf("function logKotPrintFailure("); return a.slice(i, j); };

// ── Settings: the station rows, escaping, and Sign out ──
// EXPECTATION CHANGED (owner, 2026-08-29, "there is two printing things"): the take-over / stop /
// setup controls were REMOVED from this sheet — the admin names one screen on the Printing board.
// So the two rows about those buttons now assert their ABSENCE, which is the shipped rule.
t6("P17661", "the take-over button is GONE — one printing system, not two (owner, 2026-08-29)", "A", (a) => !/data-kstation/.test(setSec(a)) || "a take-over control is back on this sheet");
t6("P17662", "…and the no-station case says WHO decides instead", "A", /Aevidine chooses which screen prints, on the Printing screen\./);
t6("P17663", "every value Settings prints from the server is escaped", "A", (a) => {
  const s = setSec(a);
  const holes = [...s.matchAll(/\$\{(st\.active\.[\w.]+|hlp\.[\w.]+|where|holder)\}/g)].map((m) => m[1]);
  // `holder` and `where` are escaped where they are BUILT / at the render site. hlp.printer and
  // hlp.agent are deliberately raw inside `where` — esc(where) escapes them once, and escaping
  // them here as well is the bug that printed "Shop&#39;s computer" on this sheet.
  const bad = holes.filter((h) => !/^(holder|where|hlp\.printer|hlp\.agent)$/.test(h));
  const escapedAtRender = /<b>\$\{esc\(where\)\}<\/b>/.test(s);
  if (!escapedAtRender) return "the where row is inserted unescaped";
  return bad.length === 0 || `unescaped: ${bad.join(", ")}`;
});
t6("P17664", "the station label falls back to a readable name when the row has none", "A", /st\.active\.panel === "editor" \? "A counter screen" : "A kitchen screen"/);
t6("P17665", "the three device preferences CLICK THROUGH the real bar buttons", "A", /if \(el\) el\.click\(\);/);
t6("P17666", "…and Settings re-renders afterwards so the labels cannot go stale", "A", /if \(el\) el\.click\(\);\s*\n?\s*renderKitchenSettings\(\);/);
t6("P17667", "Sign out is a FORM, so a GET can never end somebody's shift", "A", /<form method="post" action="\/api\/panel-logout"/);
t6("P17668", "Sign out targets _top, so it signs the person out and not the iframe", "A", /target="_top"/);
t6("P17669", "Sign out says what it does and what it does not do", "A", /Signing out returns this screen to the login page\. The board keeps running for everyone else\./);
t6("P17670", "the station buttons are GONE, so there is nothing to double-tap", "A", (a) => !/data-kstation/.test(setSec(a)) || "station buttons are back");
t6("P17671", "…and nothing on this sheet can fail a send, because it sends nothing", "A", (a) => !/api\("POST"/.test(setSec(a)) || "the settings sheet writes to the server again");
t6("P17672", "printing is a FACT on this sheet now, not an action", "A", (a) => !/takeStation|releaseStation/.test(setSec(a)) || "the sheet acts on the station again");
t6("P17673", "…and the station it reports comes from the board read it already does", "A", "state.station = data.station || null");
t6("P17674", "Settings offers no profile (R7)", "A", (a) => !/profile/i.test(setSec(a)) || "a profile appeared on the settings sheet");
t6("P17675", "there is exactly one Sign out on this screen", "A", (a) => {
  const n = (a.match(/Sign out<\/button>/g) || []).length;
  return n === 1 || `${n} sign-out buttons`;
});

// ── the 🖨 printer sheet ──
t6("P17676", "the sheet refuses to open twice", "A", /if \(document\.getElementById\("prSheet"\)\) return;/);
t6("P17677", "the sheet offers exactly the four problems the route accepts", "A", (a, S) => {
  const kinds = [...(a.match(/const KINDS = \[([\s\S]*?)\];/) || ["", ""])[1].matchAll(/\["(\w+)",/g)].map((m) => m[1]);
  const allow = ((S.R().match(/const kinds = \[([^\]]+)\]/) || ["", ""])[1]).split(",").map((s) => s.trim().replace(/"/g, ""));
  const bad = kinds.filter((k) => !allow.includes(k));
  return (kinds.length === 4 && bad.length === 0) || `sheet offers ${kinds.join(",")}; route accepts ${allow.join(",")}`;
});
t6("P17678", "a computer that owns the paper is named on this screen", "A", (a) => /const hlp = state\.helper && state\.helper\.owned \? state\.helper : null;/.test(status(a)) || "the helper branch is gone");
t6("P17679", "…with its printer AND the machine it runs on", "A", /esc\(hlp\.printer\) \+ " — from " \+ esc\(hlp\.agent\)/);
t6("P17680", "a helper that has gone quiet says how long, and that tickets are waiting", "A", /It has not been heard from for \$\{hlp\.secondsAgo == null \? "a while" : Math\.round\(hlp\.secondsAgo \/ 60\) \+ " min"\}/);
t6("P17681", "…in minutes a person reads, not raw seconds", "A", /Math\.round\(hlp\.secondsAgo \/ 60\) \+ " min"/);
t6("P17682", "…and it says which printer takes over if there is a backup", "A", /hlp\.backup \? ` If it prints nothing for a minute, \$\{esc\(hlp\.backup\.printer\)\} takes over\.`/);
t6("P17683", "an unknown 'how long ago' says 'a while' rather than NaN", "A", /hlp\.secondsAgo == null \? "a while"/);
t6("P17684", "with nothing printing yet, the sheet says who turns it on", "A", /Nothing prints by itself yet — the manager or your admin turns it on\./);
t6("P17685", "every helper value the sheet prints is escaped", "A", (a) => {
  const s = status(a);
  const holes = [...s.matchAll(/\$\{(hlp\.[\w.]+)\}/g)].map((m) => m[1]);
  return holes.length === 0 || `unescaped helper values: ${holes.join(", ")}`;
});
t6("P17686", "the sheet's problem buttons all disable together while one is sending", "A", /ov\.querySelectorAll\("\[data-prkind\]"\)\.forEach\(\(x\) => \(x\.disabled = true\)\)/);
t6("P17687", "…and all re-enable if the send fails", "A", /ov\.querySelectorAll\("\[data-prkind\]"\)\.forEach\(\(x\) => \(x\.disabled = false\)\)/);
t6("P17688", "a report saved offline says so rather than claiming the manager was told", "A", /r && r\.queued \? "Saved ✓ — the manager is told the moment you're back online\."/);
t6("P17689", "the sheet links to the full setup guide as a LINK, not a button", "A", /<a class="btn prsheet-row prsheet-help" href="\/print-setup\.html#station"/);
t6("P17690", "the sheet can reach Settings without the cook hunting for ☰", "A", /sb2\.onclick = \(\) => \{ close\(\); openKitchenSettings\(\); \}/);

// ── the durable print queue's client end ──
t6("P17691", "a job already in flight is never claimed twice", "A", (a) => /&& !jobsInFlight\.has\(j\.id\)/.test(ppj(a)) || "the in-flight guard is gone");
t6("P17692", "a job with no order on it is skipped rather than printed blank", "A", (a) => /jobs\.filter\(\(j\) => j && j\.order/.test(ppj(a)) || "an orderless job would print");
t6("P17693", "a job another screen won is released from this screen's in-flight set", "A", (a) => /fresh\.filter\(\(j\) => !wonSet\.has\(j\.id\)\)\.forEach\(\(j\) => jobsInFlight\.delete\(j\.id\)\)/.test(ppj(a)) || "lost jobs stay wedged in flight");
t6("P17694", "the queue no longer refuses to print while the window is covered", "A", (a) => !/document\.hidden/.test(ppj(a)) || "processPrintJobs bails while hidden again");
t6("P17695", "jobs print SERIALIZED, so a burst cannot stack dialogs", "A", (a) => /setTimeout\(step, 400\)/.test(ppj(a)) || "the 400ms spacing is gone");
t6("P17696", "a retry is marked on the PAPER, so two sheets are never both 'original'", "A", /reprint: j\.reprint !== false \|\| \(j\.attempts \|\| 0\) > 0/);
t6("P17697", "a queue-printed ticket is remembered as printed, so the net and 🖨 agree", "A", /if \(okPrint && j\.order && j\.order\.id\) \{ printedIds\.add\(j\.order\.id\); savePrintedIds\(\); \}/);
t6("P17698", "a job that did not print tells the cook, through the throttled path", "A", (a) => /if \(!okPrint\) notePrintTrouble\(\);/.test(ppj(a)) || "a failed queue print says nothing");
t6("P17699", "the done report always frees the in-flight slot, success or failure", "A", /\.finally\(\(\) => jobsInFlight\.delete\(j\.id\)\)/);
t6("P17700", "an offline/busy claim releases every id so the next board pass can retry", "A", /\.catch\(\(\) => fresh\.forEach\(\(j\) => jobsInFlight\.delete\(j\.id\)\)\)/);
t6("P17701", "the claim is a plain fetch with same-origin credentials", "A", /credentials: "same-origin"/);
t6("P17702", "a claim that fails throws with its status, rather than pretending it won", "A", /if \(!r\.ok\) throw new Error\("claim HTTP " \+ r\.status\)/);
t6("P17703", "a claim reply with no body is read as 'won nothing', not a crash", "A", /\(await r\.json\(\)\.catch\(\(\) => \(\{\}\)\)\)\.won \|\| \[\]/);

// ── the self-healing net ──
t6("P17704", "the self-healing net never fires when auto-print is off", "A", (a) => /if \(!autoOn\) return;/.test(net(a)) || "the net runs with printing off");
t6("P17705", "the net does nothing when the server did not say what is queued", "A", (a) => /if \(!Array\.isArray\(queuedFor\)\) return;/.test(net(a)) || "the net acts on an unknown queue");
t6("P17706", "the net waits 20 seconds, so it can never race the queue", "A", /const NET_AFTER_MS = 20000;/);
t6("P17707", "the net never retro-prints a ticket with an unreadable timestamp", "A", (a) => /return Number\.isFinite\(t\) && t < cutoff;/.test(net(a)) || "a bad timestamp could be retro-printed");
t6("P17708", "the net skips anything the queue already has in hand, in ANY state", "A", (a) => /queued\.has\(String\(o\.id\)\)/.test(net(a)) || "the net can race the queue");
t6("P17709", "the net only considers an order that is still received or preparing", "A", (a) => /o\.status !== "received" && o\.status !== "preparing"/.test(net(a)) || "the net considers a served order");
t6("P17710", "the targeted slice deliberately passes no queue list to the net", "A", /autoPrintNet\(state\.autoPrintKot, freshOrders, freshItems, state\.restaurant, null\)/);
t6("P17711", "the targeted slice asks for the queue only while this screen is the printer", "A", /const jobsQ = state\.autoPrintKot \? "&jobs=1" : "";/);
t6("P17712", "the whole-board read declares itself a queue-printing panel", "A", /api\("GET", "\/board\?autojobs=1"\)/);
t6("P17713", "a ticket is marked printed only if it ACTUALLY printed", "A", /if \(printKot\(o, \(allItems \|\| \[\]\)\.filter\(\(it\) => it\.order_id === o\.id\), restaurant\)\) \{ printedIds\.add\(o\.id\)/);

// ── printedIds ──
t6("P17714", "printedIds survives a reload, keyed to this device", "A", /const PRINTED_KEY = "kds_printed_ids";/);
t6("P17715", "a corrupt stored value starts empty rather than throwing on boot", "A", /\} catch \{ return \[\]; \}/);
t6("P17716", "…and only strings are accepted back out of it", "A", /raw\.filter\(\(x\) => typeof x === "string"\)/);
t6("P17717", "a device with storage disabled still prints, it just forgets across reloads", "A", /localStorage\.setItem\(PRINTED_KEY, JSON\.stringify\(\[\.\.\.printedIds\]\)\); \} catch \{/);
t6("P17718", "printedIds is pruned so it cannot grow forever", "A", /if \(printedIds\.size > 500\)/);
t6("P17719", "…and pruning only drops ids that have left the board", "A", /for \(const id of printedIds\) if \(!ids\.has\(id\)\) printedIds\.delete\(id\);/);

// ── printer trouble, and printKot ──
t6("P17720", "the printer-trouble toast is throttled to once a minute", "A", /if \(Date\.now\(\) - lastPrintTroubleAt < 60000\) return;/);
t6("P17721", "…and it tells the MANAGER as well as whoever is standing here", "A", /"\/printer-events", \{ kind: "auto_fail"/);
t6("P17722", "the trouble toast says the orders are still on the board", "A", /Orders are still on the board\./);
t6("P17723", "printKot returns false rather than throwing into the board", "A", (a) => /return false;/.test(pk(a)) || "printKot cannot report a failure");
t6("P17724", "a print failure is written to the Everything Log", "A", /LFH_ERRLOG\.report\(msg, "printKot"\)/);
t6("P17725", "…and always leaves a console trace as well", "A", /console\.error\("\[kitchen\]", msg, e\)/);
t6("P17726", "the hidden print frame is removed only when the browser says printing finished", "A", /w\.onafterprint = cleanup;/);
t6("P17727", "…with a long fallback for a preview somebody walks away from", "A", /setTimeout\(cleanup, 60000\);/);
t6("P17728", "cleanup cannot run twice", "A", /const cleanup = \(\) => \{ if \(done\) return; done = true;/);
t6("P17729", "an automatic ticket never steals focus from the person working", "A", (a) => {
  const f = pk(a); const i = f.indexOf("try { w.print(); }");
  return (i > 0 && f.slice(0, i).indexOf("w.focus()") === -1) || "focus() runs before the print again";
});
t6("P17730", "an asynchronous print failure un-records the ticket so the next pass retries", "A", /printedIds\.delete\(order\.id\); savePrintedIds\(\);/);
t6("P17731", "the print frame is off-screen and zero-sized, never a flash of white", "A", /position:fixed;right:0;bottom:0;width:0;height:0;border:0;/);
t6("P17732", "the KOT's restaurant name is the tenant's own, with the wordmark markers stripped", "A", /restDisplayName\(restaurant\)\.replace\(\/\\\*\/g, ""\) \|\| "Kitchen"/);
t6("P17733", "the printed table label is the one the FLOOR uses", "A", /const tlab = \(opts && opts\.tableLabel\) \|\| whereFor\(order, true\);/);
t6("P17734", "a missing KOT number prints an em-dash, never 'undefined'", "A", /const kot = order\.kot_no != null \? order\.kot_no : "—";/);
t6("P17735", "a legacy order falls back to its own items JSON for the paper", "A", /: \(Array\.isArray\(order\.items\) \? order\.items : \[\]\);/);
t6("P17736", "the allergies list reaching paper is always an array", "A", /allergies: Array\.isArray\(order\.allergies\) \? order\.allergies : \[\]/);

// ── index.html ──
t6("P17737", "every script tag is a local path — nothing is fetched from another origin", "H", (h) => {
  const bad = [...h.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).filter((s) => /^https?:|^\/\//.test(s));
  return bad.length === 0 || `off-origin script(s): ${bad.join(", ")}`;
});
t6("P17738", "no inline <script> block smuggles logic past the cache hash", "H", (h) => {
  const inline = [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim().length > 0);
  return inline.length === 0 || `${inline.length} inline script block(s)`;
});
t6("P17739", "there is exactly one stylesheet", "H", (h) => {
  const n = (h.match(/<link rel="stylesheet"/g) || []).length;
  return n === 1 || `${n} stylesheets`;
});
t6("P17740", "the page declares its charset first", "H", (h) => {
  const head = h.slice(0, h.indexOf("</head>"));
  return head.indexOf('<meta charset="utf-8">') < head.indexOf("<title>") || "charset comes after the title";
});
t6("P17741", "the tab title names the screen, not the app", "H", /<title>Kitchen — live orders<\/title>/);
t6("P17742", "swreg.js loads before offline.js, which reads what it installs", "H", (h) => h.indexOf("/panels/swreg.js") < h.indexOf("/panels/offline.js") || "the order is reversed");
t6("P17743", "backstack.js is loaded, since five overlays register with it", "H", "/panels/backstack.js");
t6("P17744", "errlog.js is loaded, so a screen error reaches the Everything Log", "H", "/panels/errlog.js");
t6("P17745", "issue-raise.js is loaded, since 🚩 and the ☰ row both call it", "H", "/panels/issue-raise.js");
t6("P17746", "maint.js loads first of the BODY scripts, so maintenance mode wins", "H", (h) => {
  // theme.js is in <head> deliberately — it sets the skin before paint, which P02514 asserts. The
  // question here is the BODY order, where maint.js must be able to take the screen over first.
  const body = h.slice(h.indexOf("<body>"));
  const shared = [...body.matchAll(/src="\/panels\/([a-z-]+\.js)/g)].map((m) => m[1]);
  return shared[0] === "maint.js" || `the first body script is ${shared[0]}`;
});
t6("P17747", "the three lanes are authored in the order a kitchen thinks in", "H", (h) => {
  const order = [...h.matchAll(/id="col-(\w+)"/g)].map((m) => m[1]);
  return order.join(",") === "new,cooking,ready" || `lanes are ${order.join(",")}`;
});
t6("P17748", "each lane heading carries its own count span", "H", (h) => {
  for (const k of ["new", "cooking", "ready"]) if (!h.includes(`class="count" id="count-${k}"`)) return `#count-${k} is not in its heading`;
  return true;
});
t6("P17749", "the skeleton lives INSIDE the lists the reconciler owns", "H", (h) => {
  const bad = [...h.matchAll(/<div class="skel-ticket">/g)].length > 0 && !/id="list-new"><div class="skel-ticket"/.test(h);
  return !bad || "a skeleton sits outside the list";
});
t6("P17750", "the 86 drawer's search input is type=search, so a phone offers a clear button", "H", /<input type="search" id="dishSearch"/);
t6("P17751", "…and it has a placeholder that says what to type", "H", /placeholder="Find a dish…"/);
t6("P17752", "the drawer heading explains what '86' means in plain words", "H", /mark dishes unavailable \(the “86 board”\)/);
t6("P17753", "the sold-out button's title spells out the jargon too", "H", /title="Sold out list \(the &quot;86 board&quot;\) — mark dishes unavailable"/);
t6("P17754", "no element in the markup carries an inline onclick", "H", (h) => !/\son\w+=/.test(h) || "an inline event handler is in the markup");
t6("P17755", "every button in the markup declares a type or is inside no form", "H", (h) => {
  const forms = (h.match(/<form/g) || []).length;
  return forms === 0 || "a form appeared in the markup — its buttons now need an explicit type";
});
t6("P17756", "the wall main is a sibling of the columns main, not nested inside it", "H", (h) => {
  const cols = h.indexOf('<main class="cols" id="cols">'), close = h.indexOf("</main>", cols), wall = h.indexOf('<main class="wall" id="wall"');
  return (cols >= 0 && wall > close) || "the wall is nested inside the columns";
});

// ── style.css invariants ──
t6("P17757", "the stylesheet declares a light-skin block", "C", /html\[data-theme="light"\]/);
t6("P17758", "every var() used without a fallback is declared in this file", "C", (c) => {
  const declared = new Set([...c.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  const naked = new Set([...c.matchAll(/var\(--([\w-]+)\s*\)/g)].map((m) => m[1]));
  const undef = [...naked].filter((u) => !declared.has(u));
  return undef.length === 0 || `read with no fallback, never declared: ${undef.join(", ")}`;
});
t6("P17759", "no half-open comment can eat the rule that follows it", "Craw", (c) => {
  const opens = (c.match(/\/\*/g) || []).length, closes = (c.match(/\*\//g) || []).length;
  return opens === closes || `${opens} comment openers vs ${closes} closers`;
});
t6("P17760", "there is no hand-added -webkit-backdrop-filter, which makes the build DROP the line", "C", (c) =>
  !/-webkit-backdrop-filter/.test(c) || "a -webkit- prefix is back and the build will drop the unprefixed line");
t6("P17761", "[hidden] is forced, so the wall/columns toggle cannot lose to an author display", "C", /\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/);
t6("P17762", "the phone-only ⋯ is hidden by default and shown only in the phone block", "C", (c) => {
  const base = c.slice(0, c.indexOf("@media (max-width: 760px)"));
  return /\.kds-more-btn \{[^}]*display:\s*none/.test(base) || "⋯ is visible outside the phone block";
});
t6("P17763", "the lane layout starts at 768px and nothing overrides it later", "C", (c) => {
  const n = (c.match(/@media \(min-width: (?:768|820)px\) \{/g) || []).length;
  // EXPECTATION CHANGED 2026-09-03 (item 7): the gate moved 820px → 768px so an iPad in portrait
  // gets three lanes. Ready's top edge had measured y=1725 on a 1024px screen.
  return (n === 1 && /@media \(min-width: 768px\) \{/.test(c)) || `${n} lane blocks; 768px present: ${/768px/.test(c)}`;
});
t6("P17764", "prefers-reduced-motion switches the shimmer and the nudge pulse off", "C", /@media \(prefers-reduced-motion/);
t6("P17765", "no rule sets a fixed pixel height on a ticket, so a long order cannot be clipped", "C", (c) =>
  !/\.ticket\s*\{[^}]*[^-]height:\s*\d+px/.test(c) || "a ticket has a fixed height");
t6("P17766", "the ✓ is a 44px target in the base rule, not only on a phone", "C", (c) => {
  // It sets plain width/height, not min-*; measured on the running board at 1280/768/360 as 44x44.
  const base = c.slice(0, c.indexOf("@media (max-width: 760px)"));
  const m = base.match(/\.tick \{([^}]*)\}/);
  if (!m) return "the .tick rule is gone";
  const w = (m[1].match(/(?:min-)?width:\s*(\d+)px/) || [])[1];
  const hh = (m[1].match(/(?:min-)?height:\s*(\d+)px/) || [])[1];
  return (Number(w) >= 44 && Number(hh) >= 44) || `the ✓ is ${w}x${hh} in the base rule`;
});
t6("P17767", "the ALL READY button is at least 44px tall", "C", (c) => {
  // It reaches the target through PADDING, not min-height — measured 48px tall at 1280, 768 and
  // 360px. So the check is the padding that produces it, not a property it never had.
  const m = c.match(/\.big \{([^}]*)\}/);
  if (!m) return "the .big rule is gone";
  const pad = Number((m[1].match(/padding:\s*(\d+)px/) || [])[1] || 0);
  return pad >= 12 || `.big pads ${pad}px, which cannot reach a 44px target`;
});
t6("P17768", "the reprint button is a 44px square", "C", /\.reprint \{[^}]*min-height: 44px; min-width: 44px/);
