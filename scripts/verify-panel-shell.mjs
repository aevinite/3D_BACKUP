// verify-panel-shell.mjs — the manager panel's HOST PAGE and SHELL keep their promises.
//
//   npm run verify:panel-shell
//
// WHY THIS GUARD EXISTS (T8, sweep #8, 2026-09-03). The shell — `public/panels/editor/index.html`
// plus the three tiny host files around it — is markup that nothing type-checks and no test opens.
// Five real faults had accumulated in it, and every one was the SAME shape: a line of the shell
// still described a world that the code around it had moved on from.
//
//   · the rail button shipped the word "Collapse" while shipping the collapsed state, so until
//     app.js (a megabyte) finished downloading, the one button whose job is to OPEN the rail read
//     "Collapse" — the exact fault app.js's own note says it fixed;
//   · the markup lit the EDITOR tab while app.js pins the panel to open on the FLOOR, so the
//     highlight sat on the wrong section and then jumped;
//   · `data-fit` still named `.bill-amt`, a class nothing has rendered since the 2026-08-03 Bills
//     rebuild renamed it — a selector matching nothing, reading as if the bill amount were covered;
//   · the /editor door forwarded ?rid= and silently dropped the ?as= person pin, which
//     /api/admin/act-as/go appends for exactly that path;
//   · a note claimed guestbell.js loads AFTER backstack.js when it loads before it.
//
// None of them could be caught by a type-checker, a unit test or a screenshot. All of them are
// caught by comparing the shell against the code it describes — which is all this file does.
//
// It is deliberately CROSS-FILE: it never asserts that the markup says a particular thing, it
// asserts that the markup AGREES with app.js, with panelGate.ts, with fitnums.js and with the
// panel's own stylesheet. A guard that only reads one file can only ever go stale with it.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => readFileSync(join(ROOT, f), "utf8");
const H = rd("public/panels/editor/index.html");
const HC = H.replace(/<!--[\s\S]*?-->/g, " ");          // markup with its notes set aside
const APP = rd("public/panels/editor/app.js");
const CSS = rd("public/panels/editor/style.css");
const FIT = rd("public/panels/fitnums.js");
const ED = rd("app/editor/page.tsx");
const PAGE = rd("app/manager/page.tsx");
const GATE = rd("lib/panelGate.ts");
const GO = rd("app/api/admin/act-as/go/route.ts");
const SAB = rd("lib/safeAreaBridge.ts");
// CODE, not notes. Both traps this repo has scars from: a check asserting a string is ABSENT
// passes/fails on the file's own comment quoting it (the obituaries below quote every line they
// removed), and LINE comments must be stripped BEFORE block comments or one `/*` inside a `//`
// swallows everything to the next `*/`.
const codeOf = (b) => b
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, " ");
const APPC = codeOf(APP);
const CSSC = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");

let pass = 0; const fails = [];
const ok = (what, cond, why) => { if (cond === true) { pass++; console.log(`  ✅ ${what}`); } else fails.push(`${what} — ${cond === false ? why : cond}`); };

console.log("\n→ the manager panel's shell still agrees with the code it describes\n");

/* 1 ─ the shipped nav state matches the state the panel actually boots into ───────────────── */
{
  const lit = (H.match(/<button class="tab active" data-tab="([^"]+)"/) || [])[1];
  const boot = (APP.match(/\n  tab: INV_ONLY[\s\S]*?:\s*"(\w+)",\n/) || [])[1];
  ok("the tab the markup lights is the tab the panel opens on",
    !!lit && !!boot && lit === boot,
    `the markup lights "${lit}" and app.js opens "${boot}" — the highlight would sit on the wrong section until app.js lands`);
  ok("…and exactly one tab ships marked active",
    (HC.match(/class="tab active"/g) || []).length === 1,
    `${(HC.match(/class="tab active"/g) || []).length} tabs ship active`);
}

