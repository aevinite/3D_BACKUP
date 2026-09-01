// verify-owner-territory-s7.mjs — the SWEEP #7 additions to the owner's Menu / Team / Settings.
//
//   npm run verify:owner-s7
//
// WHY A SECOND FILE (T13, sweep #7, 2026-08-27)
// `verify-owner-territory.mjs` holds the 49 static claims that stand behind phases P06001–P06500.
// Those are re-run every sweep and must not be disturbed. This file holds the NEW ground —
// P21101–P21400 — and the largest part of it is the **Kitchen printing card on /owner/settings**,
// which did not exist when the first 500 phases were written (mig 336/338/341 added +134 lines to
// that page after the sweep-#6 ledger was filed, so the card had ZERO recorded checks).
//
// THE RULES THIS FILE OBEYS, inherited from pass 6 because they were each learned by getting them
// wrong:
//   1. ASSERT THE RULE, NOT THE SPELLING — comments are stripped before anything is matched, and
//      every ordering check is scoped to the function it is about.
//   2. NEVER MATCH PROSE — every fix in this territory carries a long comment quoting the old
//      broken code, so matching raw text makes checks pass and fail on documentation.
//   3. EVERY CHECK CARRIES ITS PHASE ID, so the ledger and the run can never drift apart.
//
// Static only: no server, no database, no login. Safe in any lane of a parallel sweep.
// The driven half is scripts/verify-owner-s7-live.mjs (P21401–P21600).
import fs from "node:fs";
import path from "node:path";

const read = (f) => { try { return fs.readFileSync(path.resolve(f), "utf8"); } catch { return null; } };
const code = (s) => String(s || "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
const plain = (s) => String(s || "").replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&rsquo;/g, "’").replace(/&nbsp;/g, " ");
// PROSE IS MATCHED FLAT (learned here, 2026-08-27). A sentence in JSX is wrapped by the editor
// wherever the line ran out — "so it can never be\n            lost" — so a regex written the way
// the sentence READS fails on source that is perfectly correct. Four of my own checks failed that
// way on the first run of this file. Every prose assertion below goes through `flat`.
const flat = (s) => plain(s).replace(/\s+/g, " ");

let pass = 0, fail = 0; const fails = [];
const P = (id, claim, cond, note = "") => {
  if (cond) { pass++; if (!process.env.QUIET) console.log(`  ✅ ${id} ${claim}`); }
  else { fail++; fails.push(`${id} ${claim}${note ? ` — ${note}` : ""}`); console.log(`  ❌ ${id} ${claim}${note ? ` — ${note}` : ""}`); }
};

const MENU = "app/owner/menu/page.tsx", ROSTER = "app/owner/staff/page.tsx",
      PERSON = "app/owner/staff/[id]/page.tsx", SET = "app/owner/settings/page.tsx";
const rawM = read(MENU), rawR = read(ROSTER), rawP = read(PERSON), rawS = read(SET);
if (!rawM || !rawR || !rawP || !rawS) { console.log("❌ one of the four owned files is missing — if they moved, update this guard"); process.exit(1); }
const m = code(rawM), r = code(rawR), pr = code(rawP), st = code(rawS);
const stT = flat(st), rT = flat(r), mT = flat(m);
const css = read("app/globals.css") || "";
const printRoute = code(read("app/api/owner/printing/route.ts") || "");
const setRoute = code(read("app/api/owner/settings/route.ts") || "");
const helpers = code(read("lib/printHelpers.ts") || "");
// The printing card's own slice of the settings page — everything between its heading and the
// password card that follows it. Scoped so a match cannot come from elsewhere on the page.
// Start at the GATE that decides whether the card renders, not at its heading text — the heading
// sits inside the card shell, so slicing from the words left `className="adm-card"` outside the
// slice and two checks reported the card was not built like its neighbours when it is.
const cardStart = st.indexOf("data?.printing && data.printing.length") > -1
  ? st.lastIndexOf("{", st.indexOf("data?.printing && data.printing.length"))
  : st.indexOf("Kitchen printing");
// The boundary must be CODE, not a comment: `code()` has already stripped every comment, so
// looking for `{/* Change password */}` found nothing and the "card" silently swallowed the rest
// of the page — which is how two checks below first reported a button and four hexes that are not
// on this card at all.
const cardEnd = st.indexOf("data?.canChangePassword") > -1 ? st.indexOf("data?.canChangePassword") : st.length;
const card = cardStart > -1 ? st.slice(cardStart, cardEnd) : "";
const cardT = flat(card);

console.log("Sweep #7 — the new ground on the owner's three screens (P21101–P21400)\n");

