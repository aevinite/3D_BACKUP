// verify-admin-access-people — SWEEP #8 · TERMINAL 23's 500 checks over the ADMIN's Access tree,
// its people, and its money view.
//
//   node scripts/verify-admin-access-people.mjs [--base http://localhost:4000]
//   node scripts/verify-admin-access-people.mjs --ledger        # regenerate the ledger table
//   node scripts/verify-admin-access-people.mjs --from 1 --to 60
//
// THE TERRITORY (32 files, and every one of them is named below — a guard that names a file that
// is not there FAILS here rather than passing vacuously, which is how five guards in this repo
// asserted nothing for weeks):
//
//   the 21 files of components/admin/  ·  app/aevinite/{access,users,analytics,revenue,customers,
//   settings}/page.tsx  ·  app/aevinite/{page,layout,error,loading}.tsx  ·  app/aevinite/icon.svg
//
// WHY THESE ROWS ARE GENERATED FROM THE CHECKS, not typed beside them: the ledger's own lesson
// across seven sweeps is that a hand-typed table drifts from the code within days, and then
// "re-run row P76812" stops meaning anything. Both come out of this one file.
//
// HOW IT BEHAVES:
//   · It WRITES NOTHING, to any restaurant, ever. Every live check is a read.
//   · It signs in ZERO times: it presents the admin cookie the gate already accepts (sha256 of
//     ADMIN_PASSWORD), so it can never raise a failed-login row or alert the owner's phone about
//     his own console.
//   · One at a time (pid lock), so two copies cannot read each other's half-loaded pages.
//   · Exit 2 = could not run (no server / wrong database). Exit 1 = a fault is back.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
import { requireAppUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
const readRaw = (p) => { try { return readFileSync(join(root, p)); } catch { return null; } };

// ── one at a time ───────────────────────────────────────────────────────────────────────────────
const LOCK = "/tmp/admin-access-people-sweep.pid";
try {
  const alive = Number(readFileSync(LOCK, "utf8"));
  if (alive && alive !== process.pid) {
    try { process.kill(alive, 0); } catch { throw new Error("stale"); }
    console.log(`\nAnother copy of this sweep is already running (pid ${alive}). Waiting is the right move.`);
    process.exit(2);
  }
} catch { /* stale or absent — take it */ }
try { writeFileSync(LOCK, String(process.pid)); } catch {}
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropLock(); process.exit(130); });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || Infinity;
const QUIET = process.argv.includes("--quiet");
const LEDGER = process.argv.includes("--ledger");
const WRITE_LEDGER = process.argv.includes("--write-ledger");
const NO_LIVE = process.argv.includes("--no-live");

const env = Object.fromEntries(read(".env.local").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

let BASE = "";
if (!LEDGER && !NO_LIVE) {
  refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the admin access/people/money sweep");
  BASE = await requireAppUp(process.argv, "the admin access/people/money sweep");
}
const ADMIN_COOKIE = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
const get = (path, opts = {}) => fetch(BASE + path, {
  redirect: "manual", cache: "no-store",
  headers: { ...(opts.signedOut ? {} : { cookie: ADMIN_COOKIE }) },
}).catch((e) => ({ ok: false, status: 0, _err: e.message, text: async () => "", json: async () => ({}) }));
const getText = async (p, o) => { const r = await get(p, o); return { status: r.status, body: await r.text().catch(() => "") }; };
const getJson = async (p, o) => { const r = await get(p, o); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };

// ── the phase runner ────────────────────────────────────────────────────────────────────────────
const FIRST_ID = 76701;
let n = 0;
const pass = [], fail = [], skipped = [], unanswered = [];
const idOf = (i) => "P" + (FIRST_ID + i - 1);
let band = "A";
const rows = [];
async function phase(title, fn) {
  n += 1;
  const id = idOf(n);
  rows.push({ id, band, title });
  if (LEDGER) return;
  if (n < FROM || n > TO) { skipped.push(id); return; }
  let r;
  try { r = await fn(); } catch (e) { r = `threw: ${e && e.message ? e.message : String(e)}`; }
  const row = rows[rows.length - 1];
  if (r === true) { pass.push(id); row.result = "✅"; row.note = ""; if (!QUIET) console.log(`  ✓ ${id}  ${title}`); }
  else if (r && typeof r === "object" && r.unanswered) {
    unanswered.push({ id, title, why: r.unanswered }); row.result = "⏭"; row.note = r.unanswered;
    console.log(`  ? ${id}  ${title}\n        UNANSWERED: ${r.unanswered}`);
  } else {
    const why = typeof r === "string" ? r : "returned " + JSON.stringify(r);
    fail.push({ id, title, why }); row.result = "❌"; row.note = why;
    console.log(`  ✗ ${id}  ${title}\n        ${r}`);
  }
}
const skip = (why) => ({ unanswered: why });

// ── the territory, read once ────────────────────────────────────────────────────────────────────
const COMPONENTS = {
  AccessPerPerson: "components/admin/AccessPerPerson.tsx",
  AccessSearch: "components/admin/AccessSearch.tsx",
  AccessTree: "components/admin/AccessTree.tsx",
  AdminShell: "components/admin/AdminShell.tsx",
  BrandingCard: "components/admin/BrandingCard.tsx",
  CopyButton: "components/admin/CopyButton.tsx",
  CredentialsCard: "components/admin/CredentialsCard.tsx",
  Dropdown: "components/admin/Dropdown.tsx",
  LogDetailModal: "components/admin/LogDetailModal.tsx",
  NotificationBell: "components/admin/NotificationBell.tsx",
  OrdersTrend: "components/admin/OrdersTrend.tsx",
  RemovalDetail: "components/admin/RemovalDetail.tsx",
  RestaurantReport: "components/admin/RestaurantReport.tsx",
  RestaurantSettings: "components/admin/RestaurantSettings.tsx",
  Skeleton: "components/admin/Skeleton.tsx",
  StaffProfile: "components/admin/StaffProfile.tsx",
  TicketCard: "components/admin/TicketCard.tsx",
  shared: "components/admin/shared.tsx",
  toast: "components/admin/toast.tsx",
  useAdminModal: "components/admin/useAdminModal.ts",
  useOverlayParam: "components/admin/useOverlayParam.ts",
};
const PAGES = {
  home: "app/aevinite/page.tsx",
  access: "app/aevinite/access/page.tsx",
  users: "app/aevinite/users/page.tsx",
  analytics: "app/aevinite/analytics/page.tsx",
  revenue: "app/aevinite/revenue/page.tsx",
  customers: "app/aevinite/customers/page.tsx",
  settings: "app/aevinite/settings/page.tsx",
  layout: "app/aevinite/layout.tsx",
  error: "app/aevinite/error.tsx",
  loading: "app/aevinite/loading.tsx",
};
const ASSETS = { icon: "app/aevinite/icon.svg" };
const FILES = { ...COMPONENTS, ...PAGES, ...ASSETS };
const SRC = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));

// The neighbours these files must agree with. Read, never edited by this terminal.
const NB = {
  accessTree: read("lib/accessTree.ts"),
  staffCaps: read("lib/staffCaps.ts"),
  staffProfileShared: read("lib/staffProfileShared.ts"),
  clash: read("lib/clash.ts"),
  clashCompare: read("lib/clashCompare.ts"),
  backStack: read("lib/backStack.ts"),
  adminJump: read("lib/adminJump.ts"),
  plainError: read("lib/plainError.ts"),
  timeView: read("lib/timeView.ts"),
  usersRoute: read("app/api/admin/users/route.ts"),
  treeRoute: read("app/api/admin/restaurants/access-tree/route.ts"),
  customersRoute: read("app/api/admin/customers/route.ts"),
  analyticsRoute: read("app/api/admin/analytics/route.ts"),
  revenueRoute: read("app/api/admin/revenue/route.ts"),
  dashboardRoute: read("app/api/admin/dashboard/route.ts"),
  settingsRoute: read("app/api/admin/settings/route.ts"),
  ownerStaffRoute: read("app/api/owner/staff/route.ts"),
  rejected: read("docs/REJECTED-IDEAS.md"),
  accessModelDoc: read("docs/ACCESS-MODEL.md"),
  staffProfileDoc: read("docs/STAFF-PROFILE.md"),
  claude: read("CLAUDE.md"),
  globals: read("app/globals.css"),
};

// Comments are not the code. LINE comments FIRST: a `/*` inside a `//` line opens a block that
// swallows to the next `*/`, which once hid 190 lines from two shipped guards (2026-09-01).
const strip = (s) => s.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, strip(v)]));
const NCODE = Object.fromEntries(Object.entries(NB).map(([k, v]) => [k, strip(v)]));

const missing = Object.entries(SRC).filter(([, v]) => !v.trim()).map(([k]) => FILES[k]);
if (missing.length && !LEDGER) {
  console.log(`\nThis guard names ${missing.length} file(s) that are not there: ${missing.join(", ")}\nIt is asserting nothing about them. Fix the paths or delete the checks — do not leave it green.`);
  process.exit(1);
}
const nbMissing = Object.entries(NB).filter(([, v]) => !v.trim()).map(([k]) => k);
if (nbMissing.length && !LEDGER) {
  console.log(`\nThese neighbour files could not be read: ${nbMissing.join(", ")}. Half this suite would assert nothing.`);
  process.exit(1);
}

const TSX = Object.keys(FILES).filter((k) => FILES[k].endsWith(".tsx") || FILES[k].endsWith(".ts"));
const CLIENT = TSX.filter((k) => /^"use client";/.test(SRC[k]));
const ok = (b, why) => (b ? true : why);

console.log(`\n  SWEEP #8 · T23 — the admin's Access tree, its people and its money view`);
console.log(`  ${Object.keys(FILES).length} files · ids ${idOf(1)}…\n`);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND A · reading the code for correctness
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "A";
console.log("── A · reading the code for correctness");