/* 2 ─ the rail toggle's shipped word, glyph and accessible name match its shipped state ───── */
{
  const row = (H.match(/<button id="railToggle"[\s\S]*?<\/button>/) || [""])[0];
  const lbl = (row.match(/<span class="tab-lbl">([^<]*)<\/span>/) || [])[1];
  const ico = (row.match(/<i class="tab-ico"[^>]*>([^<]*)<\/i>/) || [])[1];
  const aria = (row.match(/aria-label="([^"]*)"/) || [])[1];
  const title = (row.match(/title="([^"]*)"/) || [])[1];
  const expanded = /aria-expanded="true"/.test(row);
  // app.js is the source of truth for all four words; read them out of it rather than repeating them
  const words = APP.match(/const word = open \? "([^"]+)" : "([^"]+)";/);
  const lbls = APP.match(/lbl\.textContent = open \? "([^"]+)" : "([^"]+)";/);
  const icos = APP.match(/ico\.textContent = open \? "([^"]+)" : "([^"]+)";/);
  ok("app.js still words the rail toggle in one place, so this guard has a source of truth",
    !!(words && lbls && icos), "syncNavRail's wording moved — re-point this check at it");
  if (words && lbls && icos) {
    const i = expanded ? 1 : 2;
    ok("the rail toggle's shipped LABEL matches its shipped state", lbl === lbls[i],
      `it ships aria-expanded="${expanded}" and the label "${lbl}"; app.js words that state "${lbls[i]}"`);
    ok("…its shipped GLYPH matches", ico === icos[i],
      `it ships "${ico}"; app.js uses "${icos[i]}" in that state`);
    ok("…its shipped accessible NAME matches", aria === words[i],
      `it ships "${aria}"; app.js uses "${words[i]}" in that state`);
    ok("…and its title says the same thing as its accessible name", title === aria,
      `title "${title}" vs aria-label "${aria}"`);
  }
}