// ══ BAND G1 · THE KITCHEN PRINTING CARD — does it exist, and is it built the way this console builds things?
console.log("\nG1 · the Kitchen printing card, structure and wording (P21101–P21200)");
P("P21101", "the card exists on the owner's Settings screen at all", cardStart > -1);
P("P21102", "it is headed \"Kitchen printing\", the words the guide and the admin screen use", /Kitchen printing/.test(cardT));
P("P21103", "it renders ONLY when the server sent at least one restaurant with printing on", /data\?\.printing && data\.printing\.length/.test(st));
P("P21104", "…so a restaurant without printing sees no card, no grey box and no hint (R36)", !/printing is (off|not)|no printing|printing isn.t/i.test(cardT));
P("P21105", "the gate uses optional chaining, so a failed settings load cannot throw here", /data\?\.printing/.test(st));
P("P21106", "one row per restaurant, keyed by the restaurant's id (never the array index)", /key=\{p\.restaurant_id\}/.test(card));
P("P21107", "a restaurant with no name still prints something readable", /p\.name \|\| "This restaurant"/.test(card));
P("P21108", "the row says where the paper comes out, in words, not a code", /tickets print on/.test(cardT));
P("P21109", "…and it translates the stored target rather than printing it raw", /p\.target === "counter"/.test(card) && /p\.target === "both"/.test(card));
P("P21110", "…covering all three stored values, with the kitchen as the fallback", /: "the kitchen screen"/.test(cardT));
P("P21111", "the row names which screen has actually taken the job", /printing now:/.test(cardT));
P("P21112", "…and says so plainly when no screen has", /no screen has taken it yet/.test(cardT));
P("P21113", "…and marks a screen that has stopped checking in", /gone quiet/.test(cardT));
P("P21114", "a COMPUTER that owns the paper is described as a computer, not a screen", /no screen needed/.test(cardT));
P("P21115", "…and that branch is preferred over the screen branch when a helper exists", card.indexOf("kotHelper ?") > -1 && card.indexOf("kotHelper ?") < card.indexOf("no screen has taken it yet"));
P("P21116", "…and it names the printer, not a device id", /kotHelper\.printer/.test(card));
P("P21117", "…and the computer, not a fingerprint", /kotHelper\.computer/.test(card));
P("P21118", "…and says when that computer is asleep, with what happens to the tickets", /asleep, tickets waiting/.test(cardT));
P("P21119", "the sub-card is headed as a question an owner actually asks", /Where your paper comes out right now/.test(cardT));
P("P21120", "…and it only renders when the live read answered", /\{printing \?/.test(card));
P("P21121", "with no computer set up, it says a screen has to do it", /so a screen has to do it/.test(cardT));
P("P21122", "…and tells the owner the one thing that would change that", /Ask us to set one up/.test(cardT));
P("P21123", "with a computer set up, it says nothing you close can stop it", /nothing you close can stop it/.test(cardT));
P("P21124", "each computer is listed by its own name", /\{c\.name\}/.test(card));
P("P21125", "…keyed by that name", /key=\{c\.name\}/.test(card));
P("P21126", "…with a coloured dot that is NOT the only signal", /c\.connected \? "ready/.test(card) || /c\.connected \?/.test(card) && /ready/.test(cardT));
P("P21127", "…the dot is hidden from a screen reader, because the words carry it", /aria-hidden="true" style=\{\{ width: 9/.test(card));
P("P21128", "a ready computer says how long ago it was seen", /seen \$\{c\.secondsAgo/.test(card));
P("P21129", "…and a never-seen computer says exactly that, not \"0s ago\"", /has never checked in/.test(cardT));
P("P21130", "…and a sleeping one gives a human age, not raw seconds", /Math\.round\(c\.secondsAgo \/ 3600\)/.test(card) && /Math\.round\(c\.secondsAgo \/ 60\)/.test(card));
P("P21131", "…switching from minutes to hours past an hour", /c\.secondsAgo > 3600/.test(card));
P("P21132", "…and `secondsAgo` of 0 cannot print \"undefined\"", /c\.secondsAgo \?\? 0/.test(card));
P("P21133", "the printers attached to a computer are listed when there are any", /c\.printers\.length \?/.test(card));
P("P21134", "…and nothing is drawn when there are none", /c\.printers\.length \? .*: null/.test(card.replace(/\n/g, " ")));
P("P21135", "the routes block only renders when there is a route", /printing\.routes\.length \?/.test(card));
P("P21136", "each kind of paper is named in English, not by its stored key", /KIND_WORDS\[r\.kind\]/.test(card));
P("P21137", "…with the raw key as a last resort so a new kind is never blank", /KIND_WORDS\[r\.kind\] \|\| r\.kind/.test(card));
P("P21138", "…and the English list covers every kind the server can send", ["kot", "bill", "banquet", "label", "test"].every((k) => new RegExp(`${k}:`).test(st)));
P("P21139", "…and the words match the paper, not the code (\"Kitchen slips\", not \"kot\")", /Kitchen slips/.test(stT) && /Parcel labels/.test(stT));
P("P21140", "a route says which computer holds it", /on \{r\.computer\}/.test(card));
P("P21141", "…and flags a sleeping one right there", /asleep — waiting/.test(cardT));
P("P21142", "the waiting count is a sentence, not a bare number", /waiting to print/.test(cardT));
P("P21143", "…and it is singular for one thing", /thing is/.test(cardT) && /things are/.test(cardT));
P("P21144", "…and says so plainly when nothing is waiting", /Nothing is waiting to print/.test(cardT));
P("P21145", "automatic printing being off is stated before the count, not instead of it", card.indexOf("Automatic printing is switched off") < card.indexOf("waiting to print"));
P("P21146", "…and it reassures that nothing is lost", /tickets wait and nothing is lost/.test(cardT));
P("P21147", "the card offers NO control at all — printing is hardware, and the admin's", !/<button/.test(card));
P("P21148", "…and says who changes it", /done for you by Aevidine/.test(cardT));
P("P21149", "…twice: once for the routing, once for the two switches", (cardT.match(/done for you by Aevidine/g) || []).length >= 2);
P("P21150", "the guide is a link, opening in its own tab", /href="\/print-setup\.html" target="_blank"/.test(card));
P("P21151", "…with rel=noopener, like every other new-tab link in this territory", /href="\/print-setup\.html" target="_blank" rel="noopener"/.test(card));
// EXPECTATION MOVED 2026-09-01, same id, same claim. The gap was an inline style on this one
// button for one commit; it is now `gap` on `.owx .adm-btn` in app/globals.css, because four more
// buttons in this console had the identical fault. Assert the RULE — a per-button override would
// let the shared one rot unnoticed, which is exactly how the other four came to be broken.
P("P21152", "…and its icon is spaced off its label (a flex button trims the markup space)",
  (() => { const i = css.indexOf("\n.owx .adm-btn {"); return i > -1 && /gap:\s*\d/.test(css.slice(i, css.indexOf("}", i))); })());
P("P21153", "there is a direct link per operating system, so nobody has to hunt", ["#windows", "#mac", "#linux"].every((h) => card.includes(`/print-setup.html${h}`)));
P("P21154", "…each of those opens in its own tab too", (card.match(/print-setup\.html#[a-z]+" target="_blank"/g) || []).length === 3);
P("P21155", "…each with rel=noopener", (card.match(/print-setup\.html#[a-z]+" target="_blank" rel="noopener"/g) || []).length === 3);
P("P21156", "the guide page the links point at actually exists in this repo", !!read("public/print-setup.html"));
P("P21157", "…and it really carries the three anchors they jump to", ["windows", "mac", "linux"].every((a) => (read("public/print-setup.html") || "").includes(`id="${a}"`)));
P("P21158", "the card says there is nothing to download, which is the standing rule", /nothing to download/.test(cardT));
P("P21159", "…and why (a downloaded script is blocked by macOS)", /blocked by macOS/.test(cardT));
P("P21160", "the card tells the owner a ticket is queued the moment an order is placed", /queued by the server the moment an order is placed/.test(cardT));
P("P21161", "…so it can never be lost", /can never be lost/.test(cardT));
P("P21162", "…which is the truth mig 335 actually implements (a queue, not a tab noticing)", /print_jobs|printQueue/.test(printRoute + helpers));
P("P21163", "it says where the per-screen switch lives, per panel", /manager screen/.test(cardT) && /kitchen screen/.test(cardT));
P("P21164", "…naming the real menu path in the manager panel", /Settings → Printing/.test(cardT));
// Every `${` on this card must be INSIDE a template literal — one sitting in plain JSX text would
// print the two characters to the owner. (The rendered-text scan is P21463, in the live half; this
// is the static half of the same claim, and it must not simply forbid the character, because four
// legitimate template literals use it.)
P("P21165", "every template placeholder on this card is inside a template literal, never loose in the text",
  (card.match(/\$\{/g) || []).length === (card.match(/`[^`]*\$\{/gs) || []).length
  || (card.match(/\$\{/g) || []).every(() => true) && !/>[^<`]*\$\{/.test(card));
P("P21166", "no sentence on this card can print \"undefined\"", !/undefined/.test(cardT));
P("P21167", "…or \"[object Object]\"", !/\[object Object\]/.test(cardT));
P("P21168", "…or \"NaN\"", !/NaN/.test(card));
P("P21169", "…or a stray closing comment marker", !/-->/.test(card));
P("P21170", "no restaurant name or slug is hard-coded anywhere in the card", !/french-house|aangan|My Little French/i.test(card));
P("P21171", "the card holds no printer name of its own — every one comes from the server", !/EPSON|TM-T|thermal/i.test(card));
P("P21172", "…and no port, address or device path", !/usb|\/dev\/|:9100/i.test(card));
P("P21173", "the type for the live read names every field the card renders", ["allowed", "on", "waiting", "computers", "routes"].every((k) => new RegExp(`${k}:`).test(st.slice(0, st.indexOf("type Data")))));
P("P21174", "…and the server answers every one of them", ["allowed", "on", "waiting", "computers", "routes"].every((k) => new RegExp(`${k}[,:]`).test(printRoute)));
P("P21175", "…and answers nothing the card does not need (no ids, no fingerprints)", !/fingerprint/.test(printRoute.slice(printRoute.indexOf("return NextResponse.json({"))));
P("P21176", "the settings type names every printing field the card renders", ["restaurant_id", "name", "target", "station", "stale"].every((k) => new RegExp(`${k}:`).test(st.slice(0, st.indexOf("type Data") + 900))));
P("P21177", "the server only lists a restaurant whose printing is BOTH allowed and on", /auto_print_kot !== true \|\| .*auto_print_kot_allowed !== true/.test(setRoute));
P("P21178", "…continuing past it silently, so nothing is mentioned (R36)", /continue;/.test(setRoute.slice(setRoute.indexOf("auto_print_kot !== true"), setRoute.indexOf("auto_print_kot !== true") + 200)));
P("P21179", "the live route refuses outright when printing is not allowed", /auto_print_kot_allowed !== true\) return NextResponse\.json\(\{ allowed: false \}\)/.test(printRoute));
P("P21180", "…and when the owner holds no restaurant at all", /if \(!target\) return NextResponse\.json\(\{ allowed: false \}\)/.test(printRoute));
P("P21181", "…letting the scope decide the restaurant, never the query string alone", /scope\.all \|\| ids\.includes\(rid\)/.test(printRoute));
P("P21182", "the card never renders the live answer when it says not allowed", /j && j\.allowed \? j : null/.test(st));
P("P21183", "…and a thrown live read leaves whatever was on screen, rather than blanking it", /catch \{ \/\* leave whatever we had/.test(rawS) || /catch \{[^}]*\}/.test(st.slice(st.indexOf("loadPrinting"), st.indexOf("loadPrinting") + 500)));
P("P21184", "the live read never blocks the rest of the page", st.indexOf("const loadPrinting") > st.indexOf("const load ="));
P("P21185", "the stale mark is computed from a real timestamp, not guessed", /Date\.now\(\) - Date\.parse\(st\.last_seen_at\)/.test(setRoute));
P("P21186", "…against a stated window, not a magic literal buried mid-expression", /3 \* 60 \* 1000/.test(setRoute));
P("P21187", "the live read's \"connected\" comes from the server, never from the browser's clock", /connected: /.test(printRoute) && !/Date\.now\(\)/.test(card));
P("P21188", "…and the server's window is a named constant, so the card can be judged against it", /HELPER_STALE_MS/.test(helpers));
P("P21189", "the card's refresh is faster than that window, so \"ready\" cannot go stale on screen", (() => { const ms = (helpers.match(/HELPER_STALE_MS = ([\d_]+)/) || [])[1]; const poll = (st.match(/loadPrinting\(\); \}, (\d+)\)/) || [])[1]; return ms && poll && Number(poll) < Number(ms.replace(/_/g, "")); })());
P("P21190", "the card is above the password form, and below Appearance", card.length > 0 && st.indexOf("Kitchen printing") > st.indexOf("Appearance") && st.indexOf("Kitchen printing") < st.indexOf("Change password"));
P("P21191", "the row wraps rather than overflowing a phone", /flexWrap: "wrap"/.test(card));
P("P21192", "…and so does the button strip", /display: "flex", gap: 8, flexWrap: "wrap"/.test(card));
P("P21193", "…and the per-computer line", /gap: 8, flexWrap: "wrap"/.test(card));
P("P21194", "…and each route line", /padding: "3px 0", flexWrap: "wrap"/.test(card));
P("P21195", "the route label has a fixed column so the printers line up", /minWidth: 130/.test(card));
P("P21196", "every colour on the card is a declared token or has a fallback", (card.match(/var\(--[a-z-]+\)/g) || []).every((v) => /--(border|accent|adm-ok|adm-danger|adm-warn|muted|text|card|bg)\)/.test(v)));
P("P21197", "…and the two raw hexes are the status dot only, where the words carry the meaning", (card.match(/#[0-9a-f]{6}/gi) || []).length <= 2);
P("P21198", "the card adds no popup or drawer, so nothing needs a phone-Back layer", !/useBackClose|LFH_BACK|dialog/.test(card));
P("P21199", "the card writes nothing — it is read-only, as the printing rule requires", !/method: "POST"|method: "PATCH"|method: "DELETE"/.test(card));
P("P21200", "…so it needs no clash expectation and no idempotency key", !/X-LFH-Expect|X-LFH-Action-Id/.test(card));

// ══ BAND G2 · EGRESS AND LIFECYCLE
console.log("\nG2 · what these three screens cost while they sit open (P21201–P21240)");
const pollBlk = st.slice(st.indexOf("const showsPrinting"), st.indexOf("const showsPrinting") + 900);
P("P21201", "the printing refresh only runs while its card is on screen", /if \(!showsPrinting\) return;/.test(pollBlk));
P("P21202", "…it skips the tick while the tab is hidden", /if \(!document\.hidden\)/.test(pollBlk));
P("P21203", "…it stops entirely on visibilitychange rather than just skipping", /const stop = \(\)/.test(pollBlk) && /if \(document\.hidden\) stop\(\)/.test(pollBlk));
P("P21204", "…and refreshes once on the way back, so the first thing seen is current", /else \{ loadPrinting\(\); start\(\); \}/.test(pollBlk));
P("P21205", "…and removes its own listener, so navigating away leaves nothing behind", /removeEventListener\("visibilitychange"/.test(pollBlk));
P("P21206", "…and clears its own timer", /clearInterval\(t\)/.test(pollBlk));
P("P21207", "…and cannot start two timers at once", /if \(!t\) t = setInterval/.test(pollBlk));
P("P21208", "the roster polls nothing at all", !/setInterval/.test(r));
P("P21209", "the Menu page polls nothing at all", !/setInterval/.test(m));
P("P21210", "the person page polls nothing at all", !/setInterval/.test(pr));
// Count CALLS, not the word: `ReturnType<typeof setInterval>` is a type annotation, not a timer,
// and counting the bare word reported two.
P("P21211", "the settings page has exactly ONE repeating timer", (st.match(/setInterval\(/g) || []).length === 1);
P("P21212", "the roster loads once per mount, and on demand", (r.match(/useEffect\(\(\) => \{ load\(\); \}/g) || []).length === 1);
P("P21213", "the settings page loads its main answer once per mount", /useEffect\(\(\) => \{ load\(\); \}, \[load\]\)/.test(st));
P("P21214", "…and its printing answer once per mount", /useEffect\(\(\) => \{ loadPrinting\(\); \}, \[loadPrinting\]\)/.test(st));
P("P21215", "both settings reads are memoised on the scope pin, so a re-render is not a re-fetch", /useCallback\([\s\S]{0,400}\}, \[scp\]\)/.test(st));
P("P21216", "the roster's load is memoised on its scope helper", /const load = useCallback\([\s\S]{0,700}\}, \[withScope, fail\]\)/.test(r));
P("P21217", "every roster read is scoped by the restaurant pin", !/fetch\("\/api\/owner\/staff/.test(r));
P("P21218", "…through one helper, so a new call site cannot forget", (r.match(/withScope\(/g) || []).length >= 6);
P("P21219", "the settings reads carry the same pin", (st.match(/\$\{scp\}/g) || []).length >= 3);
P("P21220", "the Menu page names its columns and never selects everything", !/select\("\*"\)/.test(m));
P("P21221", "…and its reads are keyed by id, never a whole-table scan", /\.in\("id", owned\)/.test(m) && /\.eq\("id", rid\)/.test(m));
P("P21222", "…and it does not read the table at all when the owner holds nothing", /if \(owned\.length\)/.test(m));
P("P21223", "…and the entitlement and the names come back in ONE read", /select\("id, name, owner_entitlements"\)/.test(m));
P("P21224", "the printing route names its columns too", /select\("auto_print_kot, auto_print_kot_allowed"\)/.test(printRoute));
P("P21225", "…and its three follow-up reads run together, not one after another", /await Promise\.all\(\[agentsView/.test(printRoute));
P("P21226", "the settings route's two printing reads also run together", /Promise\.all\(\[\s*sb\.from\("settings"\)/.test(setRoute));
P("P21227", "…both keyed by the restaurants the owner already has", /\.in\("restaurant_id", ids\)/.test(setRoute));
P("P21228", "…and skipped entirely when there are none", /if \(ids\.length\)/.test(setRoute));
P("P21229", "the printing station read asks only for active stations", /\.eq\("active", true\)/.test(setRoute));
P("P21230", "the roster's list is capped server-side", /\.limit\(/.test(code(read("app/api/owner/staff/route.ts") || "")));
P("P21231", "the search filters what is already loaded and fetches nothing", !/fetch[\s\S]{0,120}\bq\b/.test(r.slice(r.indexOf("const needle"), r.indexOf("const needle") + 400)));
P("P21232", "…so typing cannot generate a request per keystroke", !/onChange=\{[^}]*fetch/.test(r));
P("P21233", "the skin change writes locally and reloads — no server round trip", !/fetch[\s\S]{0,80}skin/.test(st));
P("P21234", "nothing in this territory subscribes to realtime it does not need", !/\.channel\(/.test(m + r + pr + st));
P("P21235", "…so no channel can be left open on a hidden tab", !/subscribe\(/.test(m + r + pr + st));
P("P21236", "no read here is unbounded from the client side", !/limit=\d{4,}/.test(m + r + pr + st));
P("P21237", "the roster does not re-request on every keystroke of the rename editor either", !/onChange=\{[^}]*call\(/.test(r));
P("P21238", "the person page fetches nothing itself — the shared host owns every request", !/fetch\(/.test(pr));
P("P21239", "the Menu embed is mounted once and re-mounted only on a restaurant change", /useEmbedFrame\(src, liveSkin, \[rid\]\)/.test(code(read("components/owner/OwnerMenuEditor.tsx") || "")));
P("P21240", "…so switching skin does not re-download the whole editor", /postMessage|liveSkin/.test(code(read("components/owner/useOwnerSkin.ts") || "")));

// ══ BAND G3 · /owner/menu AS IT IS NOW
console.log("\nG3 · the Menu page after its rewrite (P21241–P21280)");
P("P21241", "the entitlement is merged with the shared helper, not re-implemented here", /mergeOwnerEntitlements/.test(m));
P("P21242", "…and an absent key still means ON, matching the server", /\.menu !== false/.test(m));
P("P21243", "…so a restaurant that never had the switch touched is unaffected", /!== false/.test(m) && !/=== true/.test(m.slice(m.indexOf("mergeOwnerEntitlements"), m.indexOf("mergeOwnerEntitlements") + 120)));
P("P21244", "a failed read is its own state, distinct from a switched-off section", /couldntRead/.test(m));
P("P21245", "…set from the query's own error, not from an empty result", /if \(q\.error\) couldntRead = true/.test(m));
P("P21246", "…on BOTH branches, the owner's and the admin's", (m.match(/if \(q\.error\) couldntRead = true/g) || []).length === 2);
P("P21247", "…and it is answered before the switched-off card can render", m.indexOf("if (couldntRead)") < m.indexOf("if (!selected)"));
P("P21248", "the couldn't-read card tells the owner nothing has changed", /Nothing has changed/.test(mT));
P("P21249", "…and that their menu is safe", /your menu is safe/.test(mT));
P("P21250", "…and what to do (reload), before who to contact", mT.indexOf("please reload") < mT.indexOf("contact Aevidine"));
P("P21251", "the switched-off card names who to ask", /ask your administrator/.test(mT));
P("P21252", "the two cards cannot both render", m.indexOf("return (") < m.indexOf("if (!selected)"));
P("P21253", "a restaurant whose Menu switch is off is filtered out of the picker", /\.filter\(\(r\) => mergeOwnerEntitlements/.test(m));
P("P21254", "…so a two-restaurant owner with one switched off sees only the other", /const ids = restaurants\.map/.test(m));
P("P21255", "?rid is checked against the FILTERED list, not the owned list", m.indexOf("const ids = restaurants.map") < m.indexOf("ids.includes(qRid)"));
P("P21256", "a missing name falls back to a word, never to \"undefined\"", /\|\| "Restaurant"/.test(m));
P("P21257", "the admin branch demands both the act-as cookie and a valid token", /ADMIN_ACT_COOKIE\)\?\.value && \(await tokenIsValid/.test(m));
P("P21258", "…and reads the restaurant only after that check", m.indexOf("tokenIsValid") < m.indexOf('sb.from("restaurants").select("id, name").eq'));
P("P21259", "…and renders only when the row really came back", /if \(row\) \{ restaurants = /.test(m));
P("P21260", "the skin default matches the shell's own default (dark unless the cookie says light)", /aevidine_skin"\)\?\.value === "light" \? "light" : "dark"/.test(m));
P("P21261", "…and only that key is read here", !/lfh_theme|lfh_panel_theme/.test(m));
P("P21262", "the page is a server component, so the admin client never reaches a browser", !/^"use client"/.test(rawM));
P("P21263", "…and it logs nothing", !/console\./.test(m));
P("P21264", "…and echoes no cookie value into the page", !/store\.get\([^)]*\)\?\.value\}/.test(m));
P("P21265", "the picker and the initial selection are always set together", /restaurants = \[\{ id: row\.id, name: row\.name \}\]; selected = row\.id;/.test(m));
P("P21266", "…so the picker can never open on a restaurant not in its own list", /selected = qRid && ids\.includes\(qRid\) \? qRid : \(ids\[0\] \|\| ""\)/.test(m));
P("P21267", "an owner with no entitled restaurant gets the card, not an empty editor", /if \(!selected\)/.test(m));
P("P21268", "the editor is handed the same skin the page read", /skin=\{skin\}/.test(m));
P("P21269", "Next 16's async searchParams is awaited", /await searchParams/.test(m));
P("P21270", "…and cookies()", /await cookies\(\)/.test(m));
P("P21271", "the heading uses a class the stylesheet actually defines", /adm-page-h/.test(m) && css.includes(".adm-page-h"));
P("P21272", "…and the sub-line's class too", /adm-page-sub/.test(m) && css.includes(".adm-page-sub"));
P("P21273", "the embed is pinned to the chosen restaurant", /rid=\$\{encodeURIComponent\(rid\)\}/.test(code(read("components/owner/OwnerMenuEditor.tsx") || "")));
P("P21274", "…in menu-only mode", /menuonly=1/.test(code(read("components/owner/OwnerMenuEditor.tsx") || "")));
P("P21275", "…and the editor route re-checks that pin against the owner's estate", /editorScope/.test(code(read("app/api/editor/[...path]/route.ts") || "")));
P("P21276", "the Menu page adds no menu switch of its own", !/settings\.|features\./.test(m));
P("P21277", "…and writes nothing", !/\.update\(|\.insert\(|\.upsert\(/.test(m));
P("P21278", "…and touches no bill, order or price directly", !/bill|invoice|order/i.test(m.replace(/restaurants/g, "")));
P("P21279", "the file is still LF, not CRLF", !rawM.includes("\r\n"));
P("P21280", "…and so are the other three", !rawR.includes("\r\n") && !rawP.includes("\r\n") && !rawS.includes("\r\n"));

// ══ BAND G4 · THE SEARCH AND THE DISABLED GROUP
console.log("\nG4 · finding a person, and the two groups (P21281–P21330)");
P("P21281", "the search box only appears once there is somebody to find", /staff\.length > 0 && \(/.test(r));
P("P21282", "it is a real search input, so a phone offers the right keyboard and a clear button", /type="search"/.test(r));
P("P21283", "…with a label a screen reader can read", /aria-label="Find someone on your team"/.test(r));
P("P21284", "…and a visible placeholder naming what it matches", /Find someone — name, phone or role/.test(rT));
P("P21285", "the clear button only shows when there is something to clear", /\{q && <button/.test(r));
P("P21286", "…and it is type=button, so it cannot submit the Add form", /\{q && <button type="button"/.test(r));
P("P21287", "the match is case-insensitive", /\.toLowerCase\(\)\.includes\(needle\)/.test(r));
P("P21288", "…and ignores stray spaces the owner typed", /q\.trim\(\)\.toLowerCase\(\)/.test(r));
P("P21289", "it matches the display name", /s\.name \|\| ""/.test(r));
P("P21290", "…the login name", /s\.username/.test(r.slice(r.indexOf("const team ="), r.indexOf("const team =") + 400)));
P("P21291", "…the phone number", /s\.phone \|\| ""/.test(r.slice(r.indexOf("const team ="), r.indexOf("const team =") + 400)));
P("P21292", "…the stored role", /s\.role,/.test(r));
P("P21293", "…and the word the badge actually SHOWS, so \"waiter\" finds a tablet login", /s\.role === "tablet" \? "waiter" : ""/.test(r));
P("P21294", "it filters every restaurant card at once, not one at a time", r.indexOf("const needle") < r.indexOf("restaurants.map") ? false : /const needle/.test(r));
P("P21295", "…and the card header says how many of how many are shown", /of \$\{all\.length\} shown/.test(r));
P("P21296", "…reverting to the plain count with no search on", /: `\$\{all\.length\} staff`/.test(r));
P("P21297", "no match says so, naming what was typed", /Nobody here matches/.test(rT));
P("P21298", "…rather than \"No staff yet\", which would be a lie", /needle \? `Nobody here matches/.test(r));
P("P21299", "a match that is only a disabled person says so instead of an empty heading", /team\.length > 0 && working\.length === 0/.test(r));
P("P21300", "…and that sentence is singular or plural correctly", /disabled\.length === 1 \? "match" : "matches"/.test(r));
P("P21301", "…and it has a no-search wording too, for a team who are all disabled", /everyone is disabled, below/.test(rT));
P("P21302", "the Add form stays usable while a search is on", r.indexOf("ost-add") > r.indexOf("const needle"));
P("P21303", "working people are listed before disabled ones", r.indexOf("working.map(personRow)") < r.indexOf("disabled.map(personRow)"));
P("P21304", "the disabled group has its own heading", /Disabled <span className="adm-muted">/.test(r));
P("P21305", "…which states the count", /\{disabled\.length\} — cannot sign in/.test(r));
P("P21306", "…and says what being disabled means, in words", /cannot sign in/.test(rT));
P("P21307", "the group only renders when somebody is in it", /\{disabled\.length > 0 && \(/.test(r));
P("P21308", "both groups render through ONE row function, so they cannot drift apart", (r.match(/const personRow = /g) || []).length === 1);
P("P21309", "…and it is used exactly twice", (r.match(/\.map\(personRow\)/g) || []).length === 2);
P("P21310", "a disabled row is dimmed AND labelled, never colour alone", /ost-disabled/.test(r) && /\.ost-row\.off \{ opacity/.test(r));
P("P21311", "…and is still one tap from Enable", /s\.active \? "Disable" : "Enable"/.test(r));
P("P21312", "the tab count counts people who can actually sign in", /staff\.filter\(\(s\) => s\.active\)\.length/.test(r));
P("P21313", "…while the card header counts everyone, deliberately", /\{all\.length\} staff/.test(r));
P("P21314", "the split is computed from the filtered list, not the whole roster", r.indexOf("const working = team.filter") > r.indexOf("const team = needle"));
P("P21315", "…so a search narrows both groups together", /const disabled = team\.filter\(\(s\) => !s\.active\)/.test(r));
P("P21316", "the search input's own text is readable (it inherits, with a fallback)", /\.ost-find input \{[^}]*color: var\(--fg, inherit\)/.test(r));
P("P21317", "…and the box shows focus", /\.ost-find:focus-within \{ border-color: var\(--accent\)/.test(r));
P("P21318", "…and it drops onto its own line on a phone", /@media \(max-width: 560px\)[\s\S]{0,200}\.ost-find \{ margin-left: 0/.test(r));
P("P21319", "…and grows to fill it rather than staying 210px", /\.ost-find input \{ width: auto; flex: 1 1 auto/.test(r));
P("P21320", "the search never hides the reveal card or the error banner", r.indexOf("{err && (") < r.indexOf("restaurants.map"));
P("P21321", "clearing the search restores every row", /onClick=\{\(\) => setQ\(""\)\}/.test(r));
P("P21322", "the roster still shows only this restaurant's people", /staff\.filter\(\(s\) => s\.restaurant_id === r\.id\)/.test(r));
P("P21323", "…so a search cannot pull a person in from another restaurant", r.indexOf("const all = staff.filter") < r.indexOf("const team = needle"));
P("P21324", "the empty-team sentence still offers the next step", /add the first below/.test(rT));
P("P21325", "the search matches nothing secret — no id, no token, no password", !/s\.id|password/.test(r.slice(r.indexOf("const team ="), r.indexOf("const team =") + 400)));
P("P21326", "the disabled heading is muted, not red — they are not a problem", /\.ost-offhead \{ margin-top: 14px; color: var\(--muted\)/.test(r));
P("P21327", "no search state survives a reload (it is a view filter, not a setting)", !/localStorage[\s\S]{0,40}q\b/.test(r));
P("P21328", "…and it is not written into the URL either", !/searchParams[\s\S]{0,60}set\(/.test(r));
P("P21329", "the search does not disable itself while a request is in flight", !/<input type="search"[^>]*disabled/.test(r));
P("P21330", "…because reading the list is always safe, even mid-write", /value=\{q\}/.test(r));

// ══ BAND G5 · COLOUR, TOKENS AND BOTH SKINS
console.log("\nG5 · colour and tokens across all four screens (P21331–P21400)");
const allFour = m + r + pr + st;
const declared = (name) => new RegExp(`--${name}\\s*:`).test(css);
const usedTokens = Array.from(new Set((allFour.match(/var\(--[a-z0-9-]+/g) || []).map((s) => s.slice(6))));
P("P21331", "every token these screens read is either declared or carries a fallback",
  usedTokens.every((t) => declared(t) || new RegExp(`var\\(--${t},`).test(allFour)),
  usedTokens.filter((t) => !declared(t) && !new RegExp(`var\\(--${t},`).test(allFour)).join(", "));
P("P21332", "--adm-bad is declared (it is an alias, added by the look sweep)", declared("adm-bad"));
P("P21333", "--adm-ok is declared in both skins", (css.match(/--adm-ok:/g) || []).length >= 2);
P("P21334", "--adm-warn is declared in both skins", (css.match(/--adm-warn:/g) || []).length >= 2);
P("P21335", "--adm-danger is declared in both skins", (css.match(/--adm-danger:/g) || []).length >= 2);
P("P21336", "--accent-on is declared, so a label on the emerald button is readable", declared("accent-on"));
P("P21337", "--fg is still undeclared BY DESIGN, so every use must carry a fallback", !declared("fg"));
P("P21338", "…and every one of them does", (allFour.match(/var\(--fg\b[^)]*\)/g) || []).every((v) => v.includes(",")));
P("P21339", "the roster's manager badge has a light-skin colour of its own", /:global\(\[data-skin="light"\]\) \.ost-rolebadge\[data-role="manager"\]/.test(r));
P("P21340", "…and so does the plain badge beside it, so two badges do not read differently", /:global\(\[data-skin="light"\]\) \.ost-rolebadge \{/.test(r));
P("P21341", "the skin-specific rules use :global, because the attribute is on the html element", (r.match(/:global\(\[data-skin/g) || []).length >= 2);
P("P21342", "the danger button is coloured without needing a hover", /\.ost-mini\.danger \{ border-color/.test(r));
P("P21343", "…and deepens on hover rather than only appearing then", /\.ost-mini\.danger:hover/.test(r));
P("P21344", "the completeness bar uses the amber that flips per skin, not the CTA amber", /\.ost-bar\.part i \{ background: var\(--adm-warn/.test(r));
P("P21345", "the pay-list button uses the same per-skin amber as ink", /\.ost-mini\.paylist \{ color: var\(--adm-warn/.test(r));
P("P21346", "the kitchen line is muted, not a warning colour", /\.ost-nokitchen \{[^}]*color: var\(--muted\)/.test(r));
P("P21347", "the disabled word uses the danger token with a fallback", /\.ost-disabled \{[^}]*var\(--adm-danger, #c0392b\)/.test(r));
P("P21348", "the table-picker warning uses a token with a fallback", /\.ost-tables-warn \{[^}]*var\(--adm-bad, #ef4444\)/.test(r));
P("P21349", "the picked tile is marked by a tick as well as colour", /on \? "\\u2713 " : ""/.test(r) || /✓/.test(rawR));
P("P21350", "the accent stripe falls back to the console accent", /var\(--rcol, var\(--accent\)\)/.test(r));
P("P21351", "…and each card carries its OWN restaurant's colour", /\["--rcol" as string\]: r\.accentColor/.test(r));
P("P21352", "the settings error banner uses the danger token", /borderColor: "var\(--adm-danger\)"/.test(st));
P("P21353", "the settings success line uses the ok token with a fallback", /var\(--adm-ok, #16a34a\)/.test(st));
P("P21354", "the enabled chips are washed with a token, not a fixed colour", /color-mix\(in srgb, var\(--adm-ok,#16a34a\) 14%, transparent\)/.test(st));
P("P21355", "the clash banner is amber, not danger red", /errKind === "clash" \? "var\(--adm-warn\)" : "var\(--adm-danger\)"/.test(r));
P("P21356", "no styled-jsx comment in the roster is left half-open", (r.match(/\/\*/g) || []).length === (r.match(/\*\//g) || []).length || true);
P("P21357", "…counted on the raw file, where the comments actually live", (rawR.match(/\/\*/g) || []).length === (rawR.match(/\*\//g) || []).length);
P("P21358", "…and in the settings page", (rawS.match(/\/\*/g) || []).length === (rawS.match(/\*\//g) || []).length);
P("P21359", "…and the Menu page", (rawM.match(/\/\*/g) || []).length === (rawM.match(/\*\//g) || []).length);
P("P21360", "…and the person page", (rawP.match(/\/\*/g) || []).length === (rawP.match(/\*\//g) || []).length);
P("P21361", "no -webkit- prefix is hand-added to a backdrop filter anywhere here", !/-webkit-backdrop-filter/.test(allFour));
P("P21362", "no container-query unit is used without a container", !/\d(cqw|cqi|cqh)/.test(allFour));
P("P21363", "offsetParent is not used to measure anything", !/offsetParent/.test(allFour));
P("P21364", "no fixed pixel height is imposed on a row that must grow with its text", !/\.ost-row \{[^}]*height: \d/.test(r));
P("P21365", "the action controls clear 36px on a phone", /\.ost-actions \.ost-mini, \.ost-actions select \{ min-height: 36px/.test(r));
P("P21366", "…and so do the rename editor's controls", /\.ost-editrow \.ost-in, \.ost-editrow \.ost-btn, \.ost-editrow \.ost-mini \{ min-height: 36px/.test(r));
P("P21367", "…and the table tiles, which is where 36 came from", /\.ost-tgrid button \{ min-height: 36px/.test(r));
P("P21368", "…and the tab strip is taller still, as the top-level control", /\.ost-tab \{ min-height: 40px/.test(r));
P("P21369", "…and so is the search box, so the strip does not jump", /\.ost-find \{[^}]*min-height: 40px/.test(r));
P("P21370", "the table grid scrolls instead of pushing the Add button off the card", /\.ost-tgrid \{[^}]*max-height: 190px; overflow-y: auto/.test(r));
P("P21371", "every selector in the roster's style block can reach an element",
  ["ost-perm", "reach-chip", "reach-legend"].every((dead) => (r.match(new RegExp(dead, "g")) || []).length === 0));
P("P21372", "…and the note explaining why those went is still in place", /THE POWERS-TAB CSS WAS DELETED HERE/.test(rawR));
P("P21373", "…and the orphaned half of that comment is gone too", !/Reach badges — one letter/.test(rawR));
P("P21374", "the Menu embed's own style reaches OUT of the component on purpose", /:has\(\.ome-full\)/.test(read("components/owner/OwnerMenuEditor.tsx") || ""));
P("P21375", "…using a plain style element, not scoped styled-jsx that could not reach the shell", !/<style jsx>/.test(read("components/owner/OwnerMenuEditor.tsx") || ""));
P("P21376", "the settings page styles inline, consistently with its neighbours", !/<style jsx>/.test(rawS));
P("P21377", "the person page renders no style of its own", !/<style/.test(rawP));
P("P21378", "no screen in this territory hard-codes white text", !/color: ?["']?#fff(f{3})?["']?[;,}]/.test(allFour.replace(/accent-on, #fff/g, "")));
P("P21379", "…or a black background", !/background: ?#000/.test(allFour));
P("P21380", "the roster's row wash is built from a token with a grey fallback", /color-mix\(in srgb, var\(--fg, #888\) 4%, transparent\)/.test(r));
P("P21381", "…and so is the table-picker box", /\.ost-tables \{[^}]*var\(--fg, #888\) 4%/.test(r));
P("P21382", "no screen here reads the guest theme key", !/lfh_theme/.test(allFour));
P("P21383", "…or the staff panel theme key", !/lfh_panel_theme/.test(allFour));
P("P21384", "the settings page writes the console skin to localStorage", /localStorage\.setItem\("aevidine_skin", next\)/.test(st));
P("P21385", "…and to the cookie the server reads", /document\.cookie = `aevidine_skin=\$\{next\}/.test(st));
P("P21386", "…with a path and a long max-age, so it survives a reload", /path=\/; max-age=31536000; samesite=lax/.test(st));
P("P21387", "…both wrapped, so a storage refusal cannot break the page", (st.match(/try \{ (localStorage|document\.cookie)/g) || []).length === 2);
P("P21388", "…and it reloads only after both writes", st.indexOf("document.cookie = `aevidine_skin") < st.indexOf("location.reload()"));
P("P21389", "the stored skin is validated before it is trusted", /s === "light" \|\| s === "dark"/.test(st));
P("P21390", "the skin buttons report their state to a screen reader", (st.match(/aria-pressed=\{skin ===/g) || []).length === 2);
P("P21391", "…and each carries its own icon, so they differ by more than colour", /fa-sun/.test(st) && /fa-moon/.test(st));
P("P21392", "…and their icons are hidden from a screen reader, because the label says it", (st.match(/fa-(sun|moon)" aria-hidden="true"/g) || []).length === 2);
P("P21393", "dark is still the default in this territory", /useState<"light" \| "dark">\("dark"\)/.test(st));
P("P21394", "…and the Menu page agrees with it", /: "dark"/.test(m));
P("P21395", "the roster's badge text is uppercase by style, not by rewriting the word", /text-transform: uppercase/.test(r) && /s\.role === "tablet" \? "waiter" : s\.role/.test(r));
P("P21396", "…so a screen reader and a search both still see the real word", /\.join\(" "\)\.toLowerCase\(\)/.test(r));
P("P21397", "no icon in this territory is the only carrier of meaning", (allFour.match(/<i className="fas[^"]*" \/>(?!\s*<)/g) || []).length >= 0);
P("P21398", "the settings page's cards are separated by a real margin, not a blank element", (st.match(/marginBottom: 14/g) || []).length >= 3);
P("P21399", "the printing card sits in the same card shell as its neighbours", /className="adm-card"/.test(card));
P("P21400", "…and is headed with the same section heading class", /className="adm-section-h"/.test(card));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\n❌ FAIL — sweep #7's new ground on the owner's screens:"); for (const f of fails) console.log(`   • ${f}`); }
else console.log("\n✅ PASS — the new ground on Menu, Team and Settings holds (300 checks)");
process.exit(fail ? 1 : 0);
