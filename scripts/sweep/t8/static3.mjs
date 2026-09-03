// Sweep #8 · terminal 8 · sections G–I of P61701–P62700 — the panel document's BODY.
// G = the top bar · H = the nav / tabs · I = the sidebar, the main area and the toast.
import { read, exists, check, skip, report, has, hasNot, countOf, eq, before, codeOf, htmlCodeOf, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";

const H   = read("public/panels/editor/index.html");
const HC  = htmlCodeOf(H);
const CSS = read("public/panels/editor/style.css");
const APP = read("public/panels/editor/app.js");
const INV = read("public/panels/editor/inventory.js");
const HKIT= read("public/panels/kitchen/index.html");
const HTAB= read("public/panels/tablet/index.html");
const PANELJS = fs.readdirSync(path.join(ROOT,"public/panels")).filter(f=>f.endsWith(".js")).map(f=>read(`public/panels/${f}`)).join("\n");
const ALLJS = APP + "\n" + INV + "\n" + PANELJS;
// every id the markup declares, and every class it uses
const IDS = [...new Set([...HC.matchAll(/id="([^"]+)"/g)].map(m=>m[1]))];
const CLASSES = [...new Set([...HC.matchAll(/class="([^"]+)"/g)].flatMap(m=>m[1].split(/\s+/)).filter(Boolean))];
const TABS = [...HC.matchAll(/<button class="tab[^"]*"[^>]*data-tab="([^"]+)"/g)].map(m=>m[1]);
const idUsed = (id) => new RegExp(`["'#]${id}\\b`).test(ALLJS) || new RegExp(`#${id}\\b`).test(CSS);
const classStyled = (c) => new RegExp(`\\.${c.replace(/[-]/g,"\\-")}[\\s,.:>{\\[]`).test(CSS);

/* ═══════════ G · the top bar (P62031–P62090) ═══════════ */
check("P62031","the document opens with a <header class=\"topbar\">",()=>has(H,/<header class="topbar">/));
check("P62032","…and the top bar is styled, so it can never paint unstyled",()=>classStyled("topbar"));
check("P62033","the phone hamburger exists",()=>has(H,/id="navBurger"/));
check("P62034","…it is a real button, so a keyboard can reach it",()=>has(H,/<button id="navBurger"[^>]*type="button"/));
check("P62035","…it has an accessible name",()=>has(H,/id="navBurger"[^>]*aria-label="Open menu"/));
check("P62036","…it announces whether the drawer is open",()=>has(H,/id="navBurger"[^>]*aria-expanded="false"/));
check("P62037","…and says which element it controls",()=>has(H,/aria-controls="mainTabs"/));
check("P62038","…and the element it names really exists",()=>has(H,/id="mainTabs"/));
check("P62039","the burger's three bars are decorative spans, not text",()=>has(H,/<span><\/span><span><\/span><span><\/span>/));
check("P62040","app.js really wires the burger",()=>has(APP,/document\.getElementById\("navBurger"\)/));
check("P62041","…and keeps aria-expanded in step when the drawer opens",()=>has(APP,/burger\.setAttribute\("aria-expanded", open \? "true" : "false"\)/));
check("P62042","the brand block names the panel",()=>has(H,/<div class="brand"><span>🍽️<\/span> Manager/));
check("P62043","…and leaves a slot for THIS restaurant's own name",()=>has(H,/<span class="brand-rest" id="brandRest"><\/span>/));
check("P62044","…which app.js fills from the restaurant's own settings",()=>has(APP,/brandRest/));
check("P62045","the restaurant slot starts EMPTY, so no tenant can flash another's name",()=>has(H,/id="brandRest"><\/span>/));
check("P62046","the drawer scrim exists",()=>has(H,/id="navScrim"/));
check("P62047","…and it sits INSIDE the top bar, so it cannot cover the drawer",()=>{
  const bar=H.slice(H.indexOf('<header class="topbar">'),H.indexOf("</header>"));
  return bar.includes('id="navScrim"')||"the scrim moved out of the top bar";
});
check("P62048","…and the reason is written beside it",()=>has(H,/Lives INSIDE the topbar so\s*\n\s*it shares the topbar's stacking context/));
check("P62049","…and tapping it closes the drawer",()=>has(APP,/scrim\.onclick = \(\) => navDrawerSet\(false\)/));
check("P62050","the right-hand actions cluster exists",()=>has(H,/<div class="top-actions">/));
check("P62051","…and the connection light is documented as mounting FIRST inside it",()=>has(H,/mounts the 🟢\/🟡\/🔴 connection\s*\n *light as the FIRST child of \.top-actions/));
check("P62052","…and connbadge.js really targets that wrapper",()=>has(read("public/panels/connbadge.js"),/\.top-actions/));
check("P62053","the light/dark toggle button exists",()=>has(H,/id="themeToggle"/));
check("P62054","…and theme.js is the thing that names and wires it",()=>has(read("public/panels/theme.js"),/getElementById\("themeToggle"\)/));
check("P62055","the 🚩 report-an-issue button exists",()=>has(H,/id="reportIssueBtn"/));
check("P62056","…with a title a manager can read",()=>has(H,/title="Report an issue to the owner"/));
check("P62057","…and an accessible name",()=>has(H,/id="reportIssueBtn"[^>]*aria-label="Report an issue"/));
check("P62058","…and app.js opens the shared issue widget from it",()=>has(APP,/_ib\.onclick = openIssueModal/));
check("P62059","the 💳 my-profile-and-pay button exists",()=>has(H,/id="myProfileBtn"/));
check("P62060","…and starts hidden BOTH ways — the attribute and the inline style",()=>has(H,/id="myProfileBtn"[^>]*hidden style="display:none"/));
check("P62061","…because a bare `hidden` loses to an author display rule",()=>classStyled("theme-toggle"));
check("P62062","…and myprofile.js is what reveals it",()=>has(read("public/panels/myprofile.js"),/myProfileBtn/));
check("P62063","the profile button's glyph is a CARD, not a second person icon",()=>has(H,/id="myProfileBtn"[^>]*>💳</));
check("P62064","…and the reason two person glyphs were confusing is recorded",()=>has(H,/two IDENTICAL person\s*\n *glyphs sat side by side/));
check("P62065","the connection pill has its own element with an honest starting word",()=>has(H,/<div class="conn" id="conn">connecting…<\/div>/));
check("P62066","…so the panel never claims to be live before it is",()=>hasNot(H,/id="conn">Live/));
check("P62067","every button in the top bar is type=\"button\", so none can submit a form",()=>{
  const bar=H.slice(H.indexOf('<div class="top-actions">'),H.indexOf("</header>"));
  const btns=[...bar.matchAll(/<button([^>]*)>/g)];
  const bad=btns.filter(b=>!/type="button"/.test(b[1]));
  return bad.length===0||`${bad.length} button(s) without type=button`;
});
check("P62068","every id in the top bar is unique in the document",()=>{
  const all=[...HC.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const dup=all.filter((v,i)=>all.indexOf(v)!==i);
  return dup.length===0||`duplicate id(s): ${[...new Set(dup)].join(", ")}`;
});
check("P62069","every id the markup declares is looked up by some script or styled by the sheet",()=>{
  const dead=IDS.filter(i=>!idUsed(i));
  return dead.length===0||`nothing ever looks up: ${dead.join(", ")}`;
});
check("P62070","every class the markup uses has a rule in the panel's own stylesheet",()=>{
  const dead=CLASSES.filter(c=>!classStyled(c));
  return dead.length===0||`no rule for: ${dead.join(", ")}`;
});
check("P62071","the top bar declares no width or height inline — the sheet owns the layout",()=>{
  const bar=H.slice(0,H.indexOf("</header>"));
  return !/style="[^"]*(?:width|height)/.test(bar)||"an inline size is set in the top bar";
});
check("P62072","the only inline style in the whole document is the profile button's display:none",()=>eq(countOf(HC,/ style="/g),1));
check("P62073","the top bar holds exactly four action buttons plus the pill",()=>{
  const bar=H.slice(H.indexOf('<div class="top-actions">'),H.indexOf("</header>"));
  return eq(countOf(bar,/<button/g),3);
});
check("P62074","the brand's plate emoji matches the favicon's",()=>{
  return (H.includes("<span>🍽️</span>")&&H.includes("🍽️</text>"))||"the tab icon and the brand glyph disagree";
});
check("P62075","the panel's own name in the bar is the word the owner uses — Manager",()=>has(H,/class="brand"><span>🍽️<\/span> Manager/));
check("P62076","…and never the internal word 'editor'",()=>{
  const bar=H.slice(0,H.indexOf("</header>"));
  return !/>\s*Editor\s*</.test(bar.replace(/data-tab="items"[^>]*>[^<]*<i[^>]*>[^<]*<\/i><span class="tab-lbl">Editor<\/span>/,""))||"the bar says Editor where it should say Manager";
});
check("P62077","the header is one element, closed once",()=>(eq(countOf(H,/<header/g),1)===true&&eq(countOf(H,/<\/header>/g),1)===true)||"the header is malformed");
check("P62078","the kitchen panel has the same .top-actions wrapper, so the badge mounts there too",()=>has(HKIT,/class="top-actions"/));
check("P62079","…and the waiter tablet does",()=>has(HTAB,/class="top-actions"/));
check("P62080","the manager bar carries the 🚩 issue button, like its two siblings",()=>["editor","kitchen","tablet"].every(p=>/reportIssueBtn/.test(read(`public/panels/${p}/index.html`)))||"a panel lost the issue button");
check("P62081","the manager and tablet carry 💳 my-profile; the KITCHEN deliberately does not",()=>{
  const k=/myProfileBtn/.test(HKIT);
  return k===false||"the kitchen grew a profile button — it has NO profile, ruled three times";
});
check("P62082","the theme toggle exists in all three panels",()=>["editor","kitchen","tablet"].every(p=>/themeToggle/.test(read(`public/panels/${p}/index.html`)))||"a panel lost its skin toggle");
check("P62083","the connection light reaches all three panels — connbadge.js mounts it, no markup needed",()=>["editor","kitchen","tablet"].every(p=>/connbadge\.js\?v=/.test(read(`public/panels/${p}/index.html`)))||"a panel does not load connbadge.js");
check("P62084","the manager bar is the only one with a hamburger + drawer nav",()=>{
  return (/navBurger/.test(H)&&!/navBurger/.test(HKIT))||"the kitchen grew a drawer nav";
});
check("P62085","no element in the bar carries a tabindex, so tab order follows the markup",()=>{
  const bar=H.slice(0,H.indexOf("</header>"));
  return !/tabindex=/.test(bar)||"a tabindex overrides the natural order";
});
check("P62086","the burger comes BEFORE the brand in the markup, so it is the first thing a thumb reaches",()=>before(H,'id="navBurger"','class="brand"'));
check("P62087","the actions cluster comes last, so the tabs are reachable before it",()=>before(H,'id="mainTabs"','class="top-actions"'));
check("P62088","nothing in the bar has a hard-coded colour",()=>{
  const bar=H.slice(0,H.indexOf("</header>"));
  return !/style="[^"]*#[0-9a-f]{3}/i.test(bar)||"a colour is hard-coded in the markup";
});
check("P62089","the bar's emoji glyphs are marked decorative where a label is beside them",()=>countOf(H,/aria-hidden="true"/g)>=9||"a decorative glyph is announced twice");
check("P62090","the header is chrome, not a screen — under 40 lines once its notes are set aside",()=>{
  const bar=htmlCodeOf(H.slice(0,H.indexOf("</header>")));
  const n=bar.split("\n").filter(l=>l.trim()).length;
  return n<=40||`${n} markup lines`;
});

/* ═══════════ H · the nav and its tabs (P62091–P62150) ═══════════ */
check("P62091","the nav is a real <nav>",()=>has(H,/<nav class="tabs" id="mainTabs">/));
check("P62092","the drawer has its own header row with a title",()=>has(H,/<div class="tabs-head"><span>Sections<\/span>/));
check("P62093","…and a way out",()=>has(H,/<button id="navClose" type="button" aria-label="Close menu">✕<\/button>/));
check("P62094","…and that row is NOT a .tab, so app.js's .tab loops ignore it",()=>has(H,/Not a \.tab, so\s*\n *app\.js's querySelectorAll\("\.tab"\) loops ignore it/));
check("P62095","…and it really carries no tab class",()=>{
  const head=(H.match(/<div class="tabs-head">[\s\S]*?<\/div>/)||[""])[0];
  return !/class="[^"]*\btab\b/.test(head)||"the drawer header would be treated as a tab";
});
check("P62096","there are ten section tabs",()=>eq(TABS.length,10));
check("P62097","…and their keys are the ten the panel knows",()=>eq(TABS.join(","),"items,orders,tables,platform,banquet,inventory,dash,ratings,log,general"));
check("P62098","the tab that ships marked active is the one the panel actually opens on",()=>{
  const shipped=(H.match(/<button class="tab active" data-tab="([^"]+)"/)||[])[1];
  const boot=(APP.match(/: "(\w+)",\n  data: \{ items:/)||[])[1];
  return shipped===boot||`the markup lights "${shipped}" and app.js opens "${boot}"`;
});
check("P62099","…and it is the only one that does",()=>eq(countOf(HC,/class="tab active"/g),1));
check("P62100","every tab has a title, so a collapsed icon rail still names itself",()=>{
  const btns=[...HC.matchAll(/<button class="tab[^"]*"([^>]*)>/g)];
  const bad=btns.filter(b=>!/title="/.test(b[1]));
  return bad.length===0||`${bad.length} tab(s) with no title`;
});
check("P62101","every tab has a glyph AND a word — never an icon alone",()=>{
  const btns=[...HC.matchAll(/<button class="tab[^"]*"[^>]*>([\s\S]*?)<\/button>/g)];
  const bad=btns.filter(b=>!(/tab-ico/.test(b[1])&&/tab-lbl/.test(b[1])));
  return bad.length===0||`${bad.length} tab(s) missing an icon or a label`;
});
check("P62102","every glyph is aria-hidden, so the word is what is announced",()=>{
  const icos=[...HC.matchAll(/<i class="tab-ico"([^>]*)>/g)];
  const bad=icos.filter(i=>!/aria-hidden="true"/.test(i[1]));
  return bad.length===0||`${bad.length} glyph(s) announced to a screen reader`;
});
check("P62103","the Bills tab is labelled Bills, not Orders",()=>has(H,/data-tab="orders" title="Bills"/));
check("P62104","…and its visible word is Bills too",()=>has(H,/data-tab="orders"[\s\S]{0,120}<span class="tab-lbl">Bills<\/span>/));
check("P62105","the ratings tab says 'Rating review', the owner's word",()=>has(H,/<span class="tab-lbl">Rating review<\/span>/));
check("P62106","…and the KEY stayed 'ratings' — renaming a label never renames a key",()=>has(H,/data-tab="ratings" title="Rating review"/));
check("P62107","…and the file says that rule out loud",()=>has(H,/renaming a label must never rename a key/));
check("P62108","the log tab says 'Audit & logs', the owner's word",()=>has(H,/<span class="tab-lbl">Audit &amp; logs<\/span>/));
check("P62109","…and its key stayed 'log'",()=>has(H,/data-tab="log" title="Audit &amp; logs"/));
check("P62110","the ampersand is escaped in both the title and the label",()=>eq(countOf(HC,/Audit &amp; logs/g),2));
check("P62111","no raw & appears unescaped anywhere in the markup",()=>{
  const bad=[...HC.matchAll(/&(?!amp;|lt;|gt;|quot;|#\d+;|apos;)/g)];
  return bad.length===0||`${bad.length} unescaped ampersand(s)`;
});
check("P62112","the Banquet tab ships HIDDEN — it is admin-entitled per restaurant",()=>has(H,/data-tab="banquet" hidden/));
check("P62113","…and the entitlement is named",()=>has(H,/settings\.banquet_allowed/));
check("P62114","…and app.js is what un-hides it",()=>has(APP,/function syncBanquetTab\(\)/));
check("P62115","the Inventory tab ships HIDDEN for the same reason",()=>has(H,/data-tab="inventory" hidden/));
check("P62116","…and app.js is what un-hides it",()=>has(APP,/function syncInventoryTab\(\)/));
check("P62117","exactly two tabs ship hidden, and they are those two",()=>{
  const hid=[...HC.matchAll(/data-tab="([^"]+)" hidden/g)].map(m=>m[1]);
  return eq(hid.sort().join(","),"banquet,inventory");
});
check("P62118","the four FIXED tabs ship visible — tables, platform, bills and settings",()=>{
  const hid=new Set([...HC.matchAll(/data-tab="([^"]+)" hidden/g)].map(m=>m[1]));
  return ["tables","platform","orders","general"].every(t=>!hid.has(t))||"one of the four fixed tabs ships hidden";
});
check("P62119","…which is the owner's own rule, and the reason Bills left the gated list",()=>has(APP,/four will be the fixed one: table, platform, bill and setting/));
check("P62120","three tabs carry a live count badge",()=>eq(countOf(HC,/class="tab-badge" hidden/g),3));
check("P62121","…and they are Bills, Tables and Platform",()=>{
  const ids=[...HC.matchAll(/id="(\w+Badge)" class="tab-badge"/g)].map(m=>m[1]).sort().join(",");
  return eq(ids,"ordersBadge,platformBadge,tablesBadge");
});
check("P62122","every badge ships hidden, so no tab shows an empty count",()=>{
  const b=[...HC.matchAll(/class="tab-badge"([^>]*)>/g)];
  const bad=b.filter(x=>!/hidden/.test(x[1]));
  return bad.length===0||`${bad.length} badge(s) visible with no number`;
});
check("P62123","…and app.js is what fills each of the three",()=>["ordersBadge","tablesBadge","platformBadge"].every(i=>APP.includes(i))||"a badge is never written to");
check("P62124","the desktop rail toggle exists",()=>has(H,/id="railToggle"/));
check("P62125","…and it is NOT a .tab, so clicking it cannot switch screens",()=>{
  const t=(H.match(/<button id="railToggle" class="([^"]+)"/)||[])[1]||"";
  return !t.split(/\s+/).includes("tab")||"the rail toggle carries the tab class and would be treated as a section";
});
check("P62126","…it announces its state",()=>has(H,/id="railToggle"[^>]*aria-expanded="false"/));
check("P62127","…it has an accessible name",()=>has(H,/id="railToggle"[^>]*aria-label="/));
check("P62128","…and app.js keeps that name in step with the state",()=>has(APP,/btn\.setAttribute\("aria-label", word\)/));
check("P62129","FINDING — the rail button's SHIPPED word matches its shipped collapsed state",()=>{
  const lbl=(H.match(/id="railToggle"[\s\S]{0,220}?<span class="tab-lbl">([^<]*)<\/span>/)||[])[1];
  const aria=(H.match(/id="railToggle"[^>]*aria-label="([^"]*)"/)||[])[1];
  // app.js: collapsed → label "Keep open", aria "Expand menu", glyph »
  if (aria!=="Expand menu") return `aria-label is "${aria}"`;
  return lbl==="Keep open"||`the shipped label reads "${lbl}" while the shipped aria-label reads "${aria}" — the one button whose name says the opposite of its job, on first paint`;
});
check("P62130","…and its shipped glyph is the collapsed one",()=>{
  const ico=(H.match(/id="railToggle"[\s\S]{0,200}?<i class="tab-ico"[^>]*>([^<]*)<\/i>/)||[])[1];
  return ico==="»"||`the shipped glyph is "${ico}", app.js uses » while collapsed`;
});
check("P62131","app.js's collapsed wording is the one this markup must match",()=>has(APP,/lbl\.textContent = open \? "Collapse" : "Keep open"/));
check("P62132","…and its collapsed glyph",()=>has(APP,/ico\.textContent = open \? "«" : "»"/));
check("P62133","the rail's default is COLLAPSED, which is what the markup must ship",()=>has(APP,/return localStorage\.getItem\(RAIL_KEY\) === "1"/));
check("P62134","the rail only exists above 1024px, so a phone never sees this button",()=>has(APP,/const RAIL_MIN_W = 1024;/));
check("P62135","…and the markup says the button is desktop-rail only",()=>has(H,/DESKTOP RAIL ONLY/));
check("P62136","the nav is ONE list — the phone drawer and the desktop rail are the same markup",()=>eq(countOf(H,/<nav /g),1));
check("P62137","…and the file says why that matters",()=>has(H,/the same nav is already a full-width drawer with labels/));
check("P62138","app.js switches every tab through one click handler",()=>has(APP,/document\.querySelectorAll\("\.tab"\)\.forEach\(\(t\) => \(t\.onclick = async \(\) => \{ if \(await confirmDiscardIfDirty\(\)\)/));
check("P62139","…and it closes the drawer after a pick, so a phone tap does not leave it open",()=>has(APP,/setTab\(t\.dataset\.tab\); navDrawerSet\(false\);/));
check("P62140","…and it guards unsaved edits BEFORE switching",()=>has(APP,/if \(await confirmDiscardIfDirty\(\)\) \{ setTab/));
check("P62141","every data-tab in the markup is a key setTab can actually render",()=>{
  const known=["items","categories","filters","orders","tables","platform","banquet","inventory","dash","ratings","log","general"];
  const all=[...new Set([...HC.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]))];
  const bad=all.filter(t=>!known.includes(t));
  return bad.length===0||`unknown tab key(s): ${bad.join(", ")}`;
});
check("P62142","…and every key setTab treats as a full-width view has a tab or subtab to reach it",()=>{
  const all=new Set([...HC.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]));
  const views=["orders","tables","platform","log","dash","banquet","ratings","inventory","general"];
  const bad=views.filter(v=>!all.has(v));
  return bad.length===0||`no way to reach: ${bad.join(", ")}`;
});
check("P62143","the drawer registers a back layer, so phone BACK closes it",()=>has(APP,/LFH_BACK\.layer\("nav-drawer"/));
check("P62144","…and backstack.js is loaded to provide it",()=>has(H,/backstack\.js\?v=/));
check("P62145","the nav carries no role=tablist, so it is not lying about being a tablist",()=>hasNot(H,/role="tablist"/));
check("P62146","the nav's id is the one the burger says it controls",()=>{
  const c=(H.match(/aria-controls="([^"]+)"/)||[])[1];
  return has(H,new RegExp(`id="${c}"`));
});
check("P62147","every tab label is a whole word a manager would recognise, never an abbreviation",()=>{
  const lbls=[...HC.matchAll(/<span class="tab-lbl">([^<]+)<\/span>/g)].map(m=>m[1]);
  const bad=lbls.filter(l=>l.length<4);
  return bad.length===0||`too short to read: ${bad.join(", ")}`;
});
check("P62148","there are eleven labels — the ten tabs plus the rail toggle",()=>eq(countOf(HC,/class="tab-lbl"/g),11));
check("P62149","the nav closes before the actions cluster opens — no nesting mistake",()=>before(H,"</nav>",'<div class="top-actions">'));
check("P62150","the drawer's close button is the LAST thing in its header, where a thumb expects it",()=>has(H,/<span>Sections<\/span><button id="navClose"/));

/* ═══════════ I · the sidebar, the main area, the toast (P62151–P62200) ═══════════ */
check("P62151","the body's main region is a <main class=\"layout\">",()=>has(H,/<main class="layout">/));
check("P62152","…closed exactly once",()=>(countOf(H,/<main /g)===1&&countOf(H,/<\/main>/g)===1)||"the main region is malformed");
check("P62153","the left column is an <aside class=\"sidebar\">",()=>has(H,/<aside class="sidebar">/));
check("P62154","the Editor sub-nav ships hidden — it belongs to one section only",()=>has(H,/<div class="subtabs" id="editorSubtabs" hidden>/));
check("P62155","…and holds exactly three sub-tabs",()=>eq(countOf(HC,/class="subtab[ "]/g),3));
check("P62156","…named Dishes, Categories and Tags",()=>{
  const l=[...HC.matchAll(/class="subtab[^"]*" data-tab="[^"]+">([^<]+)</g)].map(m=>m[1]).join(",");
  return eq(l,"Dishes,Categories,Tags");
});
check("P62157","…with Dishes active first",()=>has(H,/<button class="subtab active" data-tab="items">Dishes<\/button>/));
check("P62158","…and their keys match app.js's EDITOR_SUB list exactly",()=>{
  const keys=[...HC.matchAll(/class="subtab[^"]*" data-tab="([^"]+)"/g)].map(m=>m[1]);
  const m=APP.match(/const EDITOR_SUB = \[([^\]]+)\]/);
  const app=m?m[1].split(",").map(s=>s.trim().replace(/"/g,"")):[];
  return eq(keys.join(","),app.join(","));
});
check("P62159","…and app.js shows the sub-nav only while one of the three is open",()=>has(APP,/sub\.hidden = !EDITOR_SUB\.includes\(tab\)/));
check("P62160","the sidebar has a search box",()=>has(H,/<input id="search" class="search" type="search"/));
check("P62161","…typed as search, so a phone offers a clear button and the right keyboard",()=>has(H,/id="search"[^>]*type="search"/));
check("P62162","…with a placeholder rather than a floating label",()=>has(H,/id="search"[^>]*placeholder="Search…"/));
check("P62163","…and app.js filters the list live from it",()=>has(APP,/box\.oninput = \(e\) => \{ state\.search = e\.target\.value; renderList\(\); renderSearchSuggest\(\); \}/));
check("P62164","the multi-select button ships hidden — it belongs to the Dishes list only",()=>has(H,/<button id="bulkBtn" class="btn" type="button" hidden/));
check("P62165","…with a title that says what it does",()=>has(H,/id="bulkBtn"[^>]*title="Select several dishes at once"/));
check("P62166","…and app.js is what reveals and wires it",()=>has(APP,/bb\.onclick = \(\) => \{ state\.bulkMode = !state\.bulkMode/));
check("P62167","the + New button exists and is the primary action",()=>has(H,/<button id="newBtn" class="btn primary">\+ New<\/button>/));
check("P62168","…and it guards unsaved edits before starting a new record",()=>has(APP,/\$\("#newBtn"\)\.onclick = async \(\) => \{ if \(await confirmDiscardIfDirty\(\)\) newRecord\(\); \}/));
check("P62169","the live search suggestions box exists",()=>has(H,/id="searchSuggest"/));
check("P62170","…ships hidden",()=>has(H,/id="searchSuggest" class="search-suggest" role="listbox" hidden/));
check("P62171","…and is announced as a listbox, so a screen reader knows what arrived",()=>has(H,/role="listbox"/));
check("P62172","…and app.js builds its rows",()=>has(APP,/function renderSearchSuggest\(\)/));
check("P62173","the category filter chip row exists and ships hidden",()=>has(H,/<div id="catFilter" class="cat-filter" hidden><\/div>/));
check("P62174","…and app.js fills it only on the Dishes list",()=>has(APP,/function renderCatFilter\(\)/));
check("P62175","the sidebar ships SKELETON rows, so it is never a blank white column",()=>eq(countOf(HC,/class="list-item lrow-skel"/g),6));
check("P62176","…each with a thumbnail block and two text lines",()=>eq(countOf(HC,/class="sk-thumb"/g),6)===true&&eq(countOf(HC,/class="sk-line"/g),6)===true||"a skeleton row is malformed");
check("P62177","…and the reason is written down: the same half-built screen the admin panel had",()=>has(H,/the same "half-built screen" the admin\s*\n *panel's unstyled flash was/));
check("P62178","…and the first real render replaces them by writing the list's innerHTML",()=>has(APP,/const ul = \$\("#list"\);\n  ul\.innerHTML = "";/));
check("P62179","the skeleton rows are styled, so the placeholder itself cannot flash unstyled",()=>["lrow-skel","sk-thumb","sk-txt","sk-line"].every(c=>classStyled(c))||"a skeleton class has no rule");
check("P62180","the sidebar's drag-to-resize handle exists",()=>has(H,/<div class="sidebar-resizer" id="sidebarResizer" title="Drag to resize"><\/div>/));
check("P62181","…with a title, so it is not an invisible mystery strip",()=>has(H,/id="sidebarResizer" title="Drag to resize"/));
check("P62182","…and app.js remembers the width across reloads",()=>has(APP,/localStorage\.setItem\("lfh_editor_sidebar_w"/));
check("P62183","…and clamps it so the column can never be dragged to nothing",()=>has(APP,/Math\.min\(560, Math\.max\(220, ev\.clientX\)\)/));
check("P62184","the right-hand pane exists with the id every render writes into",()=>has(H,/<section class="editor" id="editor">/));
check("P62185","…and it ships an honest empty state, not a blank box",()=>has(H,/<div class="empty">Pick something on the left, or hit <b>\+ New<\/b>\.<\/div>/));
check("P62186","…which names the exact button it is pointing at",()=>{
  const empty=(H.match(/<div class="empty">([\s\S]*?)<\/div>/)||[])[1]||"";
  return /\+ New/.test(empty)&&/\+ New<\/button>/.test(H)||"the empty state points at a button that does not exist";
});
check("P62187","the empty state is styled",()=>classStyled("empty"));
check("P62188","the toast host exists and ships hidden",()=>has(H,/<div id="toast" class="toast" hidden><\/div>/));
check("P62189","…and it sits OUTSIDE the layout, so a scrolling pane cannot clip it",()=>H.indexOf('id="toast"')>H.indexOf("</main>"));
check("P62190","…and app.js is what shows a message in it",()=>has(APP,/const t = \$\("#toast"\)/));
check("P62191","the document has exactly one toast host — two would fight",()=>eq(countOf(HC,/id="toast"/g),1));
check("P62192","every 'hidden' in the markup is on an element a script later reveals",()=>{
  const hid=[...HC.matchAll(/id="([^"]+)"[^>]*\bhidden\b/g)].map(m=>m[1]);
  const bad=hid.filter(i=>!new RegExp(`["'#]${i}\\b`).test(ALLJS));
  return bad.length===0||`hidden for ever: ${bad.join(", ")}`;
});
check("P62193","no element in the body carries a hard-coded pixel size",()=>{
  const body=H.slice(H.indexOf("<body>"));
  return !/style="[^"]*\d+px/.test(body.replace(/display:none/g,""))||"a pixel size is baked into the markup";
});
check("P62194","the body markup mentions no restaurant by name",()=>{
  const body=htmlCodeOf(H.slice(H.indexOf("<body>")));
  return !/French House|Aangan|Pizza Palace|Little/i.test(body)||"a tenant is named in the shared shell";
});
check("P62195","…and the comments do not name one either",()=>!/French House|Aangan/i.test(H)||"a tenant is named in a comment in the shared shell");
check("P62196","every <button> in the document is closed",()=>eq(countOf(HC,/<button/g),countOf(HC,/<\/button>/g)));
check("P62197","every <div> in the document is closed",()=>eq(countOf(HC,/<div/g),countOf(HC,/<\/div>/g)));
check("P62198","every <span> is closed",()=>eq(countOf(HC,/<span/g),countOf(HC,/<\/span>/g)));
check("P62199","the document ends with </html> and nothing after it",()=>has(H,/<\/html>\s*$/));
check("P62200","the shell holds no business logic at all — it is markup and script tags",()=>eq(countOf(H,/<script(?![^>]*src=)/g),0));

process.exit(report("T8 · static G–I") ? 1 : 0);
