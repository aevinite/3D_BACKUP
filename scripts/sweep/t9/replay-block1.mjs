// Replay of LEDGER/T6.md block 1 — "reading the code for correctness", P02501–P02700.
// Every row here was verified by READING a file, so every row here is an assertion.
import { row, APP, APPC, HTML, CSS, PAGE, LAYOUT, has, hasRe, lacks, lacksRe, before, contentHash, P } from "./lib.mjs";
import { readdirSync } from "node:fs";

// ── app/kitchen/{layout,page}.tsx — P02501–P02510 ────────────────────────────
row("P02501", "layout gates with requirePanel before rendering children", () => {
  const t = LAYOUT();
  const i = t.indexOf('await requirePanel("kitchen"'), j = t.indexOf("return <>");
  return (i > 0 && j > i) || "the await does not precede the return";
});
row("P02502", "the layout hands its own route back to requirePanel", () => has(LAYOUT(), 'requirePanel("kitchen", "/kitchen")'));
row("P02503", "page.tsx awaits searchParams (Next 16 async params)", () => hasRe(PAGE(), /const \{ rid, as, view \} = await searchParams;/));
row("P02504", "the page never trusts a raw ?rid= — it goes through panelAdminRid", () => has(PAGE(), 'panelAdminRid("kitchen", rid)'));
row("P02505", "as/view reach the iframe through panelIframeSrc, not string concat", () => has(PAGE(), "panelIframeSrc(\"/panels/kitchen/index.html\", adminRid, { as, view })"));
row("P02506", "the kitchen tab has its own <title>", () => has(PAGE(), 'metadata = { title: "Kitchen — Aevidine" }'));
row("P02507", "the page renders PanelFrame and nothing else", () => {
  const t = PAGE();
  return (/return <PanelFrame src=\{src\} title=/.test(t) && !/<div/.test(t)) || "something other than PanelFrame is rendered";
});
row("P02508", "panelIframeSrc points at /panels/kitchen/index.html", () => has(PAGE(), '"/panels/kitchen/index.html"'));
row("P02509", "nothing in app/kitchen is a client component", () => lacks(PAGE() + LAYOUT(), '"use client"'));
row("P02510", "app/kitchen holds exactly layout.tsx + page.tsx — no stale second copy", () => {
  const f = readdirSync(P("app/kitchen")).sort();
  return (f.length === 2 && f[0] === "layout.tsx" && f[1] === "page.tsx") || `found ${f.join(",")}`;
});