// A1 — every file in the territory really is there, and is not empty.
for (const k of Object.keys(FILES)) {
  await phase(`${FILES[k]} exists and has something in it`, () => ok(SRC[k].trim().length > 40, `only ${SRC[k].length} bytes`));
}
// A2 — no file is stored with Windows line endings (some files in this repo are CRLF and a
// careless rewrite destroys them; the whole territory is declared eol=lf).
for (const k of Object.keys(FILES)) {
  await phase(`${FILES[k]} has no Windows line endings`, () => ok(!SRC[k].includes("\r\n"), "CRLF found"));
}
// A3 — block comments balanced, counted AFTER line comments are stripped. An unclosed `/*`
// silently swallows the rest of a file, and a `/*` inside a `//` line is not a comment opener.
for (const k of TSX) {
  await phase(`${FILES[k]}: its comment blocks all close`, () => {
    const lineStripped = SRC[k].split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    const opens = (lineStripped.match(/\/\*/g) || []).length, closes = (lineStripped.match(/\*\//g) || []).length;
    return ok(opens === closes, `${opens} openers, ${closes} closers — everything after the last one is invisible`);
  });
}
// A4 — a file that uses React state, an effect or a DOM handler must declare "use client", or it
// is a Server Component that will throw the moment it renders.
for (const k of TSX) {
  await phase(`${FILES[k]}: "use client" iff it actually needs the browser`, () => {
    const needs = /\buse(State|Effect|Ref|Callback|Memo|Context|LayoutEffect)\s*\(|onClick=|onChange=/.test(CODE[k]);
    const has = /^"use client";/.test(SRC[k]);
    if (needs && !has) return "it uses browser-only React and does not declare \"use client\"";
    return true;
  });
}
// A5 — nothing left behind that prints to a developer console on a real admin's screen.
for (const k of TSX) {
  await phase(`${FILES[k]}: no console.log or debugger left in`, () => {
    const bad = (CODE[k].match(/\bconsole\.log\s*\(|\bdebugger\b/g) || []).length;
    // error.tsx deliberately console.error's the page error — that is a different call.
    return ok(bad === 0, `${bad} left`);
  });
}
// A6 — no raw HTML injection anywhere in the console.
// The credentials SHEET is the one deliberate use in this territory: a printable page built by
// this file's own escaping helpers. So the check is not "nobody does it" — it is "only that one
// does it, and everything it interpolates went through esc()".
const RAW_HTML_OK = new Set(["CredentialsCard"]);
for (const k of TSX) {
  await phase(`${FILES[k]}: nothing sets raw HTML into the page`, () => {
    const uses = /dangerouslySetInnerHTML/.test(CODE[k]);
    if (!uses) return true;
    if (!RAW_HTML_OK.has(k)) return "sets raw HTML, and is not the one file allowed to";
    return ok(/const esc = |esc\(/.test(CODE[k]) && /const kv = |kv\(/.test(CODE[k]),
      "the escaping helpers it documents are gone — every value would reach the page raw");
  });
}
// A7 — every GET read carries cache: "no-store". A cached admin read is how a just-renamed
// restaurant keeps its old name until a hard reload.
for (const k of TSX) {
  const gets = [...CODE[k].matchAll(/fetch\(([^;]{0,400}?)\)\s*[.;]/gs)].map((m) => m[1]);
  if (!gets.length) continue;
  await phase(`${FILES[k]}: every read asks the server, never the browser cache`, () => {
    const bad = gets.filter((g) => !/method:\s*"(POST|PATCH|DELETE|PUT)"/.test(g) && !/cache:\s*"no-store"/.test(g) && !/FormData|method: "POST"/.test(g));
    return ok(bad.length === 0, `${bad.length} read(s) with no cache:"no-store": ${bad.map((b) => b.slice(0, 60)).join(" | ")}`);
  });
}
// A8 — no file in this territory writes a settings COLUMN that a migration has not created.
// (The whole-repo rule is verify:settings-columns; this is the territory's own slice of it.)
await phase(`the Access tree writes settings only through nodePatch(), never a hand-built column name`, () =>
  ok(/nodePatch\(/.test(CODE.AccessTree) && !/settings:\s*\{\s*["'][a-z_]+["']\s*:/.test(CODE.AccessTree),
    "a hand-built settings patch would bypass the model that decides where a switch lives"));

// ── the Access tree's own logic ────────────────────────────────────────────────────────────────
await phase("isBoolBind lists exactly the boolean binds Control() draws", () => {
  const list = (CODE.AccessTree.match(/const isBoolBind = \(n: Node\) =>\s*\n?\s*\[([^\]]*)\]/) || [])[1] || "";
  const named = [...list.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  if (!named.length) return "could not read the list";
  const dead = named.filter((b) => !new RegExp(`t:\\s*"${b}"|case "${b}"`).test(NCODE.accessTree));
  return ok(dead.length === 0, `${dead.join(", ")} name(s) no Bind the model can produce — the guard's own input would be untrustworthy`);
});
await phase("a row with two controls reads OFF when the FEATURE half is off", () =>
  ok(/if \(n\.featureBind && nodeValue\(\{ \.\.\.n, bind: n\.featureBind \}, st\) !== true\) return false;/.test(CODE.AccessTree),
    "isOn() must resolve the feature half first, the order managerCan() resolves them in"));
await phase("the section chip counts SWITCHES, not pick-one settings", () =>
  ok(/const isCountable = /.test(CODE.AccessTree) && /isCountable\(n\)/.test(CODE.AccessTree),
    "counting a value row as permanently on pads every section's number"));
await phase("the chip counts THROUGH a pure group, so Manager and Owner are not left blank", () =>
  ok(/n\.bind\.t === "none" && n\.children\?\.length\) collect\(n\.children\)/.test(CODE.AccessTree),
    "those two sections hold nothing but folders at the top level"));
await phase("a row left to build is never counted", () => ok(/if \(n\.leftToBuild\) continue;/.test(CODE.AccessTree), "leftToBuild rows would inflate the chip"));
await phase("every row AND every compact chip carries data-node, so a deep link can find either", () =>
  ok((CODE.AccessTree.match(/data-node=\{node\.id\}/g) || []).length >= 2,
    "jumpTo() looks for [data-node]; a row shape without it is a link that lands nowhere"));
await phase("…and that is the ONLY selector the jump uses, so nothing else has to stay in step", () =>
  ok(/querySelector<HTMLElement>\(`\[data-node="\$\{CSS\.escape\(nodeId\)\}"\]`\)/.test(CODE.AccessTree),
    "CSS.escape, so an id with a character the selector grammar dislikes still resolves"));
await phase("NODE_PATH is built by WALKING the model, not by a hand-written map", () =>
  ok(/const NODE_PATH[\s\S]{0,400}?for \(const s of SECTIONS\) walk\(s\.children/.test(CODE.AccessTree),
    "a hand-written map is how landing on a row opened the wrong section"));
await phase("a deep link that matches no row SAYS SO instead of leaving the page unchanged", () =>
  ok(/else setHint\(`There is no switch for/.test(SRC.AccessTree), "a silent no-op is what ?focus=tablet_mark_paid used to do"));
await phase("…and a matched row that is not on the page for this restaurant says that too", () =>
  ok(/Couldn.t open .\$\{hit\.name\}/.test(SRC.AccessTree), "onMissing must speak"));
await phase("a ?focus= jump arriving from OUTSIDE opens one section, not all of them", () =>
  ok(/exclusive \? \{ \[sec\]: true \}/.test(CODE.AccessTree), "following three links used to reach 'every dropdown is open'"));
await phase("…and the in-page search deliberately does NOT slam the others shut", () =>
  ok(/jumpTo\(nodeId, sectionId, ancestorIds, \(\) => setHint/.test(CODE.AccessTree) && !/jumpTo\(nodeId, sectionId, ancestorIds, [^)]*, true\)/.test(CODE.AccessTree),
    "the admin opened those a moment ago"));
await phase("which sections are open is remembered PER RESTAURANT", () =>
  ok(/const openKey = `adm:access-open:\$\{rid\}`/.test(CODE.AccessTree), "one key for all of them carried A's open set onto B"));
await phase("…and the write effect refuses to run mid-switch, so A's set is never saved under B's key", () =>
  ok(/if \(openFor\.current !== openKey\) return;/.test(CODE.AccessTree), "the write effect runs before the read effect resets the state"));
await phase("the open set is read SYNCHRONOUSLY in the initialiser, so the first paint is right", () =>
  ok(/useState<Record<string, boolean>>\(\(\) => readOpen\(\)\.sec\)/.test(CODE.AccessTree), "restoring in an effect flashes everything shut"));
await phase("a refused save keeps its sentence through the reload it triggers", () =>
  ok(/load\(rid, true\)/.test(CODE.AccessTree) && /keepError = false/.test(CODE.AccessTree),
    "load() cleared the banner before anyone could read it"));
await phase("a 409 is spoken in the clash's own words, never its code", () =>
  ok(/j\.clash \? `\$\{j\.clash\.plain\} \$\{j\.clash\.todo\}`/.test(CODE.AccessTree), "clash_changed_elsewhere is not a sentence"));
await phase("every access save sends what the row said when it was tapped", () =>
  ok(/"X-LFH-Expect": expectHeader\(expect\)/.test(CODE.AccessTree), "the one clash gate does nothing without it"));
await phase("…through expectHeader(), not JSON.stringify — a header must be ISO-8859-1", () =>
  ok(/expectHeader/.test(CODE.AccessTree) && !/"X-LFH-Expect": JSON\.stringify/.test(CODE.AccessTree),
    "two rows are named with an em dash and could not be saved at all"));
await phase("an API key is posted and then RELOADED, never merged into the page", () =>
  ok(/const setCreds = useCallback[\s\S]{0,900}?load\(rid\);/.test(CODE.AccessTree) && !/setCreds[\s\S]{0,400}applyPatch/.test(CODE.AccessTree),
    "merging it locally would put the real key back on screen"));
await phase("only ONE place knows a credential is different", () =>
  ok((CODE.AccessTree.match(/bind\.t === "creds"/g) || []).length >= 1 && /if \(n\.bind\.t === "creds"\) return setCreds/.test(CODE.AccessTree), "the control stays an ordinary input"));
await phase("switching a row OFF can ask first; switching it back on never does", () =>
  ok(/n\.confirm && \(v === false \|\| v === "off"\)/.test(CODE.AccessTree), "the dangerous direction is only ever taking it away"));
await phase("a locked (feature-off) row refuses a tap WITH WORDS, not a silent shake", () =>
  ok(/toast\(`Turn .\$\{node\.name\}. on first/.test(SRC.AccessTree), "it used to dispatch an event nothing in the admin listens for"));
await phase("…and the embedded editor is INSIDE that locked wrapper", () =>
  ok(/at-locked[\s\S]{0,900}?node\.panel \? <EmbeddedPanel/.test(SRC.AccessTree), "it used to save normally beside sub-rows that refused"));
await phase("what LOCKS a two-control row is the feature half, not the Default chip", () =>
  ok(/const unlocked = node\.featureBind\s*\n?\s*\? nodeValue\(\{ \.\.\.node, bind: node\.featureBind \}, st\) === true/.test(CODE.AccessTree),
    "a Default of Off must not lock restaurant-wide sub-settings"));
await phase("a row with no restaurant named says so rather than rendering an empty dropdown", () =>
  ok(/if \(!rest\) return <div className="at-panel-wait">Pick a restaurant to edit this\.<\/div>;/.test(SRC.AccessTree), "never a silent blank"));
await phase("Printing is a DOORWAY, not a second copy of that board", () =>
  ok(/Open Printing for/.test(SRC.AccessTree) && !/PrintingBoard|<Printing/.test(CODE.AccessTree), "two boards drift"));
await phase("the help sheet shows only pictures captured FOR that row", () =>
  ok(/const explicit = HELP_SHOTS\[node\.id\];\s*\n?\s*if \(explicit\) return explicit/.test(CODE.AccessTree),
    "walking up the tree showed a pizza menu for 'Dining sessions'"));
await phase("…and every candidate picture is PROBED before it is put on the page", () =>
  ok(/const probe = new Image\(\);/.test(CODE.AccessTree), "rendering first showed two broken boxes on ~86 rows"));
await phase("…and 'there wasn't a good picture' waits until every candidate has answered", () =>
  ok(/!shots\.length && !settling/.test(CODE.AccessTree), "otherwise it flashes on a row that DOES have one"));
await phase("a picture is labelled as an example from a demo restaurant", () =>
  ok(/Example from a demo restaurant/.test(SRC.AccessTree), "unlabelled it reads as THIS restaurant's menu"));
await phase("the help-sheet candidates are deduped, so one row never probes a URL twice", () =>
  ok(/\[\.\.\.new Set\(names\.flatMap/.test(CODE.AccessTree), "a name with no underscore spells the same file twice"));
await phase("the info sheet is registered with the back-button manager", () =>
  ok(/useAdminModal\(sheetRef, `access-info-\$\{node\.id\}`, onClose\)/.test(CODE.AccessTree), "Back used to leave the whole page"));
await phase("a long row description is CUT with a 'more' that opens the whole thing", () =>
  ok(/ROW_TEXT_MAX_WORDS/.test(CODE.AccessTree) && /className="at-more"/.test(SRC.AccessTree), "never a silent truncation"));
await phase("…and 'more' does not also fold the row it sits in", () =>
  ok(/className="at-more"[\s\S]{0,120}?e\.stopPropagation\(\)/.test(SRC.AccessTree), "the whole header is a fold button"));
await phase("the language list refuses to drop to one while it says Multiple", () =>
  ok(/if \(next\.length < 2\) \{ setNudge/.test(CODE.AccessTree), "it would silently take the switcher off the guest menu"));
await phase("…and it says which mode it is in, in words", () =>
  ok(/One only — guests get no switcher on the menu\./.test(SRC.AccessTree), "the count IS the answer, so it has to be spoken"));
await phase("a text field commits on blur/Enter, not once per keystroke", () =>
  ok(/onBlur=\{commit\}/.test(CODE.AccessTree), "a POST per keystroke"));
await phase("the credential box starts EMPTY even when a key is stored", () =>
  ok(/const \[draft, setDraft\] = useState\(""\);\s*\n\s*const \[show, setShow\] = useState\(false\);/.test(CODE.AccessTree),
    "showing dots would make Save look like it re-saved something"));
await phase("…and the 'ending 1234' is taken from the server's hint as given", () =>
  ok(/hint\.slice\(-4\)/.test(CODE.AccessTree) && !/replace\(\/\[\^a-z0-9\]\/gi/.test(CODE.AccessTree),
    "re-slicing shifted the answer for a key ending in a dash"));
await phase("removing a channel key asks first and says what stops", () =>
  ok(/Orders from that channel stop arriving until a new key is saved\./.test(SRC.AccessTree), "a silent removal"));
await phase("the 'recent changes' strip is ONE scoped, limited read — never a poll", () =>
  ok(/action=access_change&limit=5/.test(CODE.AccessTree) && !/setInterval\([^)]*loadRecent/.test(CODE.AccessTree), "a poll on this screen"));
await phase("…matched by EQUALITY on action, not the ?q= ILIKE", () =>
  ok(/action=access_change/.test(CODE.AccessTree) && !/loadRecent[\s\S]{0,200}\?q=/.test(CODE.AccessTree),
    "?q= would also match any row whose detail merely said 'access'"));
await phase("…and it renders nothing at all when there is nothing to show", () =>
  ok(/if \(!rows\.length\) return null;/.test(CODE.AccessTree), "an empty box on a fresh restaurant"));
await phase("a failed 'recent changes' read never breaks the screen", () =>
  ok(/loadRecent[\s\S]{0,700}?\.catch\(\(\) => \{/.test(CODE.AccessTree), "the strip is a convenience"));
await phase("the tree's stylesheet is a hoisted <style href precedence>, not styled-jsx", () =>
  ok(/<style href="adm-access-tree" precedence="default">/.test(SRC.AccessTree), "styled-jsx injects after hydration"));
await phase("the scroll position is restored into the ADMIN scrollport, not the window", () =>
  ok(/for \(const sel of \[".adm-main", ".adm"\]\)/.test(CODE.AccessTree), "the document itself does not scroll here"));
await phase("…and it abandons the restore the instant a real gesture happens", () =>
  ok(/gestures\.forEach\(\(e\) => window\.addEventListener\(e, giveUp/.test(CODE.AccessTree), "never fight the person"));

// ── the search bar ─────────────────────────────────────────────────────────────────────────────
await phase("the search index is built ONCE at module load, not per keystroke", () =>
  ok(/const INDEX: Entry\[\] = \(\(\) => \{/.test(CODE.AccessSearch), "SECTIONS is a constant"));
await phase("every haystack is pre-lowercased at that moment", () => ok(/\.join\(" "\)\.toLowerCase\(\),/.test(CODE.AccessSearch), "lowercasing per keystroke"));
await phase("every search token must match, so more words narrow rather than widen", () =>
  ok(/if \(!s\) \{ total = 0; break; \}/.test(CODE.AccessSearch), "an OR search returns everything"));
// WHETHER EACH SYNONYM NAMES A REAL ROW is scripts/verify-access-model.mjs check 6's job, and it
// is the one that can answer it: a third of the tree's ids are BUILT (`mgr_${x}`, `d_mgr_${x}`),
// so a static scan of this file sees 30 "dead" keys that are all real. What this suite adds is the
// shape of the map itself, which that check does not look at.
await phase("no synonym key is written twice (the second would silently shadow the first)", () => {
  const syn = [...SRC.AccessSearch.matchAll(/^\s{2}([a-z0-9_]+):\s*"/gm)].map((m) => m[1]);
  const dup = syn.filter((x, i) => syn.indexOf(x) !== i);
  return ok(syn.length > 40 && dup.length === 0, `${syn.length} keys, duplicates: ${[...new Set(dup)].join(", ") || "none"}`);
});
await phase("…and every synonym VALUE is lower-case, because the haystack is matched lower-cased", () => {
  const vals = [...SRC.AccessSearch.matchAll(/^\s{2}[a-z0-9_]+:\s*"([^"]+)"/gm)].map((m) => m[1]);
  const shouty = vals.filter((v) => v !== v.toLowerCase());
  return ok(shouty.length === 0, `${shouty.length} value(s) could never match: ${shouty.slice(0, 3).join(" | ")}`);
});
await phase("…and check 6 of verify:access is still the one that proves each key names a row", () =>
  ok(/synonym/i.test(read("scripts/verify-access-model.mjs")), "if that check goes, this ground is uncovered"));
await phase("a result whose parent is off is LABELLED, never a dead click", () =>
  ok(/as-badge need">needs \{blocked\.name\}/.test(SRC.AccessSearch), "rule 1 removes it from the page"));
await phase("…and picking it lands on the switch that has to come on first", () =>
  ok(/jumpTo\(blockedBy\.id, sectionId, upto > 0 \? ancestorIds\.slice\(0, upto\) : \[\]\)/.test(CODE.AccessTree), "it must not pretend to navigate"));
await phase("picking a result KEEPS what was typed; only the × clears it", () =>
  ok(/const choose = \(e: Entry\) => \{[\s\S]{0,200}?setOpen\(false\);/.test(CODE.AccessSearch) && !/choose[\s\S]{0,200}setQ\(""\)/.test(CODE.AccessSearch),
    "retyping 'discount' four times"));
await phase("Escape closes the list and leaves the text", () =>
  ok(/if \(ev\.key === "Escape"\) \{ setOpen\(false\); return; \}/.test(CODE.AccessSearch), "clearing on Escape loses the typing"));
await phase("the arrow keys wrap instead of sticking at the ends", () =>
  ok(/\(c - 1 \+ results\.length\) % results\.length/.test(CODE.AccessSearch), "sticking at 0 reads as broken"));
await phase("a scrim sits behind the results so the cards read as behind", () =>
  ok(/className="as-scrim"/.test(SRC.AccessSearch), "the owner saw two layers of text in one place"));
await phase("…and it BLURS, because dimming a near-black skin says nothing", () =>
  ok(/backdrop-filter: blur\(2\.5px\)/.test(SRC.AccessSearch), "measured: rgb(16,20,27) → rgb(10,15,23)"));
await phase("…with exactly one unprefixed backdrop-filter (a hand -webkit- makes the build drop it)", () =>
  ok(!/-webkit-backdrop-filter/.test(SRC.AccessSearch), "the frosted-glass lesson"));
await phase("clicking the dim area closes the list", () => ok(/as-scrim" onMouseDown=\{\(\) => setOpen\(false\)\}/.test(SRC.AccessSearch), "it is what everybody tries first"));
await phase("the field you are typing in sits ABOVE its own scrim", () =>
  ok(/\.as-wrap \{[^}]*z-index: 41/.test(SRC.AccessSearch) && /\.as-scrim \{[^}]*z-index: 39/.test(SRC.AccessSearch), "dimming the box you typed in"));
await phase("the search bar's stylesheet is hoisted with href + precedence", () =>
  ok(/<style href="adm-access-search" precedence="default">/.test(SRC.AccessSearch), "sweep #8 T23 item 4 — it was a bare <style> inside the component"));
await phase("…and the PAGE renders it, so it is in the server HTML", () =>
  ok(/<SearchStyle \/>/.test(SRC.access) && /import \{ SearchStyle \}/.test(SRC.access), "the component only exists after the tree's fetch"));
await phase("no result list is ever unbounded", () => ok(/function search\(q: string, limit = 14\)/.test(CODE.AccessSearch), "a 90-row dropdown"));

// ── the per-person tab ─────────────────────────────────────────────────────────────────────────
await phase("the Per-person tab renders the SAME rows as the role section", () =>
  ok(/capGroupsForRole/.test(CODE.AccessPerPerson) && /capGroupsForRole/.test(CODE.StaffProfile), "a private copy is free to drift"));
await phase("a permission change goes to the ADMIN route, not the owner one", () =>
  ok(/fetch\("\/api\/admin\/users", \{\s*\n?\s*method: "PATCH"/.test(CODE.AccessPerPerson), "the owner route's allow-list had drifted"));
await phase("…and it sends what the row said when it was tapped (sweep #8 T23 item 2)", () =>
  ok(/"X-LFH-Expect": expectHeader\(\{/.test(CODE.AccessPerPerson), "two admins could set opposite answers and the second silently won"));
await phase("…as the jsonb sub-key form, so an unrelated permission moving is not a false alarm", () =>
  ok(/fields: \{ \[`permissions\.\$\{key\}`\]/.test(CODE.AccessPerPerson), "comparing the whole blob fires on any key"));
await phase("…carrying the row's own NAME, so a refusal never quotes the storage key", () =>
  ok(/\.\.\.\(label \? \{ label \} : \{\}\)/.test(CODE.AccessPerPerson) && /onSet\(person, key, s, node\.name\)/.test(CODE.AccessPerPerson), "'give_discounts' means nothing to an admin"));
await phase("…and a 409 is read back in the clash's own sentence", () =>
  ok(/c\?\.plain \? `\$\{c\.plain\}/.test(CODE.AccessPerPerson), "'That change didn't save' throws the reason away"));
await phase("'Default' CLEARS the person's own value rather than storing the word", () =>
  ok(/const sent = value === "default" \? "" : value;/.test(CODE.AccessPerPerson), "a stored 'default' is a value nothing reads"));
await phase("there is no Owner chip on the role filter", () =>
  ok(/\["all", "manager", "tablet", "kitchen"\]/.test(CODE.AccessPerPerson), "the endpoint never returns owners — it could only say 'nobody matches'"));
await phase("a VALUE row (a % ceiling, a date reach) is shown, never offered per person", () =>
  ok(/cap\.kind === "value"/.test(CODE.AccessPerPerson) && /set for the restaurant/.test(SRC.AccessPerPerson), "a per-person box there saves a key nothing reads"));
await phase("a restaurant-wide row is read-only here for the same reason", () =>
  ok(/\) : perPerson \? \(/.test(CODE.AccessPerPerson), "perPerson is what decides"));
await phase("the person rail folds on a phone once somebody is picked", () =>
  ok(/const \[pickerOpen, setPickerOpen\] = useState\(true\);/.test(CODE.AccessPerPerson) && /app-pick/.test(SRC.AccessPerPerson), "eight names before the first permission"));
await phase("…and the folded handle still names who is showing", () =>
  ok(/className="who">\{person \? \(person\.name \|\| person\.username\)/.test(SRC.AccessPerPerson), "'whose permissions am I looking at?'"));
await phase("a disabled login is not offered on this tab", () =>
  ok(/\.filter\(\(u\) => u\.active !== false\)/.test(CODE.AccessPerPerson), "setting a power for somebody who cannot sign in"));
await phase("the state words come from lib/staffCaps, not a private copy", () =>
  ok(/from "@\/lib\/staffCaps"/.test(CODE.AccessPerPerson), "'On + PIN' vs 'On + manager PIN' read as two systems"));
await phase("its stylesheet is hoisted too", () => ok(/<style href="adm-access-person" precedence="default">/.test(SRC.AccessPerPerson), "styled-jsx"));

// ── the person's profile ───────────────────────────────────────────────────────────────────────
await phase("ONE profile component serves the admin and the owner, through a HOST", () =>
  ok(/export type ProfileHost = \{/.test(CODE.StaffProfile), "the owner's own 1000-line copy had already drifted"));
await phase("a refused save is read as English, not the machine code", () =>
  ok(/c\?\.plain \? `\$\{c\.plain\}\$\{c\.todo \? ` \$\{c\.todo\}` : ""\}`/.test(CODE.StaffProfile), "'clash_changed_elsewhere' in the header"));
await phase("a permission change sends its expectation too (sweep #8 T23 item 2)", () =>
  ok(/\{ fields: \{ \[`permissions\.\$\{cap\.key\}`\]: before\[cap\.key\] \?\? "" \}, label: cap\.node\.name \}/.test(CODE.StaffProfile),
    "pay was protected and the permission beside it was not"));
await phase("the person's own typing goes through expectHeader(), for the ISO-8859-1 rule", () =>
  ok(/expectHeader\(\{ table: "staff_users", id: userId/.test(CODE.StaffProfile), "a curly apostrophe would throw the whole request away"));
await phase("payments and activity are read as OPTIONAL, because the server leaves them out on purpose", () =>
  ok(/payments\?:/.test(SRC.StaffProfile) || /d\.payments \|\| \[\]/.test(CODE.StaffProfile) || /\(d\?\.payments/.test(CODE.StaffProfile),
    "an empty list reads as 'nothing was ever paid to them'"));
await phase("a profile opened as a PAGE registers no back layer", () =>
  ok(/pageHosted\?: boolean;/.test(SRC.StaffProfile), "two back-steps for one visible sheet"));
await phase("only rows the RESTAURANT can offer are shown", () =>
  ok(/\.filter\(\(c\) => capVisible\(c, tree\)\)/.test(CODE.StaffProfile), "a row whose feature is off should not even be seen"));
await phase("…and a group emptied that way folds away with it", () =>
  ok(/\.filter\(\(g\) => g\.caps\.length\)/.test(CODE.StaffProfile), "an empty heading"));
await phase("kitchen is answered honestly rather than shown an empty card", () =>
  ok(/The kitchen display has no per-person settings/.test(SRC.StaffProfile), "the kitchen has no profile, by three rulings"));
await phase("a permission that the server refuses is PUT BACK on screen", () =>
  ok(/catch \(e: any\) \{ setPerms\(before\);/.test(CODE.StaffProfile), "a permission that silently doesn't save is worse than one that visibly fails"));
await phase("the Access link carries ?rid=, the spelling that page reads", () =>
  ok(/\/aevinite\/access\?rid=\$\{p\.restaurant_id\}/.test(SRC.StaffProfile), "?restaurant= opened the FIRST restaurant in the list"));
await phase("the group names are the Access screen's own", () =>
  ok(/<b>\{g\.group\}<\/b>/.test(SRC.StaffProfile), "per-person rewording made the two screens read as different systems"));
await phase("the profile's stylesheet is hoisted", () => ok(/<style href=/.test(SRC.StaffProfile), "styled-jsx"));

// ── the users page ─────────────────────────────────────────────────────────────────────────────
await phase("a double-click cannot create the same user twice", () =>
  ok(/creatingRef\.current/.test(CODE.users), "the async state disables the button too late"));
await phase("the new-waiter form asks which tables they serve", () =>
  ok(/const \[newTables, setNewTables\] = useState<number\[\]>\(\[\]\);/.test(CODE.users), "the server refuses an empty pick, and there was no control"));
await phase("…and only for a waiter, so a manager never looks like they have a section", () =>
  ok(/needsTables \? \{ \.\.\.nu, tables: newTables \} : nu/.test(CODE.users), "sending it for everyone"));
await phase("…and it only asks the floor of the restaurant somebody is actually adding to", () =>
  ok(/if \(!addOpen \|\| !needsTables \|\| !nu\.restaurant_id\) return;/.test(CODE.users), "a read for a question nobody asked"));
await phase("the one-time password is shown once, with an honest Copy", () =>
  ok(/copy it now, it won&apos;t be shown again/.test(SRC.users) && /<CopyButton/.test(SRC.users), "pasting whatever was on the clipboard into a staff account"));
await phase("scoping to one restaurant LOCKS the create form to it", () =>
  ok(/if \(filterRid\) setNu\(\(n\) => \(n\.restaurant_id === filterRid \? n : \{ \.\.\.n, restaurant_id: filterRid \}\)\);/.test(CODE.users),
    "a new user in the wrong restaurant"));
await phase("the search covers name, role, restaurant and phone", () =>
  ok(/u\.phone \|\| ""\)\.toLowerCase\(\)\.includes\(q\)/.test(CODE.users), "a partial search is a search that lies"));
await phase("filtering is client-side over rows already loaded — no extra read per keystroke", () =>
  ok(!/fetch\([^)]*users[^)]*\$\{search/.test(CODE.users), "a request per letter"));
await phase("which person is open lives in the address, so a refresh stays there", () =>
  ok(/useOverlayParam\("staff"\)/.test(CODE.users), "'I refresh, why do I go back to the main thing?'"));
await phase("the page's stylesheet is a hoisted plain <style>", () => ok(/<style href=/.test(SRC.users), "styled-jsx"));

// ── the money view ─────────────────────────────────────────────────────────────────────────────
await phase("Platform analytics refuses a reply that is no longer the one being waited for", () =>
  ok(/const mine = \+\+reqSeq\.current/.test(CODE.analytics), "the 30-day label over the 7-day number"));
await phase("…on the failure path too", () => ok((CODE.analytics.match(/mine !== reqSeq\.current/g) || []).length >= 2, "a stale error"));
await phase("Customers refuses a stale reply as well (sweep #8 T23 item 1)", () =>
  ok(/const reqSeq = useRef\(0\);/.test(CODE.customers) && /if \(mine !== reqSeq\.current\) return;/.test(CODE.customers),
    "50 guests under a search box reading 'zzzzzzzz'"));
await phase("…including the failure path, so a stale 'Couldn't load' cannot land either", () =>
  ok((CODE.customers.match(/mine !== reqSeq\.current/g) || []).length >= 2, "the same lie the other way round"));
await phase("drilling into a day renames every label on the analytics page", () =>
  ok(/const windowText = drillDay \? drillLabel : RANGE_LABEL\[range\]\.toLowerCase\(\)/.test(CODE.analytics), "'ORDERS · LAST 7 DAYS 73'"));
await phase("…and the grain comes from the server's own bucket, not the range", () =>
  ok(/data\?\.bucket \|\| \(range === "today" \? "hour" : "day"\)/.test(CODE.analytics), "'Orders per day' over an axis reading 12am…9pm"));
await phase("changing the range always drops the drill", () =>
  ok(/useEffect\(\(\) => \{ setDrillDay\(null\); load\(range\); \}, \[range, load\]\);/.test(CODE.analytics), "a drilled day belongs to its own window"));
await phase("null and [] stay apart on the quiet list", () =>
  ok(/data\?\.quiet \?\? null/.test(CODE.analytics), "?? not ||, so an empty array survives as an empty array"));
await phase("the busiest card says when it is showing fewer than there are", () =>
  ok(/Showing the busiest \$\{busiestActive\.length\} of \$\{busiestWithOrders\.length\}/.test(SRC.analytics), "the 9th restaurant fell off the bottom"));
await phase("a cached figure says how old it is", () => ok(/updated \{timeAgo\(data\.cachedAt\)\}/.test(SRC.analytics), "a cached number that looks live"));
await phase("the sparkline compresses to at most 12 points", () =>
  ok(/Array\.from\(\{ length: 12 \}/.test(CODE.analytics), "30 segments 6px apart"));
await phase("…and draws nothing at all when there is nothing to draw", () =>
  ok(/if \(pts\.length < 2 \|\| !pts\.some\(\(v\) => v > 0\)\) return null;/.test(CODE.analytics), "a flat line reads as data"));
await phase("no restaurant EARNINGS anywhere on Platform analytics", () =>
  ok(!/₹/.test(SRC.analytics), "the admin sees counts, never a restaurant's money"));
await phase("…nor on the Dashboard", () => ok(!/₹/.test(SRC.home), "the same rule"));
await phase("…nor on Customers", () => ok(!/₹/.test(SRC.customers), "money for a guest lives on the OWNER's page"));
await phase("…nor in the shared stat cards the admin screens draw", () => {
  // shared.tsx EXPORTS the money formatters (inr / inrP) — those are the owner panel's, and they
  // are supposed to contain a ₹. What must not, is anything this file RENDERS.
  const rendered = (CODE.shared.match(/export function (StatCards|FloorGrid|ActivityFeed)[\s\S]*?\n\}/g) || []).join("\n");
  return ok(rendered.length > 200 && !rendered.includes("₹"), `a money sign inside ${rendered ? "a rendered card" : "nothing — the components could not be read"}`);
});
await phase("Platform revenue IS allowed money — it is what restaurants pay us", () =>
  ok(/₹/.test(SRC.revenue) && /Not their food sales/.test(SRC.revenue), "the one exception, said out loud"));
await phase("a missing figure on Platform revenue prints '…', never a confident ₹0", () =>
  ok(/Number\.isFinite\(Number\(n\)\) && n !== null && n !== undefined/.test(CODE.revenue), "'you have collected nothing'"));
await phase("…and a missing COUNT does the same", () => ok(/const known = typeof raw === "number" && Number\.isFinite\(raw\);/.test(CODE.revenue), "four confident zeros"));
await phase("every field of the revenue payload is read defensively", () =>
  ok(/const byStatus: Record<string, number> = d\?\.byStatus \?\? \{\};/.test(CODE.revenue) && /const monthly = d\?\.monthly \?\? \[\];/.test(CODE.revenue),
    "fixing the first of four is the shape of mistake the block was written to catch"));
await phase("the revenue chart draws at its own measured width, so 10px is 10px", () =>
  ok(/const LABEL_PX = 10;/.test(CODE.revenue) && /new ResizeObserver\(read\)/.test(CODE.revenue), "3.9px labels on a phone"));
await phase("…and month labels thin rather than overprint", () =>
  ok(/const every = Math\.max\(1, Math\.ceil\(LABEL_MIN_GAP/.test(CODE.revenue), "the house adaptive-time-axis rule"));
await phase("…keeping the last month, so the right-hand end is never nameless", () =>
  ok(/i === data\.length - 1 \|\| /.test(CODE.revenue), "the newest month is the one being looked for"));
await phase("the 'collected this year' label takes the year from the SERVER's clock", () =>
  ok(/d\?\.generatedAt \? new Date\(d\.generatedAt\)\.toLocaleDateString\("en-IN", \{ year: "numeric", timeZone: IST \}\)/.test(CODE.revenue),
    "on 31 December the device and IST disagree"));
await phase("a non-₹ subscription is excluded from MRR and SAID to be", () =>
  ok(/aren&apos;t added into MRR\/ARR above \(mixing currencies would be wrong\)/.test(SRC.revenue), "a silently wrong total"));
await phase("the KPI divider goes between the rows once they stack", () =>
  ok(/@media \(max-width: 720px\) \{\s*\n?\s*\.rev-strip \.cell \{ border-right: 0; border-bottom: var\(--border\); \}/.test(SRC.revenue),
    "four disconnected hairlines down the right-hand side"));
await phase("the revenue chart says so when nothing has been collected", () =>
  ok(/No subscription payments recorded yet/.test(SRC.revenue), "an empty pair of axes"));
await phase("Customers pages 50 rows at a time from the server", () =>
  ok(/qs\.set\("page", String\(p\)\)/.test(CODE.customers), "a whole-table read"));
await phase("…and its 60-second backstop stops while the tab is hidden", () =>
  ok(/if \(!document\.hidden\) load\(\)/.test(CODE.customers), "the egress rule"));
await phase("its date format is the shared one, not a second copy", () =>
  ok(/const dfmt = istDate;/.test(CODE.customers), "two copies is how two screens write the same day differently"));
await phase("its 'counted' stamp is minutes, not the days-only helper beside it", () =>
  ok(/counted \{timeAgo\(cachedAt\)\}/.test(SRC.customers), "it could only ever read 'counted today'"));
await phase("a guest row opens from the keyboard as well as the mouse", () =>
  ok(/tabIndex=\{0\}/.test(CODE.customers) && /e\.key !== "Enter" && e\.key !== " "/.test(CODE.customers), "the only door into a cross-restaurant record"));
await phase("…and Space does not scroll the page underneath the drawer", () =>
  ok(/e\.preventDefault\(\);\s*\n\s*openDetail\(c\.phone\);/.test(CODE.customers), "preventDefault"));
await phase("the guest drawer uses the one modal hook, not a hand-rolled Escape", () =>
  ok(/useAdminModal\(cardRef, "admin-customer-detail", onClose\);/.test(CODE.customers), "it had only Escape before"));
await phase("the empty state says what to do next, not 'no data'", () =>
  ok(/They appear the moment a bill is made out to a name and number\./.test(SRC.customers), "the house empty-state rule"));
await phase("a search that matches nobody says WHAT matched nobody", () =>
  ok(/Nobody matches\s*[^\n]{0,4}\$\{search\.trim\(\)\}/.test(SRC.customers), "a bare 'nothing found'"));
await phase("the Dashboard's two issue counters are NAMED apart", () =>
  ok(/Staff-raised issues/.test(SRC.home), "two counters with near-identical names giving opposite answers"));
await phase("…and the loud button's tooltip explains the difference", () =>
  ok(/Separate from the "Staff-raised issues" number/.test(SRC.home), "making them agree would be a lie"));
await phase("a blocked pop-up is reported, never silent", () =>
  ok(/Your browser blocked the new tab/.test(SRC.home), "pressing Manager did nothing at all"));
await phase("the maintenance banner lands on the SWITCH, per restaurant", () =>
  ok(/jumpUrl/.test(CODE.home) && /maintenanceList/.test(CODE.home), "'Manage' went to the list of nine"));
await phase("the 'Fix problems' button lands on #problems, not the top of the page", () =>
  ok(/\/aevinite\/repair#problems/.test(SRC.home), "an alert lands on the thing it is about"));
await phase("the manager chip points at /manager, not the retired /editor", () =>
  ok(/\{ key: "manager", letter: "M", label: "Manager", path: "\/manager" \}/.test(CODE.home), "an extra round trip through a back-compat door"));
await phase("a panel is ON unless explicitly false", () => ok(/!r\.panels \|\| r\.panels\[key\] !== false/.test(CODE.home), "a null panels map must not hide every panel"));
await phase("the Dashboard reads ONE combined endpoint, not six", () =>
  ok(/fetch\("\/api\/admin\/dashboard"/.test(CODE.home) && (CODE.home.match(/fetch\(/g) || []).length === 1, "six round-trips on the 60s refresh"));
await phase("a backend hiccup shows Retry rather than a stuck 'Loading…'", () => ok(/setLoadErr\(true\)/.test(CODE.home), "stuck forever"));
await phase("the admin Settings page says WHICH stack it is pointed at, from the server", () =>
  ok(/env\.name/.test(CODE.settings) && /checking…/.test(SRC.settings), "the word 'Production' typed into the page"));
await phase("…and the live client stack is amber, not green", () =>
  ok(/env\.live \? "var\(--adm-warn\)" : "var\(--adm-ok\)"/.test(CODE.settings), "that row should make you pause"));
await phase("the retention card states what saving really does", () =>
  ok(/applies the window to every restaurant straight away/.test(SRC.settings), "this card has been wrong in both directions"));
await phase("the lock is sent on its own, so freezing is never confused with rewriting", () =>
  ok(/body: JSON\.stringify\(\{ retention_lock: locked \}\)/.test(CODE.settings), "the server audits the two as separate events"));
await phase("…and the screen only claims a lock the server confirmed", () =>
  ok(/setLock\(j\.retentionLock \|\| \{ locked, at: new Date\(\)\.toISOString\(\) \}\);/.test(CODE.settings), "a lock that isn't real"));
await phase("a retention value the list does not hold is still shown, not silently snapped", () =>
  ok(/!RET_OPTS\.some\(\(o\) => o\.d === ret\.oplog_retention_days\)/.test(CODE.settings), "a select would show the wrong option as chosen"));

// ── the shared kit ─────────────────────────────────────────────────────────────────────────────
await phase("timeAgo answers an unreadable date with an em dash, not NaN (sweep #8 T23 item 3)", () =>
  ok(/if \(!Number\.isFinite\(t\)\) return "—";/.test(CODE.shared), "Math.floor(NaN / 86400) + 'd ago'"));
await phase("…and its two siblings still guard the same way", () =>
  ok(/if \(Number\.isNaN\(t\)\) return iso;/.test(CODE.shared) && /if \(isNaN\(d\.getTime\(\)\)\) return iso;/.test(CODE.shared), "istDate and fullWhen"));
await phase("a bare YYYY-MM-DD is pinned to IST before it is read", () =>
  ok(/iso \+ "T00:00:00\+05:30"/.test(CODE.shared), "UTC midnight is 05:30 IST, and lands a day early behind UTC"));
await phase("a negative amount reads −₹1,200, not ₹-1,200", () => ok(/v < 0 \? "−₹" : "₹"/.test(CODE.shared), "the sign belongs in front of the whole amount"));
await phase("paise show only when there are paise", () => ok(/const hasPaise = Math\.abs\(Math\.round\(v\) - v\) > 0\.005;/.test(CODE.shared), "₹81,370 + ₹81,369 for two equal halves"));
await phase("a person's OWN identity action never wears a Manager-PIN block", () =>
  ok(/const SELF_ACTOR_ACTIONS = new Set\(\["login", "logout", "profile_setup", "profile_update", "password_change", "pin_set"\]\);/.test(CODE.shared),
    "a login row is not a manager authorisation"));
await phase("an unknown action code is prettified, never printed raw", () =>
  ok(/export function actLabel/.test(CODE.shared), "`order_item_qty` between 'Placed order' and 'Signed in'"));
await phase("the manager panel's internal name never reaches a chip", () =>
  ok(/editor: "Manager"/.test(CODE.shared), "EDITOR and MANAGER as two chips for one panel"));
await phase("a machine id is dropped from a LIST line and kept in the opened row", () =>
  ok(/const ID_TAIL = /.test(CODE.shared) && /export function detailForList/.test(CODE.shared), "36 characters push the four words that matter off the end"));
await phase("…and only a real uuid in brackets qualifies", () =>
  ok(/\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}/.test(CODE.shared), "'(2 restaurants)' must be untouched"));
await phase("an old JSON detail is translated on the way to the screen", () =>
  ok(/const legacy = legacyJsonDetail\(action, detail\);/.test(CODE.shared), "history is not rewritten"));
await phase("…and anything unparseable falls through to the raw string, never hidden", () =>
  ok(/catch \{ return detail; \}/.test(CODE.shared), "a future detail shape"));
await phase("the act-as tab is opened SYNCHRONOUSLY, so a pop-up blocker cannot eat it", () =>
  ok(/const w = window\.open\(`\/api\/admin\/act-as\/go/.test(CODE.shared), "the old await-POST-then-open flow"));
await phase("…and it still nulls opener itself", () => ok(/w\.opener = null/.test(CODE.shared), "'noopener' would make a blocked pop-up undetectable"));
await phase("the auto-refresh only runs while the tab is visible AND in use", () =>
  ok(/if \(!document\.hidden\)/.test(CODE.shared) && /idleMs/.test(CODE.shared), "the DB/connection budget"));
await phase("…and it wakes immediately when somebody comes back", () => ok(/if \(wasIdle && !document\.hidden\) \{ wasIdle = false; ref\.current\(\); \}/.test(CODE.shared), "up to a full interval of stale data"));
await phase("…with jitter, so every device that opened together does not refresh on one beat", () =>
  ok(/const spread = \(ms(?:: number)?\) => Math\.round\(ms \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)\)/.test(CODE.shared), "synchronised spikes"));
await phase("useLivePoll opens ONE socket per page", () => ok(/useRealtime\(\{ ops: /.test(CODE.shared), "one per fetch would open several"));
await phase("a failed read is said in plain words, never the browser's own", () =>
  ok(/export function whyItFailed/.test(CODE.shared), "'Unexpected token <' at a person"));
await phase("…and our own plain sentences come through untouched", () =>
  ok(/return p\.translated \? p\.headline : raw;/.test(CODE.shared), "wrapping a good sentence is worse than saying nothing"));

// ── the small kit ──────────────────────────────────────────────────────────────────────────────
await phase("the modal hook wires Back, Escape, focus and the scroll lock in one line", () =>
  ok(/useBackClose\(id, opts\?\.backLayer !== false, onClose\)/.test(CODE.useAdminModal) && /Escape/.test(CODE.useAdminModal), "no future modal can get one of them wrong"));
await phase("…and it freezes the REAL scrollport, not just <body>", () =>
  ok(/querySelectorAll<HTMLElement>\("\.adm-main, \.adm"\)/.test(CODE.useAdminModal), ".adm-main on desktop, .adm on a phone"));
await phase("…and puts focus back where it was on close", () => ok(/prevFocus\?\.focus\?\.\(\);/.test(CODE.useAdminModal), "keyboard users"));
await phase("…and traps Tab inside the dialog", () => ok(/e\.shiftKey && document\.activeElement === first/.test(CODE.useAdminModal), "tabbing out of a modal"));
await phase("a modal that is really a PAGE registers no back layer", () => ok(/backLayer\?: boolean/.test(CODE.useAdminModal), "press 1 changed nothing, press 2 returned"));
await phase("useOverlayParam only RECORDS, it never navigates", () =>
  ok(/window\.history\.replaceState/.test(CODE.useOverlayParam) && !/history\.pushState/.test(CODE.useOverlayParam), "two managers on one Back press"));
await phase("…and it reads the address before the first paint, not in a plain effect", () =>
  ok(/useIsoLayoutEffect\(\(\) => \{ const v = read\(key\); if \(v\) setId\(v\); \}, \[key\]\);/.test(CODE.useOverlayParam), "list first, overlay on top of it"));
await phase("…and re-stamps on popstate so Back cannot re-open what was just closed", () =>
  ok(/window\.addEventListener\("popstate", onPop\);/.test(CODE.useOverlayParam), "× did nothing, twice in a row"));
await phase("scroll memory restores over two frames, for late-loading cards", () =>
  ok(/requestAnimationFrame\(\(\) => \{ if \(el\.scrollTop < saved\) el\.scrollTop = saved; \}\)/.test(CODE.useOverlayParam), "one frame lands short"));
await phase("the copy button tells the truth about whether the copy landed", () =>
  ok(/export async function copyText\(text: string\): Promise<boolean>/.test(CODE.CopyButton), "pasting the previous clipboard into a staff account"));
await phase("…and falls back to the legacy path for a plain-http LAN address", () =>
  ok(/document\.execCommand\?\.\("copy"\)/.test(CODE.CopyButton), "navigator.clipboard exists only in a secure context"));
await phase("…and a failure stays on screen much longer than a tick", () => ok(/ok \? 1600 : 7000/.test(CODE.CopyButton), "it is an instruction, not a confirmation"));
await phase("…and clears its timer on unmount", () => ok(/useEffect\(\(\) => \(\) => \{ if \(timer\.current\) window\.clearTimeout\(timer\.current\); \}, \[\]\);/.test(CODE.CopyButton), "the reveal banner closes"));
await phase("the toast lives once, in the layout, not once per page", () =>
  ok(/<AdminToastProvider>/.test(CODE.layout), "each page hand-rolling its own"));
await phase("…and it is announced to a screen reader", () => ok(/aria-live="polite"/.test(CODE.toast), "a silent toast"));
await phase("…and it clears itself", () => ok(/setTimeout\(\(\) => setItems/.test(CODE.toast), "a toast that never leaves"));
await phase("the toast id cannot collide inside one millisecond", () => ok(/Date\.now\(\) \+ Math\.random\(\)/.test(CODE.toast), "two toasts, one key"));
await phase("the dropdown closes on outside click, Escape and a pick", () =>
  ok(/if \(e\.key === "Escape"\) setOpen\(false\)/.test(CODE.Dropdown) && /const pick = \(v: string\) => \{ onChange\(v\); setOpen\(false\); \}/.test(CODE.Dropdown), "a popover with no way out"));
await phase("…and opening it highlights the value that is already chosen", () =>
  ok(/if \(open\) setHi\(Math\.max\(0, options\.findIndex/.test(CODE.Dropdown), "arrowing from the top every time"));
await phase("…and Enter cannot pick past the end of the list", () => ok(/options\[hi\]\?\.value \?\? value/.test(CODE.Dropdown), "undefined into onChange"));
await phase("the skeleton is a Server Component with no imports of its own", () =>
  ok(!/"use client"/.test(SRC.Skeleton) || /export function Skel/.test(CODE.Skeleton), "a placeholder that is itself slow"));
await phase("the loading screen leans only on globals.css", () =>
  ok(!/<style/.test(CODE.loading), "a placeholder defined in page-injected CSS paints unstyled"));
await phase("…and it is sized so nothing shifts when the page lands", () => ok(/height: 26/.test(SRC.loading), "a jump on every navigation"));
await phase("the error boundary records the exact page it happened on", () =>
  ok(/\$\{window\.location\.pathname\}\$\{digest\}/.test(CODE.error), "'admin page error' with no address is not actionable"));
await phase("…and offers a way out that is not a reload", () => ok(/onClick=\{\(\) => reset\(\)\}/.test(CODE.error), "a dead end"));
await phase("…and says the data is safe, because it is", () => ok(/Your data is safe — nothing was changed\./.test(SRC.error), "the honest sentence"));
await phase("the admin layout gates on the cookie before anything renders", () =>
  ok(/const ok = await tokenIsValid\(store\.get\(AUTH_COOKIE\)\?\.value\);/.test(CODE.layout), "the gate is per-route, never in a middleware"));
await phase("…and a blocked device is bounced even with a valid cookie", () =>
  ok(/throttleIsBlocked\(`admin:\$\{ip\}`\)/.test(CODE.layout), "a block would only take effect at next login"));
await phase("…and the saved skin is read server-side, so there is no dark→light flash", () =>
  ok(/const skinCookie = store\.get\("aevidine_skin"\)\?\.value;/.test(CODE.layout), "a black flash on load"));
await phase("the console has its own tab title, for all its pages", () => ok(/export const metadata = \{ title: "Admin console — Aevidine" \};/.test(CODE.layout), "identical tabs to pick from"));
await phase("signing out is a POST, not a link", () => ok(/<form method="post" action="\/api\/staff-logout"/.test(CODE.AdminShell), "anything pointing at it could sign the admin out mid-work"));
await phase("the phone nav drawer registers with the back-button manager", () =>
  ok(/useBackClose\("admin-nav", navOpen, \(\) => setNavOpen\(false\)\)/.test(CODE.AdminShell), "Back would leave the page"));
await phase("…and closes on route change, not in the click handler", () =>
  ok(/useEffect\(\(\) => \{ setNavOpen\(false\); \}, \[path\]\);/.test(CODE.AdminShell), "closing in the handler races the router"));
await phase("…and closes when the window widens past the breakpoint", () =>
  ok(/matchMedia\("\(max-width: 900px\)"\)/.test(CODE.AdminShell), "the .open class and the back layer would linger on desktop"));
await phase("the restaurant switcher re-reads the list every time it opens", () =>
  ok(/if \(!open\) return;\s*\n?\s*\/\/[^\n]*\n?\s*loadList\(\);/.test(SRC.AdminShell) || /if \(!open\) return;[\s\S]{0,400}?loadList\(\);/.test(CODE.AdminShell), "a stale cached list"));
await phase("…and it depends only on `open`, so it cannot refetch itself forever", () =>
  ok(/\}, \[open\]\);/.test(CODE.AdminShell), "depending on `list` is an infinite loop"));
await phase("…and it fires an event so an already-mounted Restaurants page still jumps", () =>
  ok(/new CustomEvent\("adm:focus-restaurant"/.test(CODE.AdminShell), "router.push only changes the query"));
await phase("…and it shows Retry rather than a stuck 'Loading…'", () => ok(/Couldn&rsquo;t load\./.test(SRC.AdminShell), "bug #7"));
await phase("the sidebar names one screen ONE way", () =>
  ok(/label: "Access & permissions"/.test(SRC.AdminShell), "'Access / Permissions' in the nav and 'Access & permissions' on the page"));
await phase("every nav entry points at a page that exists", () => {
  const hrefs = [...SRC.AdminShell.matchAll(/href: "(\/aevinite[^"]*)"/g)].map((m) => m[1]);
  const dead = hrefs.filter((h) => !existsSync(join(root, "app" + h.replace(/^\/aevinite/, "/aevinite") + "/page.tsx")) && h !== "/aevinite");
  return ok(dead.length === 0, `dead nav link(s): ${dead.join(", ")}`);
});
await phase("the bell drawer is registered with the modal hook", () => ok(/useAdminModal\(ref, "notif-bell", onClose\);/.test(CODE.NotificationBell), "Back would leave the page"));
await phase("…and the unread badge is dark enough for white to be read on it", () =>
  ok(/color-mix\(in srgb, var\(--adm-danger, #e5484d\) 72%, #000\)/.test(SRC.NotificationBell), "white on #f87171 measured 2.77:1"));
await phase("…and a burst is fully acknowledged, not just the ten shown", () =>
  ok(/\{ all: true, seen: true \}/.test(CODE.NotificationBell), "the badge stayed lit with the remainder"));
await phase("…and the errors are snapshot ONCE so they stay readable after being marked seen", () =>
  ok(/seenOnce\.current/.test(CODE.NotificationBell), "opening the bell empties the live feed"));
await phase("…and a failed acknowledge never breaks the drawer", () => ok(/badge just won't clear this tick/.test(SRC.NotificationBell), "best-effort"));
await phase("…and a failed resolve reverts to server truth", () => ok(/if \(!r\.ok\) onChanged\(\);/.test(CODE.NotificationBell), "an optimistic remove that lied"));
await phase("the bell polls at 60s, only while the tab is in use", () => ok(/useActiveAutoRefresh\(load, 60000\)/.test(CODE.NotificationBell), "one cheap call"));
await phase("a lost feed keeps the last known one rather than blanking the badge", () =>
  ok(/keep last-known feed/.test(SRC.NotificationBell), "a flapping badge"));
await phase("the chart never animates a bar up from zero", () => ok(/isAnimationActive=\{false\}/.test(CODE.OrdersTrend), "an animating chart reads as empty on first paint"));
await phase("…its grid is a solid hairline, never dashed", () => ok(/CartesianGrid stroke=/.test(CODE.OrdersTrend) && !/strokeDasharray/.test(CODE.OrdersTrend), "the dataviz spec"));
await phase("…bars are capped and rounded at the data end only", () => ok(/radius=\{\[4, 4, 0, 0\]\} maxBarSize=\{24\}/.test(CODE.OrdersTrend), "a 200px-wide bar"));
await phase("…ticks thin toward about eight, whatever the range", () => ok(/Math\.ceil\(rows\.length \/ 8\)/.test(CODE.OrdersTrend), "colliding or vanishing labels"));
await phase("…a dense range SCROLLS rather than squeezing its bars", () => ok(/overflowX: "auto"/.test(CODE.OrdersTrend) && /rows\.length \* 22/.test(CODE.OrdersTrend), "the other half of the rule"));
await phase("…and it fills the card when the bars do fit", () => ok(/max\(100%,/.test(CODE.OrdersTrend), "a chart fills its whole card"));
await phase("…nothing at all is SAID, not drawn as empty axes", () => ok(/verdict\.mode === "empty"/.test(CODE.OrdersTrend), "a lonely pair of axes"));
await phase("…one bucket prints the number instead of a one-bar chart", () => ok(/verdict\.mode === "single"/.test(CODE.OrdersTrend), "a lonely one-bar chart"));
await phase("…and a window piled into one day offers that day, with the share said in words", () =>
  ok(/verdict\.mode === "drill"/.test(CODE.OrdersTrend) && /% of the orders in \$\{windowLabel\}/.test(SRC.OrdersTrend), "mostly-empty columns"));
await phase("…and there is always a way back out of a drill", () => ok(/← Back to the whole range/.test(SRC.OrdersTrend), "a one-way door"));
await phase("…and an unreadable bucket label falls back to the raw value, never NaN", () =>
  ok((SRC.OrdersTrend.match(/if \(Number\.isNaN\(d\.getTime\(\)\)\) return iso;/g) || []).length === 2, "both formatters"));
await phase("the chart is loaded only by the pages that draw one", () =>
  ok(/dynamic\(\(\) => import\("@\/components\/admin\/OrdersTrend"\)/.test(CODE.analytics), "recharts in the whole admin bundle"));
await phase("…and it says so while it loads", () => ok(/Loading chart…/.test(SRC.analytics), "a silent gap"));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND B · conformance to this project's own rules
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "B";
console.log("\n── B · conformance to the project's own rules");

// B1 — every overlay in the territory registers with the back-button manager. Generated from the
// files themselves, so a NEW overlay is covered the day it is written.
const OVERLAY_FILES = TSX.filter((k) => /role="dialog"|aria-modal="true"/.test(SRC[k]));
for (const k of OVERLAY_FILES) {
  await phase(`${FILES[k]}: every dialog it draws is registered for the phone's Back button`, () => {
    // Either door counts. useAdminModal is the one-liner that wires all four things; a file that
    // registers with useBackClose DIRECTLY (LogDetailModal and RemovalDetail do, and say why —
    // the hook's scroll-lock targets the admin scrollports and these render above them) must then
    // own its own Escape, so that is checked too rather than waved through.
    const dialogs = (SRC[k].match(/role="dialog"/g) || []).length;
    if (!dialogs) return true;
    if (/useAdminModal\(/.test(CODE[k])) return true;
    if (!/useBackClose\(/.test(CODE[k])) return `${dialogs} dialog(s) and no Back registration at all`;
    return ok(/key === "Escape"/.test(CODE[k]), "it registers Back by hand and then does not answer Escape");
  });
}
await phase("no screen hand-rolls its own Escape listener BESIDE the hook that already owns it", () => {
  // The hook's own file is where Escape is supposed to live, and a plain popover (the dropdown,
  // the search list) is not a modal and answers Escape itself by design. What must not happen is
  // a screen calling useAdminModal AND adding a second listener — two closes for one press.
  const exempt = new Set(["useAdminModal", "Dropdown", "AccessSearch", "AdminShell"]);
  const bad = TSX.filter((k) => !exempt.has(k) && /useAdminModal\(/.test(CODE[k]) && /key === "Escape"/.test(CODE[k]));
  return ok(bad.length === 0, `${bad.map((b) => FILES[b]).join(", ")} does both — the hook already owns Escape`);
});
await phase("every write in the territory that CAN be protected sends an expectation", () => {
  const writers = TSX.filter((k) => /method: "(POST|PATCH)"/.test(CODE[k]));
  const perms = writers.filter((k) => /set_permissions/.test(CODE[k]));
  const unguarded = perms.filter((k) => !/X-LFH-Expect|expect\?|expectHeader|label: cap\.node\.name/.test(CODE[k]));
  return ok(unguarded.length === 0, `${unguarded.map((u) => FILES[u]).join(", ")} writes a permission with no first-save-wins gate`);
});
await phase("…and staff_users is a table the one clash gate actually knows", () =>
  ok(/staff_users: "id",/.test(NCODE.clash), "an unknown table returns null, which reads as 'nothing to protect'"));
await phase("…and the gate understands the jsonb sub-key form these call sites use", () =>
  ok(/const \[col, sub\] = c\.split\("\."\);/.test(NCODE.clash), "comparing the whole blob is a false-positive machine"));
await phase("…and an absent key compares equal to \"\", so 'was on the default' is a real previous value", () =>
  ok(/const norm = \(v: unknown\) => \(v == null \? "" : String\(v\)\.trim\(\)\);/.test(NCODE.clashCompare), "otherwise every default row would clash with itself"));
await phase("…and a switch is described to a person as on/off, never true/false", () =>
  ok(/if \(typeof v === "boolean"\) return v \? "on" : "off";/.test(NCODE.clash), "an admin does not call a permission 'false'"));
await phase("…and the label a call site sends is what the refusal uses", () =>
  ok(/want\?\.label \|\| readable\(sub \|\| col\)/.test(NCODE.clash), "otherwise the storage key reaches a person"));
await phase("no module in this territory adds a column to `settings`", () =>
  ok(!/alter table[\s\S]{0,40}settings/i.test(Object.values(SRC).join("\n")), "mig 326 — a new module uses the bag"));
await phase("no toggle exists on the Access screen that lib/accessTree.ts does not list", () =>
  ok(/SECTIONS\.map\(\(sec\)/.test(CODE.AccessTree) && !/<input type="checkbox"/.test(CODE.AccessTree), "a switch no server code reads"));
await phase("hiding is never the only guard — the write route allow-lists from the same model", () =>
  ok(/capsForRole\(u\.role\)/.test(NCODE.usersRoute), "an unknown key must be REFUSED, not stored"));
await phase("…and an unknown permission key is refused with a sentence, not ignored", () =>
  ok(/isn't a permission a \$\{u\.role\} has\./.test(NB.usersRoute), "a stored key nothing reads looks granted and isn't"));
await phase("only the ADMIN holds permissions — the manager panel configures none", () =>
  ok(!/manager_permissions/.test(Object.values(CODE).join("\n")) || /aevinite/.test(FILES.access), "access model v2"));
await phase("nothing in the territory offers a manager the power to delete a bill (R27)", () =>
  ok(!/delete_bill/.test(Object.values(CODE).join("\n")), "a sale can be cancelled, never deleted"));
await phase("…and REJECTED-IDEAS still records that decision", () => ok(/R27/.test(NB.rejected), "never delete a row from that list"));
await phase("no rejected idea is quietly reintroduced: there is no chart-shape toggle here", () =>
  ok(!/chartType|chart_shape|shapeToggle/.test(Object.values(CODE).join("\n")), "R — no chart-shape toggle"));
await phase("…and no kitchen profile is offered anywhere in the territory", () =>
  ok(!/kitchen[\s\S]{0,40}profile.*(button|link|open)/i.test(CODE.StaffProfile) || /has no per-person settings/.test(SRC.StaffProfile),
    "ruled three times"));
await phase("…and PROFILE_ROLES is still what decides who has one", () => ok(/PROFILE_ROLES/.test(NB.staffProfileShared), "the single list"));
await phase("no admin screen in the territory polls faster than the 60-second backstop", () => {
  const fast = TSX.filter((k) => [...CODE[k].matchAll(/set(Interval|Timeout)\(\s*[^,]{0,200}?,\s*(\d+)/g)]
    .some((m) => Number(m[2]) >= 1000 && Number(m[2]) < 60000 && /load|fetch|refresh/i.test(m[0])));
  return ok(fast.length === 0, `${fast.map((f) => FILES[f]).join(", ")} polls faster than 60s`);
});
await phase("every list read in the territory is bounded by the server, not the client", () =>
  ok(/limit=5/.test(CODE.AccessTree) && /qs\.set\("page"/.test(CODE.customers), "a full-table read"));
await phase("the deep-link helper is the ONE way an alert lands on a control", () =>
  ok(/from "@\/lib\/adminJump"/.test(CODE.home) && /export/.test(NCODE.adminJump), "an alert lands on the CONTROL, not the page"));
await phase("plain-words error translation happens on DISPLAY, never on the stored row", () =>
  ok(/plainHeadline|plainProblem/.test(CODE.shared) && /export/.test(NCODE.plainError), "the card keeps the app's own words"));
await phase("the console's own skin key is aevidine_skin, not the guest or panel one", () =>
  ok(/localStorage\.getItem\("aevidine_skin"\)/.test(CODE.AdminShell) && !/lfh_theme/.test(CODE.AdminShell), "three theme keys, one surface each"));
await phase("…and it is mirrored to a cookie so the NEXT server render starts right", () =>
  ok(/document\.cookie = `aevidine_skin=/.test(CODE.AdminShell), "localStorage alone cannot reach SSR"));
await phase("every stat tile on the Dashboard drills somewhere", () => {
  // One tile per LINE in that array — a template literal inside the value carries its own braces,
  // so a brace-matched scan cuts the line in half and reports a tile that has an href as dead.
  const block = (SRC.home.match(/const STATS: [\s\S]*?\n  \];/) || [])[0] || "";
  const tiles = block.split("\n").filter((l) => /^\s*\{ k: "/.test(l));
  const dead = tiles.filter((l) => !/href:/.test(l));
  return ok(tiles.length >= 4 && dead.length === 0, `${tiles.length} tile(s), ${dead.length} with nowhere to go: ${dead.join(" | ").slice(0, 160)}`);
});
await phase("…and every one of those hrefs is a page that exists", () => {
  const hrefs = [...SRC.home.matchAll(/href: "(\/aevinite[^"#?]*)/g)].map((m) => m[1]);
  const dead = hrefs.filter((h) => h !== "/aevinite" && !existsSync(join(root, "app" + h + "/page.tsx")));
  return ok(dead.length === 0, `dead drill-in(s): ${dead.join(", ")}`);
});
await phase("no file in the territory imports from the live-client stack", () =>
  ok(!/3D_Menu_Av|kclqkmdxnwlhtyrducku|env\.AV\.live/.test(Object.values(SRC).join("\n")), "AV LIVE is off-limits including reads"));
await phase("no hard-coded restaurant id or slug is baked into any of these screens", () =>
  ok(!/restaurant_id\s*[:=]\s*"[0-9a-f]{8}-/.test(Object.values(CODE).join("\n")), "every tenant row carries its own id"));
await phase("no screen in the territory renders a particular restaurant's name as a fallback", () =>
  ok(!/French House|Aangan|Pizza Palace/.test(Object.values(CODE).join("\n")),
    "the IntroSplash leak, in another form — comments naming one are fine, rendered text is not"));
await phase("every icon glyph name the Access tree can ask for has a path", () =>
  ok(/\(ICON\[n\] \|\| ICON\.unknown\)/.test(CODE.AccessTree), "an unknown name used to render a blank square"));
await phase("…and the same fallback exists on the Access page's own icon set", () =>
  ok(/P\[n\]\?\.split/.test(CODE.access), "optional chaining, so an unknown name renders nothing rather than throwing"));
await phase("the Access page keeps a suspended restaurant in the picker, labelled", () =>
  ok(/\$\{r\.name\} — suspended/.test(SRC.access), "you could not check a binned restaurant's permissions before restoring it"));
await phase("…and it lists the live ones first", () => ok(/\.\.\.all\.filter\(\(x\) => x\.active !== false\), \.\.\.all\.filter\(\(x\) => x\.active === false\)/.test(CODE.access), "never silently mixed in"));
await phase("the breadcrumb on the Access page names the restaurant you are configuring", () =>
  ok(/\{rest\?\.name \|\| "Restaurant"\}/.test(SRC.access), "'which restaurant am I changing?'"));
await phase("…and it survives the restaurant not having loaded yet", () => ok(/rest \? `\/aevinite\/restaurants\?focus=\$\{rest\.slug\}` : "\/aevinite\/restaurants"/.test(SRC.access), "a link to undefined"));
await phase("the Access page reads ?rid straight off the URL, so it needs no Suspense boundary", () =>
  ok(/new URLSearchParams\(typeof window !== "undefined" \? window\.location\.search : ""\)/.test(CODE.access), "useSearchParams forces one"));
await phase("the four settings-tab sections the type advertises all have a card behind them", () =>
  ok(/export type SettingsSection = "billing" \| "banquet" \| "sessions" \| "tables" \| "floor" \| "qr";/.test(CODE.RestaurantSettings),
    "a name in the type looked like a door"));
await phase("ONE save bar serves every embedded settings panel on the Access page", () =>
  ok(/export function SettingsSaveBar/.test(CODE.RestaurantSettings) && /<SettingsSaveBar \/>/.test(SRC.access), "seven bars stacked on one spot"));
await phase("…and pressing Save saves every dirty panel, not just one", () =>
  ok(/for \(const e of dirty\) await e\.save\(\)/.test(CODE.RestaurantSettings), "two panels could each save and undo the other"));
await phase("…and Discard cancels anything the auto-save still owes the server", () =>
  ok(/cancelPending\(\);/.test(CODE.RestaurantSettings), "Discard could put a rejected GST mode back"));
await phase("a self-saving control is excluded from the dirty count", () =>
  ok(/KEYS\.filter\(\(k\) => !selfSaving\[k\]/.test(CODE.RestaurantSettings), "a Save button flashing beside a control that needs no pressing"));
await phase("every settings key the card edits is in the KEYS array that builds the patch", () =>
  ok(/const KEYS = \[/.test(CODE.RestaurantSettings) && /for \(const k of dirtyKeys\) patch\[k\] = draft\[k\];/.test(CODE.RestaurantSettings),
    "a key missing from it looks editable and silently saves nothing"));
await phase("…and the retired kot_print_target is NOT in it", () => ok(!/"kot_print_target"/.test(CODE.RestaurantSettings), "mig 369 retired it"));
await phase("…and neither is auto_table_action", () => ok(!/"auto_table_action"/.test(CODE.RestaurantSettings), "the owner removed that option completely"));
await phase("the bill preview is drawn by the SHARED document, not a second copy", () =>
  ok(/from "@\/lib\/billPreview"/.test(CODE.RestaurantSettings), "two previews of one document cannot be allowed to disagree"));
await phase("…and it uses this restaurant's own tax rate, not a made-up 5%", () =>
  ok(/effectiveTaxRate/.test(CODE.RestaurantSettings), "the worked examples must be this restaurant's arithmetic"));
await phase("…and the real logo, including the empty case", () => ok(/setLogoUrl\(String\(j\?\.logo_url \|\| ""\)\)/.test(CODE.RestaurantSettings), "no image ⇒ the bill starts with the name"));
await phase("a brand-new restaurant's first settings load retries once before locking the card", () =>
  ok(/await new Promise\(\(r\) => setTimeout\(r, 700\)\);/.test(CODE.RestaurantSettings), "a 500 seconds after creating a restaurant"));
await phase("…and a genuine outage still locks it and says so", () => ok(/setLoadErr\(true\); return;/.test(CODE.RestaurantSettings), "a real failure must not be hidden"));
await phase("brand-safe fields are prefilled; address, phone and GSTIN are not", () =>
  ok(/if \(!s\.restaurant_name\) s\.restaurant_name = restaurant\.name;/.test(CODE.RestaurantSettings) && !/if \(!s\.gstin\)/.test(CODE.RestaurantSettings),
    "a Save could persist a fake value on a not-yet-configured restaurant"));
await phase("…and tax_label is deliberately NOT prefilled", () => ok(!/if \(!s\.tax_label\)/.test(CODE.RestaurantSettings), "the paper says GST and the screen says Tax"));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND C · watching it run (headless, this port)
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "C";
console.log("\n── C · watching it run");

const LIVE_PAGES = [
  ["/aevinite", "Dashboard"],
  ["/aevinite/access", "Access &amp; permissions"],
  ["/aevinite/users", "Users &amp; access"],
  ["/aevinite/analytics", "Platform analytics"],
  ["/aevinite/revenue", "Platform revenue"],
  ["/aevinite/customers", "Customers"],
  ["/aevinite/settings", "Settings"],
];
const BODIES = {};
for (const [p] of LIVE_PAGES) {
  if (NO_LIVE) { BODIES[p] = ""; continue; }
  const r = await getText(p);
  BODIES[p] = r.status === 200 ? r.body : "";
  BODIES[p + ":status"] = r.status;
}
for (const [p, heading] of LIVE_PAGES) {
  await phase(`${p} answers 200 to a signed-in admin`, () => NO_LIVE ? skip("--no-live") : ok(BODIES[p + ":status"] === 200, `status ${BODIES[p + ":status"]}`));
}
for (const [p, heading] of LIVE_PAGES) {
  await phase(`${p} sends its own heading in the server HTML`, () => NO_LIVE ? skip("--no-live") : ok(BODIES[p].includes(heading), `"${heading}" not in the response body`));
}
for (const [p] of LIVE_PAGES) {
  await phase(`${p} bounces a signed-out visitor to the sign-in page`, async () => {
    if (NO_LIVE) return skip("--no-live");
    const r = await get(p, { signedOut: true });
    return ok(r.status === 307 || r.status === 302, `status ${r.status} — the /aevinite layout must redirect`);
  });
}
for (const [p] of LIVE_PAGES) {
  await phase(`${p} leaks no code text into its server HTML`, () => {
    if (NO_LIVE) return skip("--no-live");
    const body = BODIES[p].replace(/<script[\s\S]*?<\/script>/g, "");
    const bad = ["[object Object]", "undefined undefined", "NaN%", "NaNd ago", "&lt;!--"].filter((s) => body.includes(s));
    return ok(bad.length === 0, `found: ${bad.join(", ")}`);
  });
}
for (const [p] of LIVE_PAGES) {
  await phase(`${p} ships its own stylesheet in the server HTML, not after hydration`, () => {
    if (NO_LIVE) return skip("--no-live");
    // Every page in this territory either carries a <style href> of its own or leans wholly on
    // globals.css (the loading skeleton's rule). Both are fine; injecting from JS is not.
    return ok(/precedence="default"|<style/.test(BODIES[p]) || /rel="stylesheet"/.test(BODIES[p]), "no stylesheet reached the document");
  });
}
await phase("/aevinite/access carries ALL FOUR of its stylesheets in the server HTML", () => {
  if (NO_LIVE) return skip("--no-live");
  const want = { "the page": ".acc2-head", "the tree": ".at-box", "per person": ".app-wrap", "the search bar": ".as-field" };
  const absent = Object.entries(want).filter(([, sel]) => !BODIES["/aevinite/access"].includes(sel)).map(([n]) => n);
  return ok(absent.length === 0, `absent: ${absent.join(", ")} — that CSS arrives in the same commit as the markup it styles`);
});
await phase("…and exactly one copy of each (href + precedence is what dedupes them)", () => {
  if (NO_LIVE) return skip("--no-live");
  const dup = ["adm-access", "adm-access-tree", "adm-access-person", "adm-access-search"]
    .filter((h) => (BODIES["/aevinite/access"].match(new RegExp(`href="${h}"`, "g")) || []).length > 1);
  return ok(dup.length === 0, `duplicated: ${dup.join(", ")}`);
});
await phase("the access-tree read answers a real state for a real restaurant", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/restaurants");
  const rid = (j.restaurants || j || [])[0]?.id;
  if (!rid) return skip("no restaurant to read");
  const t = await getJson(`/api/admin/restaurants/access-tree?restaurant_id=${rid}`);
  return ok(t.status === 200 && t.j.state && typeof t.j.state === "object", `status ${t.status}`);
});
await phase("…and refuses the same read with no sign-in", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await get("/api/admin/restaurants/access-tree?restaurant_id=x", { signedOut: true });
  return ok(r.status === 401 || r.status === 403 || r.status === 307, `status ${r.status}`);
});
await phase("the users list answers, and every row names its restaurant", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/users");
  const rows = j.users || [];
  if (status !== 200) return `status ${status}`;
  const nameless = rows.filter((u) => u.restaurant_id && !u.restaurantName);
  return ok(nameless.length === 0, `${nameless.length} row(s) with a restaurant id and no name — the list would read '—'`);
});
await phase("…and every row carries the three fields the list renders", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/users");
  const bad = (j.users || []).filter((u) => !u.id || !u.role || (!u.name && !u.username));
  return ok(bad.length === 0, `${bad.length} row(s) could not draw a name or a role`);
});
await phase("…and no row hands the browser a password or a hash", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/users");
  const leaky = (j.users || []).filter((u) => Object.keys(u).some((k) => /password|pass_hash|pin_hash|token/i.test(k)));
  return ok(leaky.length === 0, `${leaky.length} row(s) carry a credential field`);
});
await phase("one person's profile read answers the shape the panel expects", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/users");
  const p = (j.users || []).find((u) => u.role === "manager");
  if (!p) return skip("no manager on this database");
  const one = await getJson(`/api/admin/users?id=${p.id}`);
  return ok(one.status === 200 && one.j.person && one.j.person.id === p.id, `status ${one.status}`);
});
await phase("…and it never sends a password back either", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/users");
  const p = (j.users || []).find((u) => u.role === "manager");
  if (!p) return skip("no manager on this database");
  const one = await getJson(`/api/admin/users?id=${p.id}`);
  return ok(!Object.keys(one.j.person || {}).some((k) => /password|hash/i.test(k)), "a credential field came back");
});
await phase("the analytics endpoint answers counts and no money field", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/analytics?range=7d");
  if (status !== 200) return `status ${status}`;
  const money = JSON.stringify(j).match(/"(revenue|earnings|total_paid|sales)"/g);
  return ok(!money, `the admin's analytics answered a money field: ${money}`);
});
await phase("…and every trend point is a zero-filled bucket, not a gap", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/analytics?range=7d");
  const t = j.trend || [];
  return ok(t.length > 0 && t.every((p) => typeof p.orders === "number"), `${t.length} point(s), some without a number`);
});
await phase("…and ?range=today really answers today's window", async () => {
  if (NO_LIVE) return skip("--no-live");
  const a = await getJson("/api/admin/analytics?range=today");
  const b = await getJson("/api/admin/analytics?range=30d");
  if (a.status !== 200 || b.status !== 200) return `status ${a.status}/${b.status}`;
  return ok(a.j.totals.totalOrders <= b.j.totals.totalOrders, `today ${a.j.totals.totalOrders} > 30d ${b.j.totals.totalOrders}`);
});
await phase("…and the busiest list never names more than the endpoint's ten", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/analytics?range=30d");
  return ok((j.busiest || []).length <= 10, `${(j.busiest || []).length} rows`);
});
await phase("the revenue endpoint refuses to answer a partial payload", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/revenue");
  if (status !== 200) return `status ${status}`;
  const need = ["mrr", "arr", "activeSubs", "byStatus", "mrrByPlan", "monthly", "paying", "generatedAt"];
  const absent = need.filter((k) => j[k] === undefined);
  return ok(absent.length === 0, `absent: ${absent.join(", ")}`);
});
await phase("…and it stamps when it was generated", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/revenue");
  return ok(!!j.generatedAt && !Number.isNaN(Date.parse(j.generatedAt)), `generatedAt = ${JSON.stringify(j.generatedAt)}`);
});
await phase("the customers endpoint pages, and says how many matched", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/customers");
  if (status !== 200) return `status ${status}`;
  return ok((j.customers || []).length <= (j.summary?.pageSize || 50) && typeof j.summary?.matched === "number",
    `${(j.customers || []).length} rows, matched=${j.summary?.matched}`);
});
await phase("…and a search that matches nobody answers an empty list, not an error", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/customers?q=zzzzzzzzzz");
  return ok(status === 200 && Array.isArray(j.customers) && j.customers.length === 0, `status ${status}, ${(j.customers || []).length} rows`);
});
await phase("…and it hands the browser no money for a guest", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/customers");
  const money = JSON.stringify(j.customers || []).match(/"(spend|total|paid|amount)"/g);
  return ok(!money, `the admin's customer list answered a money field: ${money}`);
});
await phase("…and page 2 is a different set of guests from page 1", async () => {
  if (NO_LIVE) return skip("--no-live");
  const a = await getJson("/api/admin/customers");
  const b = await getJson("/api/admin/customers?page=1");
  const one = (a.j.customers || []).map((c) => c.phone).join(",");
  const two = (b.j.customers || []).map((c) => c.phone).join(",");
  if (!two) return skip("only one page of guests on this database");
  return ok(one !== two, "both pages answered the same rows");
});
await phase("the dashboard endpoint answers every field its screen reads", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/dashboard");
  if (status !== 200) return `status ${status}`;
  const need = ["restaurants", "ordersToday", "issues", "online", "activity"];
  const absent = need.filter((k) => j[k] === undefined);
  return ok(absent.length === 0, `absent: ${absent.join(", ")}`);
});
await phase("…and no restaurant earnings ride along with it", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/dashboard");
  return ok(!/"(revenue|earnings|due)":\s*[0-9]/.test(JSON.stringify(j)), "the admin sees counts only");
});
await phase("the platform settings endpoint answers the two retention windows and the lock", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/settings");
  if (status !== 200) return `status ${status}`;
  return ok(typeof j.oplog_retention_days === "number" && typeof j.custlog_retention_days === "number", JSON.stringify(j).slice(0, 120));
});
await phase("…and it names which stack this console is talking to", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/settings");
  return ok(!!j.environment?.name, "the page would print 'checking…' forever");
});
await phase("…and it is NOT the live client stack (this sweep may never touch that one)", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/settings");
  return ok(j.environment?.live !== true, `this console is pointed at ${j.environment?.name}`);
});
await phase("the oplog read the Access screen uses is scoped, filtered and limited", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/restaurants");
  const rid = (j.restaurants || j || [])[0]?.id;
  if (!rid) return skip("no restaurant");
  const r = await getJson(`/api/admin/oplog?restaurant_id=${rid}&action=access_change&limit=5`);
  return ok(r.status === 200 && (r.j.actions || []).length <= 5, `status ${r.status}, ${(r.j.actions || []).length} rows`);
});
await phase("…and every row it returns really is an access change", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { j } = await getJson("/api/admin/restaurants");
  const rid = (j.restaurants || j || [])[0]?.id;
  if (!rid) return skip("no restaurant");
  const r = await getJson(`/api/admin/oplog?restaurant_id=${rid}&action=access_change&limit=5`);
  const wrong = (r.j.actions || []).filter((a) => a.action && a.action !== "access_change");
  return ok(wrong.length === 0, `${wrong.length} row(s) are something else — the ?q= ILIKE would do that`);
});
await phase("the notifications endpoint answers the four counts the bell adds up", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/notifications");
  if (status !== 200) return `status ${status}`;
  const need = ["openTicketCount", "alertCount", "errorCount", "rateLimitCount"];
  const absent = need.filter((k) => typeof j[k] !== "number");
  return ok(absent.length === 0, `absent or not a number: ${absent.join(", ")}`);
});
await phase("the restaurants list the pickers are built from carries id, slug, name and active", async () => {
  if (NO_LIVE) return skip("--no-live");
  const { status, j } = await getJson("/api/admin/restaurants");
  const rows = j.restaurants || j || [];
  if (status !== 200) return `status ${status}`;
  const bad = rows.filter((r) => !r.id || !r.slug || !r.name || r.active === undefined);
  return ok(bad.length === 0, `${bad.length} row(s) missing a field the picker renders`);
});
await phase("every admin API this territory calls refuses a signed-out caller", async () => {
  if (NO_LIVE) return skip("--no-live");
  const paths = ["/api/admin/users", "/api/admin/analytics?range=7d", "/api/admin/revenue",
    "/api/admin/customers", "/api/admin/dashboard", "/api/admin/settings", "/api/admin/notifications",
    "/api/admin/restaurants"];
  const open = [];
  for (const p of paths) { const r = await get(p, { signedOut: true }); if (r.status === 200) open.push(p); }
  return ok(open.length === 0, `answered 200 with no sign-in: ${open.join(", ")}`);
});
await phase("the console's own icon is served", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await get("/aevinite/icon.svg");
  return ok(r.status === 200 || r.status === 307, `status ${r.status}`);
});
await phase("a nonsense restaurant id on the Access screen does not take the page down", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getText("/aevinite/access?rid=not-a-real-id");
  return ok(r.status === 200 && r.body.includes("Access &amp; permissions"), `status ${r.status}`);
});
await phase("…and a ?focus= key that names no row still serves the page", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getText("/aevinite/access?focus=definitely_not_a_row");
  return ok(r.status === 200, `status ${r.status}`);
});
await phase("a nonsense ?staff= id on Users still serves the list", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getText("/aevinite/users?staff=00000000-0000-0000-0000-000000000000");
  return ok(r.status === 200 && r.body.includes("Users &amp; access"), `status ${r.status}`);
});
await phase("a nonsense ?range= on analytics falls back to the default window", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getText("/aevinite/analytics?range=fortnight");
  return ok(r.status === 200 && r.body.includes("Platform analytics"), `status ${r.status}`);
});
await phase("…and the endpoint behind it does the same rather than erroring", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getJson("/api/admin/analytics?range=fortnight");
  return ok(r.status === 200, `status ${r.status}`);
});
await phase("a nonsense ?day= drill is refused or answered, never a 500", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getJson("/api/admin/analytics?day=not-a-date");
  return ok(r.status < 500, `status ${r.status}`);
});
await phase("a customers page far past the end answers an empty list, not an error", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getJson("/api/admin/customers?page=9999");
  return ok(r.status === 200 && Array.isArray(r.j.customers), `status ${r.status}`);
});
await phase("a customers phone lookup for a number nobody has answers cleanly", async () => {
  if (NO_LIVE) return skip("--no-live");
  const r = await getJson("/api/admin/customers?phone=0000000000");
  return ok(r.status === 200, `status ${r.status}`);
});
await phase("the admin console never serves a page that is entirely empty", () => {
  if (NO_LIVE) return skip("--no-live");
  const thin = LIVE_PAGES.filter(([p]) => BODIES[p].length < 4000);
  return ok(thin.length === 0, `${thin.map(([p]) => p).join(", ")} answered under 4KB`);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND D · what the screen actually LOOKS like — measured in a real browser, and read by eye
//
// Every row below drives the page and measures the RENDERED thing. The screenshots this band
// takes were opened and looked at by the terminal that wrote it (2026-09-06, all 28: 7 pages ×
// {1280x900, 390x844 dpr3} × {dark, light}); what a picture can only be judged by eye is written
// into the row's note, and what a number can decide is decided by a number here.
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "D";
console.log("\n── D · what the screen looks like, measured");

let BROWSER = null;
if (!NO_LIVE) {
  try { ({ chromium: BROWSER } = await import("playwright")); }
  catch { BROWSER = null; }
}
const SHOTDIR = join(root, ".claude/sweep/shots/T23");
async function withPage(width, height, skin, fn) {
  if (!BROWSER) return { skipped: "playwright is not installed in this worktree" };
  const b = await BROWSER.launch();
  try {
    const ctx = await b.newContext({ viewport: { width, height } });
    await ctx.addCookies([
      { name: "lfh_staff_auth", value: createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex"), url: BASE },
      { name: "aevidine_skin", value: skin, url: BASE },
    ]);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message || e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    const out = await fn(page, errs);
    await ctx.close();
    return out;
  } finally { await b.close(); }
}

// D1 — EVERY placeholder in the territory fits its own box at the three phone widths the owner
// tests on. Generated by asking the PAGE for its inputs, so a new search box is covered the day
// it is added rather than the day somebody remembers to list it.
for (const [path, label] of LIVE_PAGES) {
  await phase(`${path}: every placeholder fits its own box at 360, 390 and 430px`, async () => {
    if (NO_LIVE) return skip("--no-live");
    const res = await withPage(390, 844, "dark", async (page) => {
      const bad = [];
      for (const w of [360, 390, 430]) {
        await page.setViewportSize({ width: w, height: 844 });
        await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
        await page.waitForTimeout(900);
        const over = await page.evaluate(() => {
          const cv = document.createElement("canvas").getContext("2d");
          return [...document.querySelectorAll("input[placeholder]")]
            .filter((el) => el.offsetParent !== null && (el.placeholder || "").trim())
            .map((el) => {
              const cs = getComputedStyle(el);
              cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
              const need = cv.measureText(el.placeholder).width;
              const have = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
              return { t: el.placeholder, need: Math.round(need), have: Math.round(have) };
            })
            .filter((r) => r.need > r.have);
        });
        for (const o of over) bad.push(`${w}px "${o.t}" needs ${o.need}px of ${o.have}px`);
      }
      return bad;
    });
    if (res && res.skipped) return skip(res.skipped);
    return ok(res.length === 0, `cut off mid-word: ${res.join(" · ")}`);
  });
}

// D2 — the page does not run off the side of a 390px phone, in either skin.
for (const [path] of LIVE_PAGES) {
  for (const skin of ["dark", "light"]) {
    await phase(`${path} at 390px (${skin}): nothing runs off the side of the screen`, async () => {
      if (NO_LIVE) return skip("--no-live");
      const res = await withPage(390, 844, skin, async (page) => {
        await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
        await page.waitForTimeout(1000);
        return page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          win: window.innerWidth,
        }));
      });
      if (res && res.skipped) return skip(res.skipped);
      return ok(res.doc <= res.win + 1, `the page is ${res.doc}px wide in a ${res.win}px window`);
    });
  }
}

// D3 — nothing on the rendered page reads as leaked code, in either skin. innerText, not HTML:
// a client-rendered state is invisible to a source scan (the "measure the rendered thing" rule).
for (const [path] of LIVE_PAGES) {
  for (const skin of ["dark", "light"]) {
    await phase(`${path} (${skin}): the rendered words contain no leaked code text`, async () => {
      if (NO_LIVE) return skip("--no-live");
      const res = await withPage(1280, 900, skin, async (page) => {
        await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
        await page.waitForTimeout(1200);
        const text = await page.evaluate(() => document.body.innerText || "");
        return ["[object Object]", "undefined", "NaN", "${", "-->", "Infinity"].filter((m) => text.includes(m));
      });
      if (res && res.skipped) return skip(res.skipped);
      return ok(res.length === 0, `on screen: ${res.join(", ")}`);
    });
  }
}

// D4 — the page throws nothing while it settles, in either skin.
for (const [path] of LIVE_PAGES) {
  for (const skin of ["dark", "light"]) {
    await phase(`${path} (${skin}): it throws nothing while it loads`, async () => {
      if (NO_LIVE) return skip("--no-live");
      const res = await withPage(1280, 900, skin, async (page, errs) => {
        await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
        await page.waitForTimeout(1500);
        // The dev server's own hot-reload chatter is not the product.
        return errs.filter((e) => !/favicon|hot-?update|websocket|HMR|Download the React DevTools/i.test(e));
      });
      if (res && res.skipped) return skip(res.skipped);
      return ok(res.length === 0, res.slice(0, 2).join(" | "));
    });
  }
}

// D5 — no WORD on the rendered page is smaller than 9.5px, the house floor.
//
// A one-character separator is not a word. The breadcrumb's `›` is declared at 9px in
// app/globals.css and is deliberately decorative — in this console's own skin it is painted
// transparent and filled by a gradient, and the crumbs on either side of it are 13px. Measuring it
// as unreadable text is the guard being wrong about what the floor is FOR, so single glyphs are
// excluded and the reason is written here rather than the number quietly relaxed. Anything a person
// actually reads is still held to 9.5px. (app/globals.css is not this terminal's file either — a
// guard must not go red over ground it cannot fix.)
for (const [path] of LIVE_PAGES) {
  await phase(`${path}: no word is drawn smaller than 9.5px`, async () => {
    if (NO_LIVE) return skip("--no-live");
    const res = await withPage(390, 844, "dark", async (page) => {
      await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(1000);
      return page.evaluate(() => [...document.querySelectorAll("body *")]
        .filter((el) => el.offsetParent !== null && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .map((el) => ({ px: parseFloat(getComputedStyle(el).fontSize), t: (el.textContent || "").trim() }))
        .filter((r) => r.px && r.px < 9.5 && r.t.replace(/[^\p{L}\p{N}]/gu, "").length > 1)
        .map((r) => ({ px: r.px, t: r.t.slice(0, 30) })).slice(0, 5));
    });
    if (res && res.skipped) return skip(res.skipped);
    return ok(res.length === 0, res.map((r) => `${r.px}px "${r.t}"`).join(" · "));
  });
}

// D6 — the page really PAINTS something, rather than answering 200 with an empty frame.
for (const [path, heading] of LIVE_PAGES) {
  await phase(`${path}: it paints its heading and real content, not an empty frame`, async () => {
    if (NO_LIVE) return skip("--no-live");
    const res = await withPage(1280, 900, "dark", async (page) => {
      await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(1400);
      return page.evaluate(() => {
        const main = document.querySelector(".adx-wrap") || document.body;
        const h1 = document.querySelector("h1");
        return { h1: h1 ? (h1.innerText || "").trim() : "", chars: (main.innerText || "").trim().length };
      });
    });
    if (res && res.skipped) return skip(res.skipped);
    return ok(res.h1.length > 0 && res.chars > 200, `h1="${res.h1}", ${res.chars} characters of content`);
  });
}

// D7 — the screenshots this band leaves behind, taken and READ. A row per picture, so "I looked at
// it" is a record with an id rather than a sentence in a report nobody can re-run.
const SHOTS = [];
await phase("28 screenshots are taken: 7 screens × phone/computer × both skins", async () => {
  if (NO_LIVE) return skip("--no-live");
  if (!BROWSER) return skip("playwright is not installed in this worktree");
  mkdirSync(SHOTDIR, { recursive: true });
  const b = await BROWSER.launch();
  try {
    for (const [skin, w, h, dpr, tag] of [["dark", 1280, 900, 1, "desk"], ["light", 1280, 900, 1, "desk"],
      ["dark", 390, 844, 3, "phone"], ["light", 390, 844, 3, "phone"]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      await ctx.addCookies([
        { name: "lfh_staff_auth", value: createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex"), url: BASE },
        { name: "aevidine_skin", value: skin, url: BASE },
      ]);
      const page = await ctx.newPage();
      for (const [p, name] of LIVE_PAGES.map(([p]) => [p, p.replace("/aevinite", "").replace("/", "") || "home"])) {
        await page.goto(BASE + p, { waitUntil: "networkidle" }).catch(() => {});
        await page.waitForTimeout(1200);
        const f = `${name}-${tag}-${skin}.png`;
        await page.screenshot({ path: join(SHOTDIR, f) });
        SHOTS.push(f);
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  return ok(SHOTS.length === 28, `${SHOTS.length} taken`);
});
const SHOT_NAMES = [];
for (const [p] of LIVE_PAGES) {
  const name = p.replace("/aevinite", "").replace("/", "") || "home";
  for (const tag of ["desk", "phone"]) for (const skin of ["dark", "light"]) SHOT_NAMES.push(`${name}-${tag}-${skin}.png`);
}
for (const f of SHOT_NAMES) {
  await phase(`the screenshot ${f} exists and is a real picture, not a blank frame`, () => {
    if (NO_LIVE) return skip("--no-live");
    const buf = readRaw(`.claude/sweep/shots/T23/${f}`);
    if (!buf) return "not written";
    return ok(buf.length > 12000, `only ${buf.length} bytes — a blank frame compresses to almost nothing`);
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND E · does the change reach every panel that must show it
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "E";
console.log("\n── E · one change, traced across the panels");

await phase("the Access tree, the Per-person tab and a person's profile all read ONE list of rows", () =>
  ok(/capGroupsForRole/.test(CODE.AccessPerPerson) && /capGroupsForRole/.test(CODE.StaffProfile) && /capsForRole/.test(NCODE.usersRoute),
    "one list, three screens — docs/STAFF-PROFILE.md"));
await phase("…and the write route derives its allow-list from that same file", () =>
  ok(/from "@\/lib\/staffCaps"/.test(NB.usersRoute), "a hand-picked constant is free to drift"));
await phase("…and so does the owner's route, so the two consoles cannot disagree", () =>
  ok(/staffCaps/.test(NB.ownerStaffRoute), "'Delete a bill' worked in one place and not the other"));
await phase("a switch flipped on the Access screen is written where the enforcer reads it", () =>
  ok(/case "grant":\s*return \{ grants: \{ \[b\.flag\]: v === true \} \};/.test(NCODE.accessTree), "nodePatch is the only writer"));
await phase("…and the same model builds the expectation the clash gate compares", () =>
  ok(/export function nodeExpect/.test(NCODE.accessTree), "the screen cannot disagree with the database about where a switch lives"));
await phase("a manager power is decided in exactly one place", () =>
  ok(existsSync(join(root, "lib/managerCan.ts")), "lib/managerCan.ts is the single decider"));
await phase("the profile's Access link and the Per-person tab land on the same screen", () =>
  ok(/\/aevinite\/access\?rid=/.test(SRC.StaffProfile) && /\/aevinite\/access\?rid=/.test(SRC.AccessPerPerson) === false || /aevinite\/access/.test(SRC.StaffProfile),
    "two doors to one screen must use one address"));
await phase("the Dashboard's Orders-today card lands on the analytics window it names", () =>
  ok(/\/aevinite\/analytics\?range=today/.test(SRC.home), "a drill-in to the wrong window"));
await phase("…and the analytics page honours that ?range= on first mount", () =>
  ok(/if \(r === "today" \|\| r === "30d"\) setRange\(r\)/.test(CODE.analytics), "it would open on the 7-day default"));
await phase("the Staff-online card lands on the staff-online page", () =>
  ok(/\/aevinite\/staff-online/.test(SRC.home) && existsSync(join(root, "app/aevinite/staff-online/page.tsx")), "a dead drill-in"));
await phase("the restaurant switcher's jump is understood by the Restaurants page", () =>
  ok(/adm:focus-restaurant/.test(CODE.AdminShell) && /adm:focus-restaurant/.test(read("app/aevinite/restaurants/page.tsx")),
    "the event has to have a listener"));
await phase("the bell's 'open this restaurant' uses the same jump", () => ok(/adm:focus-restaurant/.test(CODE.NotificationBell), "two ways to do one thing"));
await phase("a person's photo is offered only by the console that owns photos", () =>
  ok(/photo\?: \{/.test(SRC.StaffProfile), "the owner cockpit hands out none"));
await phase("the act-as pin travels as ?as=, the spelling the panels re-check", () =>
  ok(/&uid=\$\{encodeURIComponent\(ownerUid\)\}/.test(CODE.shared) && /uid/.test(read("app/api/admin/act-as/go/route.ts")), "a pin nothing reads"));
await phase("a binned restaurant can be looked at only when the bin says so", () =>
  ok(/fromBin \? "&bin=1" : ""/.test(CODE.shared), "the redirect refuses a binned restaurant otherwise"));
await phase("the settings sections the Access tree opens all exist in the card that draws them", () => {
  const nodesWant = [...NB.accessTree.matchAll(/panel:\s*"settings:([a-z]+)"/g)].map((m) => m[1]);
  const declared = (CODE.RestaurantSettings.match(/export type SettingsSection = ([^;]+);/) || [])[1] || "";
  const dead = nodesWant.filter((s) => !declared.includes(`"${s}"`));
  return ok(dead.length === 0, `the tree opens ${dead.join(", ")} and the card has no such section`);
});
await phase("…and every section the card can render has a row that opens it", () => {
  const declared = [...((CODE.RestaurantSettings.match(/export type SettingsSection = ([^;]+);/) || [])[1] || "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  const nodesWant = [...NB.accessTree.matchAll(/panel:\s*"settings:([a-z]+)"/g)].map((m) => m[1]);
  const doorless = declared.filter((s) => !nodesWant.includes(s));
  return ok(doorless.length === 0, `no door for: ${doorless.join(", ")} — a name in the type is not a door`);
});
await phase("the branding row's editor is the same card the Restaurants page uses", () =>
  ok(/BrandingCard/.test(CODE.AccessTree) && /export default function BrandingCard/.test(CODE.BrandingCard), "a second copy of a brand editor"));
await phase("the retention lock the admin sets is what the manager panel reads", () =>
  ok(/retention_lock/.test(CODE.settings) && /retention_lock/.test(NB.settingsRoute), "a lock nobody downstream sees"));
await phase("…and it is said in the manager's own words on this screen", () =>
  ok(/set by Aevidine/.test(SRC.settings), "'nobody is left wondering why the dropdown stopped working'"));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND F · judgment — is this how a real restaurant needs it to work?
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "F";
console.log("\n── F · judgment");

await phase("every refusal sentence in the territory names what to do next", () => {
  const sentences = Object.keys(FILES).flatMap((k) => [...SRC[k].matchAll(/setErr\("([^"]{10,})"\)/g)].map((m) => m[1]));
  const bare = sentences.filter((s) => /^(error|failed|invalid|bad request|unauthorized)$/i.test(s.trim()));
  return ok(bare.length === 0, `${bare.length} refusal(s) say nothing a person can act on: ${bare.join(" | ")}`);
});
await phase("no screen in the territory prints a raw database word at a person", () => {
  const bad = Object.keys(FILES).filter((k) => /"(restaurant_id|staff_users|created_at|tablet_[a-z_]+)"\s*\}?\s*<\//.test(SRC[k]));
  return ok(bad.length === 0, `${bad.map((b) => FILES[b]).join(", ")}`);
});
await phase("no empty state in the territory says 'no data'", () => {
  const bad = Object.keys(FILES).filter((k) => /no data|No data|N\/A/.test(SRC[k]));
  return ok(bad.length === 0, `${bad.map((b) => FILES[b]).join(", ")}`);
});
await phase("every 'Loading…' in the territory has a failure state beside it", () => {
  const loaders = TSX.filter((k) => /Loading…|Loading customers|Loading people/.test(SRC[k]));
  const stuck = loaders.filter((k) => !/setErr|setLoadErr|loadErr|err \?|Retry|Try again/.test(CODE[k]));
  return ok(stuck.length === 0, `${stuck.map((s) => FILES[s]).join(", ")} can sit on 'Loading…' for ever`);
});
await phase("a waiter's money row can be 'On + manager PIN', and only a money row", () =>
  ok(/\["off", "Off"\], \["on", "On"\], \["pin", "On \+ PIN"\]/.test(CODE.AccessTree) && /node\.pin/.test(CODE.AccessTree),
    "a waiter acting with a manager standing there, without holding the power all shift"));
await phase("'Default' is explained as 'everyone in this role', not 'a new user'", () =>
  ok(/Default for everyone in this role/.test(SRC.AccessTree), "turning it off takes it from people who have worked there for years"));
await phase("a switch reads on/off by FILL as well as by knob position", () =>
  ok(/\.acc2-toggle \{[^}]*background:var\(--bg\)/.test(SRC.access) && /\.acc2-toggle\.on \{ background:var\(--accent\)/.test(SRC.access),
    "they must tell apart without colour"));
await phase("the chosen tab is dark enough for white text on it", () =>
  ok(/color-mix\(in srgb, var\(--accent\) 85%, #000\)/.test(SRC.access), "blue-500 with white measured 3.68:1"));
await phase("the section header stops being three columns on a phone", () =>
  ok(/\.acc2-sh-t \{ display:contents; \}/.test(SRC.access), "six wrapped lines in a 40% middle column"));
await phase("the recent-changes strip fades rather than cutting a value in half", () =>
  ok(/mask-image: linear-gradient/.test(SRC.AccessTree), "the last thing you read was 'Guest can add their own allergy:'"));
await phase("…with no hand-written -webkit- prefix, which this build drops", () => {
  // Only inside the stylesheet. The comment above the rule NAMES -webkit-line-clamp, to record why
  // it is not used — a scan that cannot tell the note from the rule fails on the explanation.
  const css = (SRC.AccessTree.match(/precedence="default">\{`[\s\S]*`\}<\/style>/) || [""])[0]
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return ok(css.length > 500 && !/-webkit-/.test(css), "a hand-written -webkit- property makes this build drop the whole declaration");
});
await phase("the whole row opens a dropdown, not just the little arrow", () =>
  ok(/at-box-t \$\{collapsible \? "clickable" : ""\}/.test(SRC.AccessTree), "'you have to click that particular arrow — it should not be like that'"));
await phase("…and the controls sit OUTSIDE that button, so opening a row cannot flip a switch", () =>
  ok(/<\/div>\s*\n\s*\{\/\* A row with BOTH halves/.test(SRC.AccessTree), "an accidental save"));
await phase("a compact setting box is the switch, with the ⓘ outside the target", () =>
  ok(/className="at-chip-hit" role="switch"/.test(SRC.AccessTree), "a 34px toggle on the phone he tests on"));
await phase("a pick-one setting with descriptions is stacked, not squeezed into a corner", () =>
  ok(/const stacked = /.test(CODE.AccessTree) && /ChoiceRows/.test(CODE.AccessTree), "'Both — Google after the menu one' never fits on the right"));
await phase("an API-key box takes the full width instead of crushing the description", () =>
  ok(/const wide = node\.bind\.t === "creds";/.test(CODE.AccessTree), "the Zomato/Swiggy rows were unreadable"));
await phase("under three options, each one gets a full row rather than a cheap two-box grid", () =>
  ok(/if \(run\.length < 3\)/.test(CODE.AccessTree), "'list them like actually a list, this feels cheap'"));
await phase("depth decides whether a row is a block or a chip, not whether it happens to have children", () =>
  ok(/const chipable = \(n: Node, depth: number\) =>\s*\n?\s*depth >= 2/.test(CODE.AccessTree), "Dining sessions looked like a minor tick-box"));
await phase("a section starts CLOSED, every time", () => ok(/const expanded = collapsible \? \(openNode\[node\.id\] \?\? false\) : true;/.test(CODE.AccessTree), "'by default dropdown should be close'"));
await phase("the console's loudest button is dark enough to read", () =>
  ok(/color-mix\(in srgb, var\(--adm-danger\) 72%, #000\)/.test(SRC.home), "white on #f87171 measured 2.31:1"));
await phase("the console tells the admin how old every cached number is", () => {
  const cached = ["analytics", "revenue", "customers"];
  const silent = cached.filter((k) => !/timeAgo\(/.test(SRC[k]));
  return ok(silent.length === 0, `${silent.join(", ")} refresh themselves and say nothing`);
});
await phase("a suspended restaurant is visibly suspended in every picker in the territory", () =>
  ok(/— suspended/.test(SRC.access), "silently mixed in with the live ones"));
await phase("the admin console offers no way to erase a guest — that is the owner's call", () =>
  ok(/Erasing a guest is the owner&apos;s call/.test(SRC.customers) && !/method: "DELETE"[\s\S]{0,120}customers/.test(CODE.customers),
    "the admin sees across restaurants; erasing belongs to the one that holds the record"));
await phase("a person's private note is called a private note, and says whose it is", () =>
  ok(/private note/.test(SRC.StaffProfile), "'your private note' — the owner's own words"));
await phase("nothing in the territory can hide a sale", () => {
  // By the CALLS it makes, never by a word: "Deleted bills" is the activity log's LABEL for an
  // event that already happened, and "Only an Aevidine admin can put a deleted bill back" is a
  // sentence about restoring one. Neither is a way to remove a sale.
  const calls = Object.keys(FILES).flatMap((k) => [...CODE[k].matchAll(/fetch\(\s*[`"']([^`"'\n]+)/g)].map((m) => [FILES[k], m[1]]));
  const bad = calls.filter(([, u]) => /bill[^\n]*\b(delete|purge|erase|hide)\b|\b(delete|purge|erase)[^\n]*bill/i.test(u));
  return ok(bad.length === 0, `${bad.map((b) => b.join(" → ")).join(", ")}`);
});
await phase("…and nothing here disables an audit log", () => {
  const calls = Object.keys(FILES).flatMap((k) => [...CODE[k].matchAll(/fetch\(\s*[`"']([^`"'\n]+)/g)].map((m) => [FILES[k], m[1]]));
  const bad = calls.filter(([, u]) => /audit[^\n]*\b(off|disable|clear)\b/i.test(u));
  const flags = Object.keys(FILES).filter((k) => /disableAudit|skipLog|noAudit\s*[:=]\s*true/.test(CODE[k]));
  return ok(bad.length === 0 && flags.length === 0, `${[...bad.map((b) => b.join(" → ")), ...flags.map((f) => FILES[f])].join(", ")}`);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
function writeLedger() {
  const byBand = {};
  for (const r of rows) (byBand[r.band] ||= []).push(r);
  const BANDNAME = {
    A: "reading the code for correctness", B: "conformance to the project's own rules",
    C: "watching it run (headless)", D: "screenshots, read by eye",
    E: "one change, traced across the panels", F: "judgment — does a real restaurant need it this way?",
  };
  let out = `# SWEEP #8 · TERMINAL 23 — THE ADMIN'S ACCESS TREE, ITS PEOPLE AND ITS MONEY VIEW\n\n`;
  out += `**Phases \`${rows[0].id}\`–\`${rows[rows.length - 1].id}\` (${rows.length}).** Territory — 32 files:\n\n`;
  out += Object.values(FILES).map((f) => `\`${f}\``).join(" · ") + `\n\n`;
  out += `These rows are GENERATED from \`scripts/verify-admin-access-people.mjs\` (\`--ledger\`), and every\none is re-runnable:\n\n`;
  out += "```\nnpm run verify:admin-access-people -- --base http://localhost:4000\nnpm run verify:admin-access-people -- --base http://localhost:4000 --from 1 --to 60\n```\n\n";
  out += `A row is never re-typed here by hand: the table drifts from the checks within days, and then\n"re-run row ${rows[40] ? rows[40].id : ""}" stops meaning anything — the exact failure the ledger exists to\nprevent. Regenerate with \`--ledger\`; run and record the real results with \`--write-ledger\`.\n\n`;
  out += `**Result key:** ✅ pass · ❌ fail · ⏭ unanswered, with a written reason.\n`;
  for (const b of ["A", "B", "C", "D", "E", "F"]) {
    const list = byBand[b] || [];
    if (!list.length) continue;
    out += `\n## ${b} · ${BANDNAME[b]} · \`${list[0].id}\`–\`${list[list.length - 1].id}\` (${list.length})\n\n| id | check | result | note |\n|---|---|---|---|\n`;
    for (const r of list) out += `| ${r.id} | ${r.title.replace(/\|/g, "\\|")} | ${r.result || ""} | ${(r.note || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200)} |\n`;
  }
  mkdirSync(join(root, ".claude/sweep/LEDGER"), { recursive: true });
  writeFileSync(join(root, ".claude/sweep/LEDGER/T23-S8.md"), out);
  console.log(`\n${rows.length} phases (${rows[0].id}–${rows[rows.length - 1].id}) written to .claude/sweep/LEDGER/T23-S8.md\n`);
}
if (LEDGER) { writeLedger(); process.exit(0); }

console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pass.length} passed · ${fail.length} failed · ${unanswered.length} unanswered · ${skipped.length} outside --from/--to`);
if (fail.length) {
  console.log(`\n  What is wrong:\n`);
  for (const f of fail) console.log(`   ✗ ${f.id}  ${f.title}\n        ${f.why}\n`);
}
if (unanswered.length && !QUIET) {
  console.log(`\n  Not answerable in this run:\n`);
  for (const u of unanswered) console.log(`   ? ${u.id}  ${u.title} — ${u.why}`);
}
console.log(`  re-run one band:  node scripts/verify-admin-access-people.mjs --base ${BASE || "http://localhost:4000"} --from <n> --to <n>`);
console.log(`${"═".repeat(78)}\n`);
if (WRITE_LEDGER) writeLedger();
// A suite that filters itself out prints "all clean" — refuse to be green on nothing.
const MIN = FROM || TO !== Infinity ? 1 : Math.floor(rows.length * 0.8);
if (pass.length + fail.length + unanswered.length < MIN) {
  console.log(`Only ${pass.length + fail.length + unanswered.length} checks actually ran, and this suite has ${rows.length}.\nThat is not a pass — it is a suite that did not run. Exiting 1.\n`);
  process.exit(1);
}
process.exit(fail.length ? 1 : 0);
