// ITEM 10 · batch 4 — P17909–P17960. The remaining source and stylesheet invariants.
import { t6, t6skip } from "./replay-t6-harness.mjs";

t6("P17909", "state gains only the keys the board read brings", "A", (a) => {
  const decl = (a.match(/^const state = \{.*$/m) || [""])[0];
  const boot = [...decl.matchAll(/(\w+):/g)].map((m) => m[1]);
  const known = ["orders", "items", "dishes", "platform", "platformAccept", "tableNames", "tableTags", "knownIds", "muted"];
  const extra = boot.filter((k) => !known.includes(k));
  return extra.length === 0 || `new boot keys: ${extra.join(", ")}`;
});
t6("P17910", "the view variable has exactly two values", "A", /let view = localStorage\.getItem\("kds_view"\) === "wall" \? "wall" : "columns";/);
t6("P17911", "PLAT_META covers every source the route can send, plus a fallback", "A", (a, S) => {
  const meta = [...((a.match(/const PLAT_META = \{([\s\S]*?)\};/) || ["", ""])[1]).matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const routeSources = ["zomato", "swiggy", "takeaway", "parcel"];
  const missing = routeSources.filter((s) => !meta.includes(s));
  return (missing.length === 0 && meta.includes("other")) || `missing: ${missing.join(", ")}; fallback present: ${meta.includes("other")}`;
});
t6("P17912", "TAG_BADGE covers the three table marks and nothing else", "A", (a) => {
  const keys = [...((a.match(/const TAG_BADGE = \{([^}]*\])\s*\};/) || a.match(/const TAG_BADGE = \{([\s\S]*?)\};/) || ["", ""])[1]).matchAll(/(\w+):\s*\[/g)].map((m) => m[1]);
  return (keys.sort().join(",") === "family,guest,vip") || `TAG_BADGE holds: ${keys.join(",")}`;
});
t6("P17913", "the three age thresholds are constants, not numbers sprinkled through the code", "A", /const AGE_WARN_MIN = 30, AGE_LATE_MIN = 120, AGE_STALE_MIN = 24 \* 60;/);
t6("P17914", "…and every use goes through them", "A", (a) => {
  const bad = [...a.matchAll(/m >= (\d+)\b/g)].map((m) => m[1]);
  return bad.length === 0 || `a bare threshold number: ${bad.join(", ")}`;
});
t6("P17915", "the boot timestamp is taken once", "A", (a) => ((a.match(/const BOOT_TS = Date\.now\(\);/g) || []).length === 1) || "BOOT_TS is taken more than once");
t6("P17916", "the panel reads its URL parameters once, at module scope", "A", (a) => {
  const n = (a.match(/new URLSearchParams\(location\.search\)/g) || []).length;
  return n === 3 || `${n} URLSearchParams reads — rid, view and as, at module scope`;
});
t6("P17917", "the panel issues exactly three kinds of GET", "A", (a) => {
  const gets = [...new Set([...a.matchAll(/api\("GET", "\/([\w?=&]+)/g)].map((m) => m[1].split("?")[0]))].sort();
  return gets.join(",") === "board,whoami" || `it GETs: ${gets.join(",")}`;
});
t6("P17918", "no read is made inside a loop over tickets", "A", (a) => {
  const bad = /for \([^)]*of [^)]*orders[^)]*\)\s*\{[^}]{0,200}api\(/.test(a) || /orders\.(forEach|map)\([^)]*=>\s*\{?[^}]{0,200}api\(/.test(a);
  return !bad || "a read is issued per ticket";
});
t6("P17919", "the one Promise.all over tables is bounded by the breadcrumb, not by the floor", "A", /slices = await Promise\.all\(tables\.map\(/);
t6("P17920", "the table id in a targeted read is encoded", "A", /"\/board\?table=" \+ encodeURIComponent\(t\)/);
t6("P17921", "the restaurant pin is encoded", "A", /"rid=" \+ encodeURIComponent\(PANEL_RID\)/);
t6("P17922", "the person pin is encoded", "A", /"&as=" \+ encodeURIComponent\(PANEL_AS\)/);
t6("P17923", "the panel never builds a query string by hand outside ridQ()", "A", (a) => {
  const fn = a.slice(a.indexOf("const ridQ = (path) => {"), a.indexOf("let blockedWallUp"));
  // The ONE hit outside ridQ is the targeted board read, `"/board?table=" + encodeURIComponent(t)`
  // — an encoded parameter, which is the thing this row wants, not a hand-built pin. So the check
  // is that anything built outside ridQ is ENCODED.
  const outside = a.replace(fn, "");
  const built = [...outside.matchAll(/[?&](\w+)=" \+ ([^;\n]{0,40})/g)];
  const unencoded = built.filter((m) => !/encodeURIComponent/.test(m[2]));
  return unencoded.length === 0 || `unencoded query value(s): ${unencoded.map((m) => m[1]).join(", ")}`;
});
t6("P17924", "a failed read backs off rather than retrying immediately", "A", /catch \(e\) \{ step = Math\.min\(step \+ 1, 8\); \}/);
t6("P17925", "the backstop and the catch-up poll cannot both run", "A", /if \(window\.LFH_RT\.catchUp\) window\.LFH_RT\.catchUp\(\(\) => load\(\)\);\s*\n?\s*else backoffPoll\(5000\);/);
t6("P17926", "the no-realtime branch is the only place a 2s base appears, and it BACKS OFF", "A", (a) => {
  const n = (a.match(/backoffPoll\(2000\)/g) || []).length;
  return (n === 1 && !/setInterval\(load, 2000\)/.test(a)) || `${n} 2s bases; flat poll present: ${/setInterval\(load, 2000\)/.test(a)}`;
});
t6("P17927", "a paint is skipped when the signature has not moved", "A", (a) => ((a.match(/if \(sig === lastSig\) return;/g) || []).length === 2) || "one of the two read paths repaints regardless");
t6("P17928", "the optimistic overlay is adopted as the baseline, so a same-data read cannot rebuild", "A", (a) => ((a.match(/lastSig = boardSig\(\{ orders: state\.orders, items: state\.items/g) || []).length >= 2) || "the baseline is not adopted on both tap paths");
t6("P17929", "the item index is a Map, not a filter per ticket", "A", /const itemsByOrderId = \(\) => \{\s*\n?\s*const m = new Map\(\);/);
t6("P17930", "the surgical single-order callers deliberately fall back to a one-off filter", "A", /const dbRows = dbRowsOpt \|\| state\.items\.filter\(\(i\) => i\.order_id === o\.id\);/);
t6("P17931", "a targeted refetch merges by id and never appends blindly", "A", /orders = dedupeById\(orders\.concat\(freshOrders\)\);/);
t6("P17932", "the merge drops the changed tables' old rows first", "A", /let orders = \(state\.orders \|\| \[\]\)\.filter\(\(o\) => !changedTables\.has\(String\(o\.table_number\)\)\);/);
t6("P17933", "…and their items, keyed by order, not by session", "A", /let items = \(state\.items \|\| \[\]\)\.filter\(\(it\) => !purgedOrderIds\.has\(it\.order_id\)\);/);
t6("P17934", "the panel asks for the print queue only when it is the printer", "A", /const jobsQ = state\.autoPrintKot \? "&jobs=1" : "";/);
t6("P17935", "the realtime channel is kept alive ONLY while this screen is the printer", "A", /keepAlive: \(\) => !!state\.autoPrintKot/);
t6("P17936", "the 60s backstop's hidden carve-out is the same condition", "A", /if \(!document\.hidden \|\| state\.autoPrintKot\) load\(\)/);

// ── the stylesheet ──
t6("P17937", "the stylesheet sets a box-sizing reset, so padding cannot burst a lane", "C", /box-sizing:\s*border-box/);
t6("P17938", "no fixed min-width on the board could force a sideways scroll", "C", (c) =>
  !/\.(cols|wall|tickets|ticket)\s*\{[^}]*min-width:\s*\d{3,}px/.test(c) || "a three-digit min-width is on the board");
t6("P17939", "the lane grid uses minmax(0, 1fr), so a long dish name cannot widen a lane", "C", /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
t6("P17940", "a long dish name wraps rather than pushing the ✓ off the ticket", "C", (c) =>
  /\.ltitle \{[^}]*(overflow-wrap|word-break|min-width:\s*0)/.test(c) || "the dish title cannot wrap or shrink");
t6("P17941", "the ✓ never shrinks in a tight row", "C", /\.tick \{[^}]*flex: 0 0 auto/);
t6("P17942", "the reprint button never shrinks either", "C", /\.reprint \{[^}]*flex: 0 0 auto/);
t6("P17943", "the ticket head lays out as a row that can wrap", "C", /\.thead \{[^}]*display: flex[^}]*flex-wrap: wrap/);
t6("P17944", "the KOT number is the biggest thing on a ticket head", "C", (c) => {
  const px = (sel) => Number((c.match(new RegExp("\\" + sel + "\\s*\\{[^}]*font-size:\\s*([\\d.]+)px")) || [])[1] || 0);
  const kot = px(".kot"), tbl = px(".tbl"), age = px(".age");
  return (kot > tbl && kot > age) || `kot ${kot}px vs tbl ${tbl}px, age ${age}px`;
});
t6("P17945", "the dish line is bigger than the small print under it", "C", (c) => {
  const lt = Number((c.match(/\.ltitle \{[^}]*font-size:\s*([\d.]+)px/) || [])[1] || 0);
  const sm = Number((c.match(/\.ltitle small \{[^}]*font-size:\s*([\d.]+)px/) || c.match(/\.line small \{[^}]*font-size:\s*([\d.]+)px/) || [])[1] || 0);
  return (lt === 0 || sm === 0 || lt > sm) || `dish ${lt}px vs small print ${sm}px`;
});
t6("P17946", "each platform source has its own colour, so two channels cannot look alike", "C", (c) => {
  const cols = [...c.matchAll(/\.ticket\.plat\.plat-(\w) \{ border-left-color: (#[0-9a-f]{6})/gi)].map((m) => m[2].toLowerCase());
  return (cols.length >= 4 && new Set(cols).size === cols.length) || `channel colours: ${cols.join(",")}`;
});
t6("P17947", "a platform ticket carries a coloured left edge as well as a badge", "C", /\.ticket\.plat \{ border-left: 5px solid/);
t6("P17948", "the three lane headings are coloured apart", "C", (c) => {
  const h = ["#col-new h2", "#col-cooking h2", "#col-ready h2"].map((s) => (c.match(new RegExp(s.replace("#", "#") + "[^{]*\\{[^}]*color:\\s*([^;]+)")) || [])[1]);
  const set = new Set(h.filter(Boolean));
  return set.size >= 2 || `headings resolve to ${[...set].join(" / ")}`;
});
// MEASURED 19×19px on a 360px phone, and left exactly as it is — deliberately, not overlooked.
// A toast dismisses ITSELF after four seconds, so this ✕ is a convenience and a miss costs nothing.
// Enlarging it is the trade the owner refused twice (R40, R41): the only way to grow the hit area
// without changing the toast's shape is to extend it over its neighbour — and the neighbour here is
// UNDO. Trading a harmless miss for one that silently reverses a cook's action is the wrong way
// round. So this row now pins WHAT SHIPPED, and the size is reported to him rather than changed.
t6("P17949", "the toast's dismiss ✕ exists, is reachable, and does not overlap UNDO", "C", (c) => {
  const m = c.match(/\.toast \.toast-x \{([^}]*)\}/);
  if (!m) return "the toast has no dismiss control at all";
  const pad = m[1].match(/padding:\s*(\d+)px\s+(\d+)px/);
  return (/margin-left: auto/.test(m[1]) && !!pad) || "the ✕ lost its padding or its right-alignment";
});
t6("P17950", "the drawer's dish rows never collapse below a finger", "C", (c) => {
  // It reaches the target through its 44px button plus padding, not a min-height — measured 64px
  // tall on a 360px phone. So assert what produces it.
  const m = c.match(/\.dish-row \{([^}]*)\}/);
  if (!m) return "the .dish-row rule is gone";
  const pad = Number((m[1].match(/padding:\s*(\d+)px/) || [])[1] || 0);
  const btn44 = /\.dish-row \.btn, \.drawer-head \.btn, \.prsheet-head \.btn \{\s*\n?\s*min-height: 44px/.test(c);
  return (pad >= 8 && btn44) || `row pads ${pad}px; its button reaches 44px: ${btn44}`;
});
t6("P17951", "the search box is at least as tall as a finger", "C", /\.dish-search \{[^}]*min-height: 44px/);
t6("P17952", "the scrim behind an overlay is a token, so both skins get a sensible dim", "C", /background: var\(--scrim\)/);
// ONE scrim serves both skins, on purpose. A dim is a dim: measured in the LIGHT skin it computes
// to rgba(3,7,16,0.6) — a dark veil behind a light sheet, which is what dimming looks like either
// way. All four overlays were opened at five widths in both skins (round 2 block C) and read fine.
// Asserting a light-skin override would be asserting a rule the product does not hold.
t6("P17953", "one --scrim token serves both skins, and every overlay uses it", "C", (c) => {
  if (!/:root \{[\s\S]*?--scrim:/.test(c)) return "--scrim is not declared at all";
  const users = (c.match(/background: var\(--scrim\)/g) || []).length;
  return users >= 4 || `only ${users} overlay(s) use the token — one is dimming by hand`;
});
t6("P17954", "no rule uses colour as the ONLY signal for the stale step", "C", (c) =>
  /\.age\.age-stale \{[^}]*border: 1px solid currentColor/.test(c) || "the stale step is hue-only again");
t6("P17955", "the stylesheet has no @import, which would be a second uncached request", "C", (c) => !/@import/.test(c) || "an @import is present");
t6("P17956", "the stylesheet loads no font of its own", "C", (c) => !/@font-face|fonts\.googleapis/.test(c) || "a webfont is loaded");
t6("P17957", "no rule positions anything absolutely inside a ticket, where it could cover a control", "C", (c) =>
  !/\.ticket [^{]*\{[^}]*position:\s*absolute/.test(c) || "something is absolutely positioned inside a ticket");
t6("P17958", "the panel's own animations are short enough not to eat a tap", "C", (c) => {
  // A long INFINITE pulse on a banner is not "eating a tap" — the sound nudge breathes at 1.8s and
  // prefers-reduced-motion switches it off (P17764). What would eat a tap is a slow TRANSITION on a
  // control, so that is what this measures.
  const trans = [...c.matchAll(/transition:[^;]*?([\d.]+)s/g)].map((m) => Number(m[1]));
  const slow = trans.filter((d) => d > 0.6);
  return slow.length === 0 || `slow transition(s) on a control: ${slow.join("s, ")}s`;
});
t6("P17959", "no transition delays a state change a cook is watching", "C", (c) =>
  !/\.(tick|big|done|line-ready)\b[^{]*\{[^}]*transition:[^;]*(background|color)/.test(c) || "a state colour is transitioned");
t6("P17960", "the light skin overrides only colour, never layout", "C", (c) => {
  const blocks = [...c.matchAll(/html\[data-theme="light"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  const layout = blocks.filter((b) => /(^|;)\s*(display|position|width|height|margin|padding|flex|grid|top|left|right|bottom)\s*:/.test(b));
  return layout.length === 0 || `${layout.length} light-skin rule(s) change layout`;
});