/* 3 ─ every auto-fit selector matches something the panel can actually render ─────────────── */
{
  const list = (H.match(/data-fit="([^"]+)"/) || [])[1] || "";
  const sels = list.split(",").map((s) => s.trim()).filter(Boolean);
  const dead = [];
  for (const s of sels) for (const cls of s.match(/\.[A-Za-z][\w-]*/g) || []) {
    const n = cls.slice(1);
    const rendered = new RegExp(`class="[^"]*\\b${n}\\b`).test(APP) || new RegExp(`["' ]${n}[ "']`).test(APP);
    const styled = new RegExp(`\\.${n}[\\s,.:>{\\[]`).test(CSS);
    if (!rendered && !styled) dead.push(`${s} → .${n}`);
  }
  ok("every class in the auto-fit list is one this panel renders or styles", dead.length === 0,
    `matches nothing: ${dead.join(" · ")} — a renamed class leaves the figure unfitted and the list reading as if it were covered`);
  ok("…and the list does not name .bill-amt, renamed to .bl-amt on 2026-08-03",
    !/\.bill-amt\b/.test(list), "the dead class is back in the list");
  // a money figure in the fit net MUST also be in fitnums' exact family, or it can be abbreviated
  const exact = ((FIT.match(/var EXACT_SEL = "([^"]+)"/) || [])[1] || "").split(",").map((s) => s.trim());
  const money = sels.filter((s) => /amt|total|money|ks-val/.test(s)).map((s) => (s.match(/^\.[\w-]+/) || [])[0]).filter(Boolean);
  const loose = money.filter((m) => !exact.includes(m));
  ok("…and any money figure in it is covered by fitnums' EXACT family, so it can never be rounded",
    loose.length === 0, `could be abbreviated: ${loose.join(", ")}`);
}

/* 4 ─ the old /editor door carries every pin the console can send it ──────────────────────── */
{
  const allowsEditor = /ALLOWED_PATHS = new Set\(\[[^\]]*"\/editor"/.test(GO);
  const sendsAs = /const asPin = uid \? `&as=/.test(GO);
  ok("the console's quick-open still lists /editor and still appends the person pin",
    allowsEditor && sendsAs, "the quick-open changed — re-read whether /editor still needs the pins");
  if (allowsEditor && sendsAs) {
    ok("…and /editor forwards ?rid through the hop", /\?rid=\$\{encodeURIComponent\(rid\)\}/.test(ED),
      "an admin tab would come off its restaurant");
    ok("…and forwards the ?as person pin", /&as=\$\{encodeURIComponent\(as\)\}/.test(ED),
      "the profile's Visit-their-panel pin is dropped at the old door, silently");
    ok("…and forwards ?view=real, matched as the exact word", /view === "real"/.test(ED),
      "the ribbon's real-view pin is dropped at the old door");
    ok("…and accepts nothing else as a view", !/view \?/.test(ED.replace(/\/\/.*$/gm, "")),
      "a made-up view value would be passed on");
  }
  ok("panelIframeSrc is still the ONE builder both manager doors use",
    /panelIframeSrc\("\/panels\/editor\/index\.html", adminRid, \{ as, view \}\)/.test(PAGE)
    && /panelIframeSrc\("\/panels\/editor\/index\.html"/.test(rd("app/r/[restaurant]/manager/page.tsx")),
    "one of the two manager addresses builds its iframe url by hand again");
  ok("…and the host page's own note names all three pins it forwards",
    /\?rid=/.test(PAGE) && /\?as=/.test(PAGE) && /\?view=real/.test(PAGE),
    "a pin is forwarded that the file never mentions");
}

/* 5 ─ the inset bridge binds its load listener to a frame that may appear later ───────────── */
{
  ok("the safe-area bridge binds `load` when the frame APPEARS, not when it is called",
    /const bindLoad = \(\) => \{/.test(SAB) && /bindLoad\(\);/.test(SAB),
    "it is back to reading the frame once, up front — which wires nothing for a caller that attaches first, exactly the case its own doc-comment promises is safe");
  ok("…and it cannot double-register on the same element",
    /if \(!f \|\| f === bound\) return;/.test(SAB), "a re-push would add a second load listener");
  ok("…and the RETURNED teardown removes it from whichever element it bound to",
    /return \(\) => \{\s*bound\?\.removeEventListener\("load", onLoad\);/.test(SAB),
    "the load listener outlives the component — the copy inside bindLoad only covers a re-bind");
  ok("…and the keyboard is still told apart from the gesture bar",
    /if \(measured > 120\) measured = 0;/.test(SAB), "an open keyboard would pad the panel's bottom controls");
}

/* 6 ─ the shell's notes describe the shell that shipped ───────────────────────────────────── */
{
  const at = (f) => HC.indexOf(f);
  const claimsAfter = /After backstack\.js, because its sheet registers a back layer/.test(H);
  ok("no note claims guestbell.js loads after backstack.js while it loads before it",
    !(claimsAfter && at("/panels/guestbell.js") < at("/panels/backstack.js")),
    "the note and the order disagree — the next reader will 'fix' a working order");
  // A NOTE THAT NAMES A FILE MUST SIT ABOVE THAT FILE'S TAG. This is the exact shape the sweep
  // found: undobar.js's own note had swipehint.js's note AND its <script> wedged between it and
  // the tag it described, so the manifest read as if swipehint.js were the undo bar. Comparing
  // "which file does this note name" against "which file is the next tag" catches that and
  // nothing else — a note covering two neighbouring tags (swreg.js + offline.js) is deliberate
  // and names both, so it is not flagged.
  const orphan = [];
  {
    const re = /<!--([\s\S]*?)-->\s*<script src="\/panels\/([^"?]+)/g;
    let m;
    while ((m = re.exec(H))) {
      const note = m[1], next = m[2].split("/").pop();
      // ONLY the note's own SUBJECT counts — the name it opens with, as in
      //   <!-- undobar: the shared "take it back" bar … -->
      //   <!-- realtime.js: the ONE live-update channel … -->
      // Every other filename a note mentions is a load-order sentence about a NEIGHBOUR
      // ("Load BEFORE app.js"), and comparing against those would flag the whole manifest.
      const lead = note.match(/^\s*([a-z][\w-]{2,})(?:\.js)?:/);
      if (!lead) continue;                       // the note describes its tag by its job instead
      if (lead[1] + ".js" !== next) orphan.push(`the note that opens "${lead[1]}:" sits above ${next}`);
    }
  }
  ok("every note that names a script sits above THAT script's tag", orphan.length === 0,
    orphan.join(" · ") + " — the manifest would read as if the wrong file did that job");
  ok("every load-order rule that would CRASH the panel is still written down",
    /LFH_BILLDOC is not defined/.test(H) && /Must load BEFORE app\.js/.test(H),
    "a crash-ordering warning was deleted");
}

/* 7 ─ the ordering rules the notes state are the ordering the file has ────────────────────── */
{
  // HC, not H: the obituaries in this file name "editor/app.js" hundreds of lines above the tag,
  // so a bare indexOf on the raw text reads a NOTE as the load position.
  const before = (a, b) => HC.indexOf(a) > -1 && HC.indexOf(b) > -1 && HC.indexOf(a) < HC.indexOf(b);
  const rules = [
    ["/panels/billdoc.js", "editor/app.js", "printing a bill would throw"],
    ["/panels/backstack.js", "editor/app.js", "phone BACK would leave the panel mid-action"],
    ["editor/inventory.js", "editor/app.js", "the Inventory tab would not mount"],
    ["/panels/outbox.js", "/panels/connbadge.js", "the connection light could not read the queue"],
    ["/panels/outbox.js", "/panels/offline.js", "the offline bar could not read the queue"],
    ["/panels/realtime.js", "/panels/outbox.js", "the queue could not reach the live channel"],
    ["/panels/issue-raise.js", "editor/app.js", "Report an issue would throw"],
    ["/panels/floor-layouts.js", "editor/app.js", "the first floor render could not see a custom plan"],
  ];
  const broken = rules.filter(([a, b]) => !before(a, b)).map(([a, b, why]) => `${a} must load before ${b} — ${why}`);
  ok("every load-order rule the shell depends on still holds", broken.length === 0, broken.join(" · "));
  ok("theme.js is a BLOCKING script inside the head, so the skin is set before first paint",
    /<head>[\s\S]*<script src="\/panels\/theme\.js\?v=[0-9a-f]{8}"><\/script>[\s\S]*<\/head>/.test(H),
    "theme.js left the head, or gained defer/async — the panel would flash the wrong skin");
  ok("app.js is still the last script in the document",
    /editor\/app\.js\?v=[0-9a-f]{8}"><\/script>\s*<\/body>/.test(H),
    "something now loads after the panel's own code");
}

/* 9 ─ ONE connection indicator, one writer (the owner's items 9 + 11 + 12, 2026-09-03) ───── */
{
  const CB = rd("public/panels/connbadge.js");
  ok("the shell ships no second, legacy connection indicator",
    !/id="conn"/.test(HC), "the old text pill is back — connbadge.js hides it and app.js writes to it, so a manager gets two indicators, one invisible");
  ok("…and the panel's own code writes to no such element",
    !/\$\("#conn"\)/.test(APPC), "app.js is writing words into an element nobody can see");
  ok("…and the pill no longer carries code to hide one",
    !/getElementById\("conn"\)/.test(CB), "connbadge.js is hiding a legacy element again instead of it being removed");
  ok("…and the stylesheet no longer styles one",
    !/^\.conn[\s.{]/m.test(CSSC), "the dead `.conn` rules are back");
  ok("…so exactly one thing paints the connection light, and it is the pill",
    /badge\.id = "lfhConnBadge"/.test(CB), "connbadge.js no longer mounts the pill — the panel would have NO indicator at all");
}
{
  // the console reaches the manager panel at its real address; /editor stays, for old links only
  const consoleFiles = ["app/aevinite/page.tsx", "app/aevinite/recycle/page.tsx",
    "app/aevinite/restaurants/page.tsx", "app/aevinite/analytics/page.tsx"];
  const via = consoleFiles.filter((f) => /["']\/editor["']/.test(rd(f).replace(/\/\/.*$/gm, "")));
  ok("no admin-console link opens the manager panel through the retired /editor address",
    via.length === 0, `still going the long way round: ${via.join(", ")}`);
  ok("…and the recycle bin offers the manager panel ONCE, not twice under two names",
    (rd("app/aevinite/recycle/page.tsx").match(/label: "Manager"|label: "Menu editor"/g) || []).length === 1,
    "two rows in the recycle bin open the same screen");
  ok("…while /editor itself still answers, for links taped up before the rename",
    /redirect\("\/manager"/.test(ED), "the back-compat door is gone — an old bookmark would 404");
}
{
  const list = (H.match(/data-fit="([^"]+)"/) || [])[1] || "";
  const applied = /class="ktext"|class="[^"]*\bktext\b/.test(APPC);
  ok("the auto-fit list excludes .ktext only while something can apply it",
    /\.ktext/.test(list) === applied,
    applied ? "a word-valued dashboard tile exists again and the exclusion is missing — a sentence would be shrunk like a number"
            : "the list excludes .ktext, which nothing has applied since dashCard() stopped writing it");
  ok("…and the stylesheet styles .ktext only while something can apply it",
    /b\.ktext\s*\{/.test(CSSC) === applied,
    applied ? "the word-tile rule is missing" : "a dead `.dash-card b.ktext` rule is back");
}

/* 8 ─ this guard actually looked at something ─────────────────────────────────────────────── */
if (pass + fails.length < 30) {
  console.error(`\n✗ verify:panel-shell ran only ${pass + fails.length} checks — the shell parsed to nothing, so nothing was checked.`);
  process.exit(1);
}
if (fails.length) {
  console.error(`\n✗ ${fails.length} of ${pass + fails.length} failed:\n`);
  for (const f of fails) console.error(`  ❌ ${f}`);
  process.exit(1);
}
console.log(`\n✅ ${pass} checks — the manager panel's shell still says what the code around it does\n`);