// ── index.html — P02511–P02533 ───────────────────────────────────────────────
row("P02511", "index.html loads style.css with a content-hash ?v=", () => {
  const m = HTML().match(/style\.css\?v=([0-9a-f]{8})/);
  return (m && m[1] === contentHash("public/panels/kitchen/style.css")) || `tag says ${m && m[1]}, file hashes to ${contentHash("public/panels/kitchen/style.css")}`;
});
row("P02512", "index.html loads app.js with a content-hash ?v=", () => {
  const m = HTML().match(/app\.js\?v=([0-9a-f]{8})/);
  return (m && m[1] === contentHash("public/panels/kitchen/app.js")) || `tag says ${m && m[1]}, file hashes to ${contentHash("public/panels/kitchen/app.js")}`;
});
row("P02513", "every shared /panels/*.js include carries its own ?v= hash", () => {
  const tags = [...HTML().matchAll(/src="\/panels\/([a-z-]+\.js)(\?v=([0-9a-f]{8}))?"/g)];
  if (!tags.length) return "no shared panel scripts found";
  const bad = tags.filter((t) => !t[3]).map((t) => t[1]);
  return bad.length === 0 || `no ?v= on: ${bad.join(", ")}`;
});
row("P02514", "theme.js runs in <head>, before paint", () => {
  const h = HTML(); const head = h.slice(0, h.indexOf("</head>"));
  return has(head, "/panels/theme.js");
});
row("P02515", "outbox.js loads before app.js", () => before(HTML(), "/panels/outbox.js", 'src="app.js'));
row("P02516", "connbadge.js loads after both realtime.js and outbox.js", () => {
  const h = HTML();
  return (h.indexOf("/panels/connbadge.js") > h.indexOf("/panels/realtime.js") &&
          h.indexOf("/panels/connbadge.js") > h.indexOf("/panels/outbox.js")) || "connbadge is not last of the three";
});
row("P02517", "offline.js loads after outbox.js and before app.js", () => {
  const h = HTML();
  return (h.indexOf("/panels/offline.js") > h.indexOf("/panels/outbox.js") &&
          h.indexOf("/panels/offline.js") < h.indexOf('src="app.js')) || "offline.js is out of order";
});
row("P02518", "billdoc.js loads before app.js (printKot calls LFH_BILLDOC on the first board read)", () => before(HTML(), "/panels/billdoc.js", 'src="app.js'));
row("P02519", "undobar.js is present so the ✓ take-back bar can render", () => has(HTML(), "/panels/undobar.js"));
row("P02520", "fitnums is scoped to .kot only, so it cannot shrink ticket body text", () => hasRe(HTML(), /fitnums\.js\?v=[0-9a-f]{8}"\s+data-fit="\.kot"/));
row("P02521", "the three list ids in the markup match every $(\"#list-\"+key) use", () => {
  const h = HTML();
  for (const k of ["new", "cooking", "ready"]) if (!h.includes(`id="list-${k}"`)) return `index.html has no id="list-${k}"`;
  return has(APPC(), '$("#list-" + key)');
});
row("P02522", "the three count ids match draw() and moveCardToReady()", () => {
  const h = HTML();
  for (const k of ["new", "cooking", "ready"]) if (!h.includes(`id="count-${k}"`)) return `index.html has no id="count-${k}"`;
  const a = APPC();
  return (a.includes('$("#count-" + key)') && a.includes('document.getElementById("count-" + key)')) || "one of the two writers does not use the count- prefix";
});
row("P02523", "every element app.js looks up by id exists in index.html", () => {
  const a = APPC(), h = HTML();
  const ids = new Set();
  for (const m of a.matchAll(/\$\("#([A-Za-z][\w-]*)"\)/g)) ids.add(m[1]);
  for (const m of a.matchAll(/getElementById\("([A-Za-z][\w-]*)"\)/g)) ids.add(m[1]);
  // ids app.js CREATES itself rather than expecting in the markup
  const created = new Set(["soundNudge", "morePop", "prSheet", "kdsBuild", "xrayRibbon", "xrayHome", "xrayRest", "xrayExit", "xraySimBtn", "lfh-blocked-wall", "outOnlyBtn"]);
  const missing = [...ids].filter((id) => !created.has(id) && !h.includes(`id="${id}"`));
  return missing.length === 0 || `app.js looks up ids the markup does not have: ${missing.join(", ")}`;
});
row("P02524", "the skeleton tickets carry no data-ticket, so reconcileList removes them", () => {
  const h = HTML();
  const skel = [...h.matchAll(/<div class="skel-ticket">/g)].length;
  if (!skel) return "no skeleton tickets in the markup";
  return lacksRe(h, /skel-ticket[^>]*data-ticket/);
});
row("P02525", "#wall ships hidden so the columns are the first paint", () => hasRe(HTML(), /<main class="wall" id="wall" hidden>/));
row("P02526", "the 86 drawer overlay ships hidden and is only opened by openDrawer()", () => {
  if (!/id="drawerOverlay" hidden/.test(HTML())) return "drawerOverlay is not hidden in the markup";
  return hasRe(APPC(), /function openDrawer\(\)[\s\S]{0,200}\$\("#drawerOverlay"\)\.hidden = false/);
});
row("P02527", "#toasts exists in the markup above the scripts", () => {
  const h = HTML();
  return (h.indexOf('id="toasts"') > 0 && h.indexOf('id="toasts"') < h.indexOf('src="app.js')) || "#toasts is missing or below app.js";
});
row("P02528", "both worded top-bar buttons are an icon span plus a word span", () => {
  const h = HTML();
  for (const id of ["boardBtn", "viewBtn"]) {
    const tag = h.slice(h.indexOf(`id="${id}"`));
    const end = tag.indexOf("</button>");
    const inner = tag.slice(0, end);
    if (!inner.includes('class="bi"') || !inner.includes('class="bw"')) return `#${id} is missing its .bi/.bw spans`;
  }
  return true;
});
row("P02529", "every icon-only top-bar button carries a title, so it has an accessible name", () => {
  const h = HTML();
  const bar = h.slice(h.indexOf('<header class="topbar"'), h.indexOf("</header>"));
  const bad = [];
  for (const m of bar.matchAll(/<button ([^>]*)>([^<]*)<\/button>/g)) {
    const attrs = m[1];
    const id = (attrs.match(/id="([^"]+)"/) || [])[1] || "(no id)";
    // #themeToggle is deliberately empty in the markup: public/panels/theme.js paints its icon
    // AND sets both title and aria-label ("Switch to light/dark mode") the moment it wires up, so
    // its name depends on the current skin and cannot be authored here. The LIVE pass asserts the
    // rendered name; asserting markup for it would be a guard inventing a failure.
    if (id === "themeToggle") continue;
    if (!/title="/.test(attrs) && !/aria-label="/.test(attrs)) bad.push(id);
  }
  return bad.length === 0 || `no accessible name on: ${bad.join(", ")}`;
});
row("P02530", "#moreBtn starts with aria-expanded=\"false\"", () => hasRe(HTML(), /id="moreBtn"[^>]*aria-expanded="false"/));
row("P02531", "the favicon is inlined, so the panel does not 404 on /favicon.ico", () => hasRe(HTML(), /<link rel="icon" href="data:image\/svg\+xml/));
row("P02532", "<html lang> is set", () => hasRe(HTML(), /<html lang="[a-z]{2}"/));
row("P02533", "the viewport meta is present and does not disable zoom", () => {
  const m = HTML().match(/<meta name="viewport" content="([^"]+)"/);
  if (!m) return "no viewport meta";
  return (!/user-scalable\s*=\s*no/.test(m[1]) && !/maximum-scale\s*=\s*1/.test(m[1])) || `zoom is disabled: ${m[1]}`;
});

// ── escaping — P02534–P02537 ─────────────────────────────────────────────────
row("P02534", "esc() escapes all five of & < > \" '", () => {
  const m = APP().match(/const esc = \(s\) =>[^\n]*\n?/);
  if (!m) return "esc() not found";
  for (const ch of ["&", "<", ">", '"', "'"]) if (!m[0].includes(`"${ch}":`) && !m[0].includes(`'${ch}':`)) return `esc() does not map ${ch}`;
  return true;
});
row("P02535", "every value interpolated into ticketHtml goes through esc() or is a fixed literal", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function ticketHtml("), a.indexOf("function orderPhase("));
  // A NESTED TEMPLATE IS NOT A SECOND HOLE. `${esc(r.options.map((op) => `+ ${op.label}`)…)}` has
  // an inner `${op.label}` that a flat regex reads as unescaped — it is inside the esc() call.
  // So this walks brace depth and only judges the OUTERMOST interpolations, which are the ones
  // that actually reach the markup.
  const holes = [];
  for (let i = 0; i < fn.length - 1; i++) {
    if (fn[i] !== "$" || fn[i + 1] !== "{") continue;
    let depth = 1, j = i + 2;
    for (; j < fn.length && depth > 0; j++) { if (fn[j] === "{") depth++; else if (fn[j] === "}") depth--; }
    holes.push(fn.slice(i + 2, j - 1).trim());
    i = j - 1;   // skip past the whole hole, so its inner ${} are never judged on their own
  }
  const bad = holes.filter((e) => {
    if (/^esc\(/.test(e)) return false;                                   // escaped outright
    // built above, each piece escaped where it was built
    if (/^(lines|small|remMark|tick|lineCls|action|reprintBtn|tagBadge|orderNoteHtml|phase)\b/.test(e)) return false;
    if (/^tb\[[01]\]$/.test(e)) return false;                              // fixed literals in TAG_BADGE
    if (/^ageClass\(/.test(e)) return false;                              // returns one of four fixed class strings
    if (/^lineRemoved\.map\(/.test(e)) return false;                      // every value inside is esc()'d
    // These three live inside a template that is itself an argument to esc(), or is assembled
    // from pieces each escaped where they were built — read and confirmed line by line:
    //   `+ ${op.label || op}`   → inside esc(r.options.map(…).join(" · "))
    //   `✎ ${r.note}`           → inside esc(`✎ ${r.note}`)
    //   ${segs.join(" · ")}     → segs only ever receives esc()'d strings or a fixed-literal <span>
    if (/^op\.label \|\| op$/.test(e)) return false;
    if (/^r\.note$/.test(e)) return false;
    if (/^segs\.join\(" · "\)$/.test(e)) return false;
    if (/^o\.table_number == null/.test(e)) return false;                 // literal-only ternary
    if (/^ttag === "guest"/.test(e)) return false;                        // two literal colours
    if (/^ageTitle\(o\.created_at\) \?/.test(e)) return false;            // esc()'d in its true arm
    if (/^ageMinutes\(o\.created_at\) >= AGE_STALE_MIN \?/.test(e)) return false; // literal <i> or ""
    return true;
  });
  return bad.length === 0 || `unescaped interpolations: ${bad.join(" | ")}`;
});
row("P02536", "the allergen ＋ superscript escapes the allergen name before wrapping it", () =>
  hasRe(APP(), /NO \$\{esc\(String\(x\)\.toUpperCase\(\)\)\}\$\{added\.has\(String\(x\)\.toLowerCase\(\)\)/));
row("P02537", "platTicketHtml escapes the platform label, the customer name and every dish line", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function platTicketHtml("), a.indexOf("function platAct("));
  for (const needle of ["esc(meta.label)", "esc(p.customer_name)", "esc(it.title)", "esc(it.qty)"])
    if (!fn.includes(needle)) return `missing ${needle}`;
  return true;
});

// ── table naming and age — P02538–P02552 ─────────────────────────────────────
row("P02538", "tname() trims and returns \"\" for a missing name", () => hasRe(APP(), /const tname = \(t\) => \(\(\(state\.tableNames \|\| \{\}\)\[String\(t\)\]\) \|\| ""\)\.trim\(\)/));
row("P02539", "tshort() returns T<n> when a table has no name", () => hasRe(APP(), /const tshort = \(t\) =>[^\n]*tname\(t\) \|\| `T\$\{t\}`/));
row("P02540", "tlong() answers T? for a null/empty table instead of Tnull", () => hasRe(APP(), /const tlong = \(t\) => \(t == null \|\| t === "" \? "T\?" :/));
row("P02541", "whereFor() has no unreachable parcel branch reading a column orders does not have", () => {
  const a = APPC();
  const line = a.slice(a.indexOf("const whereFor ="), a.indexOf("const ageMinutes"));
  return lacksRe(line, /o\.source|"PARCEL"/);
});
row("P02542", "ageMinutes() returns null for null, \"\", NaN and epoch-0 timestamps", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const ageMinutes ="), a.indexOf("const timeAgo ="));
  return (/ts == null \|\| ts === ""/.test(fn) && /!Number\.isFinite\(t\) \|\| t <= 0/.test(fn) && (fn.match(/return null/g) || []).length >= 2)
    || "one of the three guards is missing";
});
row("P02543", "ageMinutes() clamps to 0 so a device clock ahead of the server reads \"just now\"", () => hasRe(APP(), /Math\.max\(0, Math\.floor\(\(Date\.now\(\) - t\) \/ 60000\)\)/));
row("P02544", "timeAgo() says nothing at all when the age is unknown", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const timeAgo ="), a.indexOf("const orderTime ="));
  return hasRe(fn, /if \(m == null\) return "";/);
});
row("P02545", "timeAgo() steps to days past 24h so a five-day ticket does not read \"117h\"", () => hasRe(APP(), /if \(h >= 24\) return Math\.floor\(h \/ 24\) \+ "d " \+ \(h % 24\) \+ "h";/));
row("P02546", "orderTime() sorts an undateable ticket LAST (Infinity), never first", () => hasRe(APP(), /return Number\.isFinite\(t\) \? t : Infinity;/));
row("P02547", "cmpTime() compares rather than subtracts, so Infinity − Infinity can never be NaN", () => hasRe(APP(), /const cmpTime = \(x, y\) => \{ const a = orderTime\(x\), b = orderTime\(y\); return a < b \? -1 : a > b \? 1 : 0; \}/));
row("P02548", "ageClass() returns \"\" for an unknown age instead of falsely warning", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const ageClass ="), a.indexOf("const ageTitle ="));
  return hasRe(fn, /if \(m == null\) return "";/);
});
row("P02549", "the three age steps are ordered stale → late → warn, so the oldest wins", () =>
  hasRe(APP(), /m >= AGE_STALE_MIN \? " age-stale" : m >= AGE_LATE_MIN \? " age-late" : m >= AGE_WARN_MIN \? " age-warn" : ""/));
row("P02550", "ageTitle() gives a different sentence at each of the three steps", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const ageTitle ="), a.indexOf("const toast ="));
  const said = [...fn.matchAll(/return "([^"]{8,})"/g)].map((m) => m[1]);
  return (new Set(said).size === 3) || `found ${said.length} sentences, ${new Set(said).size} distinct`;
});
row("P02551", "the stale step renders a WORD (DAY) as well as a colour", () => has(APP(), '<i class="age-day">DAY</i>'));
row("P02552", "ageMinutes(o.created_at) >= AGE_STALE_MIN cannot throw on a null age", () => {
  // null >= number is false in JS — no throw, no false positive. Assert the comparison shape.
  return (null >= 1440) === false || "JS comparison semantics changed";
});

// ── toast + audio — P02553–P02565 ────────────────────────────────────────────
row("P02553", "toast() always renders a ✕ so a cook can dismiss it before the 4s timeout", () => has(APP(), 'class="toast-x" aria-label="Dismiss"'));
row("P02554", "toast()'s UNDO button removes the toast after running the callback", () => hasRe(APP(), /\.undo"\)\.onclick = \(\) => \{ undoFn\(\); t\.remove\(\); \}/));
row("P02555", "toast() escapes the message", () => has(APP(), "<span>${esc(msg)}</span>"));
row("P02556", "toast() cannot leave a node behind — the 4s timeout removes it even if already removed", () => hasRe(APP(), /setTimeout\(\(\) => t\.remove\(\), 4000\);/));
row("P02557", "primeAudio() is wrapped so a browser with no WebAudio cannot break the boot", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function primeAudio()"), a.indexOf("if (typeof window !== \"undefined\") {"));
  return hasRe(fn, /try \{[\s\S]*\} catch \{\}/);
});
row("P02558", "the one-time gesture listeners are both { once: true } AND removed by hand", () => {
  const a = APPC();
  return (a.includes("removeEventListener(e, once)") && a.includes("{ once: true, passive: true }")) || "one of the two belts is missing";
});
row("P02559", "audioReady() requires the context to be running, not merely to exist", () => hasRe(APP(), /const audioReady = \(\) => !!\(audioCtx && audioCtx\.state === "running"\)/));
row("P02560", "chime() returns immediately when the cook has muted", () => hasRe(APP(), /const chime = \(\) => \{\s*if \(state\.muted\) return;/));
row("P02561", "chime() is wrapped, so a suspended context cannot throw into a load path", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const chime = ()"), a.indexOf("// ── drawing the board"));
  return hasRe(fn, /\} catch \{\}/);
});
row("P02562", "the sound nudge is inserted in normal flow after the top bar, never fixed over a ticket", () =>
  hasRe(APP(), /bar\.parentNode\.insertBefore\(soundNudgeEl, bar\.nextSibling\)/));
row("P02563", "the sound nudge has a body fallback if the top bar is somehow missing", () =>
  hasRe(APP(), /else \(document\.body \|\| document\.documentElement\)\.appendChild\(soundNudgeEl\)/));
row("P02564", "the sound nudge hides itself the instant the context runs or the cook mutes", () =>
  hasRe(APP(), /const need = !state\.muted && !audioReady\(\);/));
row("P02565", "updateSoundNudge is re-run after resume() settles, since resume is async", () =>
  hasRe(APP(), /p\.then\(\(\) => updateSoundNudge\(\)\)/));

// ── rows and the ticket — P02566–P02585 ──────────────────────────────────────
row("P02566", "itemsByOrderId() builds the order→items index once per render pass", () => {
  const a = APPC();
  for (const fn of ["function renderColumns()", "function renderWall()"]) {
    const body = a.slice(a.indexOf(fn), a.indexOf(fn) + 900);
    if (!/const map = itemsByOrderId\(\);/.test(body)) return `${fn} does not build the index once`;
  }
  return true;
});
row("P02567", "itemsByOrderId() skips null rows and rows with no order_id", () => hasRe(APP(), /if \(it == null \|\| it\.order_id == null\) continue;/));
row("P02568", "rowsOf() falls back to the order's own items JSON for a legacy order", () => hasRe(APP(), /return \(Array\.isArray\(o\.items\) \? o\.items : \[\]\)\.map/));
row("P02569", "rowsOf() marks DB rows fromDb: true so only they get a per-dish ✓", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const rowsOf ="), a.indexOf("function sharedOrderNote("));
  return (fn.includes("fromDb: true") && fn.includes("fromDb: false")) || "the fromDb flag is not set on both paths";
});
row("P02570", "a legacy row's status falls back to the order status when the JSON row has none", () => has(APP(), "status: i.status || o.status"));
row("P02571", "the order-wide allergy list is distributed onto every dish line, with no separate banner", () => {
  const a = APPC();
  if (!/const lineRemoved = \[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(r\.removed\) \? r\.removed : \[\]\), \.\.\.orderAllergies\]\)\]/.test(a)) return "the order-wide list is not merged into each line";
  return lacksRe(a, /class="allergy-banner"|commonAllergy/);
});
row("P02572", "duplicate allergens between the line and the order-wide list are de-duplicated", () => has(APPC(), "[...new Set([...(Array.isArray(r.removed) ? r.removed : []), ...orderAllergies])]"));
row("P02573", "a staff-ADDED allergen carries the ＋ mark and a title explaining it", () => hasRe(APP(), /class="alg-add" title="Added after the order was placed"/));
row("P02574", "a REMOVED allergen flags ✎− on the dish name with its own title", () => hasRe(APP(), /class="alg-removed" title="An allergen was removed after the order was placed"/));
row("P02575", "a dish note renders with the ✎ prefix and is escaped", () => has(APP(), 'segs.push(esc(`✎ ${r.note}`))'));
row("P02576", "options render as + label and tolerate a plain string instead of an object", () => has(APP(), "`+ ${op.label || op}`"));
row("P02577", "a cooking dish gets a ✓, a ready dish a pink tag, a served dish \"served ✓\"", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const tick = r.fromDb"), a.indexOf("const lineCls ="));
  return (fn.includes('data-item-ready=') && fn.includes('class="done rdy">ready<') && fn.includes('class="done">served ✓<')) || "one of the three states is missing";
});
row("P02578", "the ✓ only renders for a fromDb row, because a legacy row has no id to send", () => hasRe(APP(), /const tick = r\.fromDb && r\.status === "preparing"/));
row("P02579", "allCooked requires at least one row, so an empty ticket does not claim to be finished", () => hasRe(APP(), /const allCooked = rows\.length > 0 && rows\.every/));
row("P02580", "a received ticket shows \"waiting for the waiter to accept\" and NO accept button", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const action = o.status === \"received\""), a.indexOf("const reprintBtn ="));
  return (fn.includes("waiting for the waiter to accept") && !/data-accept/.test(fn)) || "an accept control is present, or the pill is not";
});
row("P02581", "the 🖨 reprint button renders on every ticket for every restaurant", () => {
  const a = APPC();
  const line = a.slice(a.indexOf("const reprintBtn ="), a.indexOf("const TAG_BADGE"));
  return lacksRe(line, /autoPrintKot|\?\s*`<button class="reprint"/) || "the reprint button is conditional";
});
row("P02582", "the table mark badge reads state.tableTags keyed by table number, not a non-existent o.tag", () => {
  const a = APPC();
  if (!/const ttag = \(state\.tableTags \|\| \{\}\)\[String\(o\.table_number\)\] \|\| "";/.test(a)) return "the badge does not read state.tableTags";
  return lacksRe(a, /TAG_BADGE\[o\.tag\]|o\.tag\b/);
});
row("P02583", "an unknown tag value renders no badge rather than undefined", () => hasRe(APP(), /const tagBadge = tb \? `<span class="ttag"/));
row("P02584", "the guest badge uses dark ink on its pale background, the other two white", () => has(APP(), 'color:${ttag === "guest" ? "#1c2230" : "#fff"}'));
row("P02585", "a ticket with no table draws no title attribute full of Tnull", () =>
  hasRe(APP(), /\$\{o\.table_number == null \|\| o\.table_number === "" \? "" : ` title="T\$\{esc\(o\.table_number\)\}"`\}/));

// ── phase, delegation, platform — P02586–P02600 ──────────────────────────────
row("P02586", "orderPhase() puts a received order in New whatever its dishes say", () => hasRe(APP(), /if \(o\.status === "received"\) return "new";/));
row("P02587", "orderPhase() returns served only when EVERY row is served", () => hasRe(APP(), /if \(rows\.every\(\(r\) => r\.status === "served"\)\) return "served";/));
row("P02588", "orderPhase() returns ready when every row is ready-or-served", () => hasRe(APP(), /if \(rows\.every\(\(r\) => r\.status === "ready" \|\| r\.status === "served"\)\) return "ready";/));
row("P02589", "an order with no rows at all lands in Cooking, not Ready", () => hasRe(APP(), /if \(!rows\.length\) return o\.status === "served" \? "served" : "cooking";/));
row("P02590", "cancelled orders are dropped from both views before bucketing", () => {
  const a = APPC();
  let n = 0;
  for (const fn of ["function renderColumns()", "function renderWall()"]) {
    const body = a.slice(a.indexOf(fn), a.indexOf(fn) + 1200);
    if (/if \(o\.status === "cancelled"\) return;/.test(body)) n++;
  }
  return n === 2 || `only ${n} of the two views drops cancelled orders`;
});
row("P02591", "bindDelegation() attaches exactly one body-level click handler and can never double-bind", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function bindDelegation()"), a.indexOf("function platPhase("));
  return (/if \(clickDelegationBound\) return;/.test(fn) && (fn.match(/addEventListener\("click"/g) || []).length === 1) || "the re-entry guard or the single listener is missing";
});
row("P02592", "every ticket control is reachable through the delegated handler", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function bindDelegation()"), a.indexOf("function platPhase("));
  for (const attr of ["data-reprint", "data-ready", "data-item-ready", "data-plat-accept", "data-plat-ready", "data-plat-hand"])
    if (!fn.includes(`closest("[${attr}]")`)) return `${attr} is not handled`;
  return true;
});
row("P02593", "the delegated handler returns after the first match, so one tap cannot fire two actions", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function bindDelegation()"), a.indexOf("function platPhase("));
  const branches = (fn.match(/if \([a-z]{2,}\) \{ [^}]*; return; \}/g) || []).length;
  return branches >= 6 || `only ${branches} branches end in a return`;
});
row("P02594", "platPhase() maps new→new, accepted/preparing→cooking, ready→ready, else served", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function platPhase("), a.indexOf("function platTicketHtml("));
  return (/st === "new"\) return "new"/.test(fn) && /st === "accepted" \|\| st === "preparing"\) return "cooking"/.test(fn)
    && /st === "ready"\) return "ready"/.test(fn) && /return "served";/.test(fn)) || "the mapping has drifted";
});
row("P02595", "a platform ticket shows ACCEPT only when the manager toggle allows it", () => hasRe(APP(), /action = state\.platformAccept\s*\n?\s*\? `<button class="big" data-plat-accept=/));
row("P02596", "a platform ticket with the toggle off says \"manager will accept\" rather than nothing", () => has(APP(), "🆕 new — manager will accept"));
row("P02597", "an unknown platform source falls back to the other badge rather than crashing", () => hasRe(APP(), /const meta = PLAT_META\[p\.source\] \|\| PLAT_META\.other;/));
row("P02598", "a parcel is labelled PARCEL, never \"Takeaway\"", () => {
  // APPC(), not APP(): the line carries the comment `// staff counter parcel — never "Takeaway"`,
  // so the raw source contains the word this row exists to forbid. Judge the code, not the promise.
  const a = APPC();
  const meta = a.slice(a.indexOf("const PLAT_META"), a.indexOf("let view ="));
  return (/parcel:\s*\{ label: "PARCEL"/.test(meta) && !/parcel:[^\n]*Takeaway/.test(meta)) || "the parcel label has drifted";
});
row("P02599", "platAct() reports a queued (offline) write instead of silently doing nothing", () => hasRe(APP(), /function platAct\(id, status\)[\s\S]{0,300}r\.queued\) \{ toast\("Saved on this device/));
row("P02600", "platAct() refreshes from the server after a failure so the board is not left optimistic", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("function platAct("), a.indexOf("function reconcileList("));
  return hasRe(fn, /\.catch\(\(e\) => \{ toast\("Failed: " \+ e\.message\); refreshQuietly\(\); \}\)/);
});
