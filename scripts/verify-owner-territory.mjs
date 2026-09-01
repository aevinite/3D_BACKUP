// verify-owner-territory.mjs — the OWNER's Menu / Team / Settings screens, claim by claim.
//
//   npm run verify:owner-territory
//
// WHY THIS FILE EXISTS (T13 sweep, 2026-08-19)
// Sweep #6 wrote 500 permanent checks for these three screens. Two hundred of them are "read the code
// and confirm X", and for three passes I re-created a throwaway script to do that and then deleted it
// with the rest of my scratch files — so the next pass re-typed it, and pass 6 found it gone again.
// A check that has to be rebuilt from memory every time is a check that drifts. These are now in the
// repo, next to the guard that covers the behavioural half (verify:owner-panel).
//
// TWO RULES THIS FILE OBEYS, both learned by getting them wrong in pass 5:
//   1. ASSERT THE RULE, NOT THE SPELLING. Comments are stripped before anything is matched, and every
//      order-of-operations check is scoped to the FUNCTION it is about — a file-wide indexOf reported
//      a working double-click guard as broken because an earlier function also said "await call".
//   2. NEVER MATCH PROSE. Each fix in this territory carries a long comment quoting the old broken
//      code; matching raw text made checks pass and fail on documentation.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { return null; } };
/** Source with comments removed — everything structural is matched against this. */
const code = (s) => String(s || "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
/** JSX entities decoded — what a person actually reads on screen. */
const plain = (s) => String(s || "").replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&rsquo;/g, "’");
/** The body of one named function, so an ordering check cannot stray into its neighbours. */
const fnBody = (src, decl) => {
  const i = src.indexOf(decl); if (i === -1) return "";
  const rest = src.slice(i + decl.length);
  const next = rest.search(/\n  (async )?function |\n  const \w+ = useCallback/);
  return rest.slice(0, next > -1 ? next : 3000);
};

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };

const MENU = "app/owner/menu/page.tsx", ROSTER = "app/owner/staff/page.tsx",
      PERSON = "app/owner/staff/[id]/page.tsx", SET = "app/owner/settings/page.tsx";
const rawM = read(MENU), rawR = read(ROSTER), rawP = read(PERSON), rawS = read(SET);
if (!rawM || !rawR || !rawP || !rawS) { console.log("❌ one of the four owned files is missing — if they moved, update this guard"); process.exit(1); }
const m = code(rawM), r = code(rawR), pr = code(rawP), st = code(rawS);
const mT = plain(m), rT = plain(r), stT = plain(st);
const route = code(read("app/api/owner/staff/route.ts"));
const ents = code(read("lib/ownerEntitlements.ts"));
const shell = code(read("components/owner/OwnerShell.tsx"));

console.log("The owner's territory — Menu, Team, Settings, claim by claim\n");

// ── /owner/menu ───────────────────────────────────────────────────────────────────────────────
ok.section = 1;
if (/mergeOwnerEntitlements/.test(m) && /\.menu\s*!==\s*false/.test(m)) ok("Menu: the section switch is enforced here, not only in the sidebar");
else bad("Menu: the section switch is no longer enforced server-side — a bookmarked URL would open the editor");
if (m.indexOf("if (!selected)") > -1 && m.indexOf("return <OwnerMenuEditor") > m.indexOf("if (!selected)")) ok("Menu: the not-switched-on card returns before the editor can render");
else bad("Menu: the editor can now render before the not-switched-on guard");
if (/qRid && ids\.includes\(qRid\)/.test(m)) ok("Menu: ?rid is honoured only for a restaurant the owner owns");
else bad("Menu: ?rid is no longer checked against the owner's own restaurants");
if (/couldntRead|couldNotRead/.test(m) && /\.error/.test(m)) ok("Menu: a failed read has its own state, separate from \"switched off\"");
else bad("Menu: a failed read is indistinguishable from a switched-off section again");
// ── THIS RULE CHANGED ON HIS WORD (owner, 2026-09-01) ─────────────────────────────────────────
// It used to require the sentence "isn't switched on for your restaurant" to still be on the page.
// He has since asked for the opposite: *"it will not even show that option… it will not only show
// 'unable to access', that there is a feature which contains inventory."* That is R36 — a section
// he has not been given is not named to him — so the switched-off path is a REDIRECT now, on all
// six owner screens (T14, 2026-08-31 and 2026-09-01).
// What this rule was actually protecting is untouched and still checked: a failed READ must never
// be dressed as a switched-off feature (T13, 2026-08-17). So the test is now "the two reasons still
// have two different answers" — one is a sentence you can retry, the other is a redirect — rather
// than "the two reasons still have two different sentences". A guard that keeps asserting a retired
// rule is a guard people learn to ignore.
if (/please reload the page|please try again/i.test(mT) && /redirect\("\/owner"\)/.test(m) && !/isn't switched on for your restaurant/.test(mT))
  ok("Menu: a failed read still says \"try again\", while a switched-off section is a redirect, not a sentence naming it");
else bad("Menu: the two reasons have collapsed back into one answer (or the withheld section is being named to the owner again — R36)");
if ((m.match(/sb\.from\("restaurants"\)/g) || []).length <= 2) ok("Menu: the restaurants table is read once per caller branch");
else bad("Menu: the restaurants table is read more than once per render again");
if (/adm-page-h/.test(m) && !/adm-page-title/.test(m)) ok("Menu: the empty-state heading uses a class the stylesheet defines");
else bad("Menu: the heading is back to a class no stylesheet defines");
if (/await searchParams/.test(m) && /await cookies\(\)/.test(m)) ok("Menu: Next 16's async params and cookies are awaited");
else bad("Menu: searchParams or cookies is no longer awaited");
if (!/^"use client"/.test(rawM)) ok("Menu: it is still a server component");
else bad("Menu: it became a client component — supabaseAdmin must never reach a browser");

// ── the roster ────────────────────────────────────────────────────────────────────────────────
if (!/fetch\("\/api\/owner\/staff/.test(r) && /fetch\(withScope\(/.test(r)) ok("Team: every API call carries the per-tab pins");
else bad("Team: a call bypasses withScope, so an admin's tab would answer for the wrong restaurant");
if (/rid=\$\{encodeURIComponent\(scopePin\)\}/.test(r) && /as=\$\{encodeURIComponent\(as\)\}/.test(r)) ok("Team: the link to a person carries BOTH pins");
else bad("Team: the link to a person has lost a pin");
{
  const b = fnBody(r, "async function saveEdit");
  const c = b.slice(b.indexOf("catch"));
  if (c.indexOf("await load()") > -1 && c.indexOf("await load()") < c.search(/\b(setErr|fail|say)\(/)) ok("Team: a refused rename refreshes FIRST, so the reload cannot erase the message");
  else bad("Team: the refusal message is set before the reload again — load() clears it before a frame is painted");
}
if (/errRef\.current\?\.scrollIntoView/.test(r)) ok("Team: a refusal brings itself onto the screen");
else bad("Team: the refusal banner no longer scrolls into view — on a phone it renders above the fold");
{
  const b = fnBody(r, "async function addStaff");
  if (/if \(addingRef\.current\) return/.test(b) && b.indexOf("addingRef.current = true") < b.indexOf("await call")) ok("Team: a double-click on Add cannot create two people");
  else bad("Team: the synchronous double-click guard is gone or now runs after the first await");
}
if (/X-LFH-Expect/.test(r) && /fields: \{ name: s\.name \?\? "", phone: s\.phone \?\? "" \}/.test(r)) ok("Team: the rename says what it was editing FROM, using the row's original values");
else bad("Team: the rename's expectation is missing or no longer sends the original values");
if (/clash[\s\S]{0,140}plain/.test(r)) ok("Team: a refusal shows the plain sentence, not a code");
else bad("Team: a refusal would show a bare status code");
if ((r.match(/disabled=\{busy/g) || []).length >= 5) ok("Team: every control is disabled while a request is in flight");
else bad("Team: controls are no longer disabled in flight — a slow connection becomes two taps");
if ((r.match(/maxLength=\{20\}/g) || []).length === 2 && /slice\(0, 20\)/.test(route)) ok("Team: both phone fields stop where the server stops");
else bad("Team: a phone field can accept more than the server keeps, and the excess is cut silently");
if (/minLength=\{6\}/.test(r) && /password\.length < 6/.test(route)) ok("Team: the password minimum is stated where it is typed");
else bad("Team: the password minimum is only enforced after a round trip again");
if (/newRole\[r\.id\] === "tablet" && !r\.tableCount/.test(r) && /couldn't read how many tables/.test(rT)) ok("Team: an unreadable floor size explains itself instead of asking the impossible");
else bad("Team: the waiter picker can draw an empty grid and still say \"pick at least one\"");
if (/ost-nokitchen/.test(r) && /kitchen screen only/.test(rT)) ok("Team: a kitchen row says why it is shorter");
else bad("Team: the kitchen row is unexplained again, so every reader re-asks");
{
  const i = r.indexOf('<span className="ost-nokitchen"');
  const el = i > -1 ? r.slice(i, r.indexOf("</span>", i) + 7) : "";
  if (i > -1 && !/<a |<button|onClick|href=|coming soon/i.test(el)) ok("Team: …as plain text, with no link, button or promise (R7)");
  else bad("Team: the kitchen line has become interactive or hints at a profile later — R7 forbids both");
}
{
  const phone = r.slice(r.indexOf("@media (max-width: 560px)"));
  const tile = (r.match(/\.ost-tgrid button \{[^}]*min-height:\s*(\d+)px/) || [])[1];
  if (/min-height: 36px/.test(phone) && tile === "36") ok("Team: the phone tap targets are 36px, the same floor as the table tiles");
  else bad(`Team: the phone tap-target floor is gone or disagrees with the tiles (${tile}px)`);
}
if ((r.match(/\.(ost-perms|ost-perm|reach-chip|reach-legend)[\s.:,{]/g) || []).length === 0) ok("Team: the Powers-tab CSS is still gone");
else bad("Team: dead Powers-tab CSS is back, styling nothing");
if (!/set_permissions/.test(r)) ok("Team: the roster writes no permission of any kind");
else bad("Team: the roster is writing permissions again — only the admin holds those");
{
  const uses = [...r.matchAll(/s\.role === "kitchen"/g)].map((x) => r.slice(Math.max(0, x.index - 120), x.index + 40));
  if (uses.every((u) => /!s\.profileEligible/.test(u))) ok("Team: the role picks WORDS only; profileEligible decides who has a profile");
  else bad("Team: the roster decides profile UI from the role — that belongs to the server's profileEligible");
}
if (/ROLES = \["manager", "kitchen", "tablet"\]/.test(r) && /ASSIGNABLE: Role\[\] = \["manager", "kitchen", "tablet"\]/.test(route)) ok("Team: the roles it offers match the roles the server accepts");
else bad("Team: the role list has drifted from the server's");
if ((r.match(/\? "waiter" :/g) || []).length >= 3) ok("Team: \"tablet\" is shown as \"waiter\" everywhere it appears");
else bad("Team: a place still shows the storage word \"tablet\" to the owner");
if (/type ErrKind = "clash" \| "refused" \| "fault"/.test(r) && /ERR_HEAD\[errKind\]/.test(r)) ok("Team: the banner is headed by the REASON, not always \"Something went wrong\"");
else bad("Team: the banner heading no longer follows the reason");
{
  const ds = r.indexOf("const say = useCallback"), de = r.indexOf("}, []);", r.indexOf("const fail = useCallback"));
  const outside = ds > -1 && de > -1 ? r.slice(0, ds) + r.slice(de) : r;
  if ((outside.match(/setErr\((?!null\))/g) || []).length === 0) ok("Team: every message goes through one door, so a heading cannot disagree with its text");
  else bad("Team: a message is set directly, bypassing the reason — use say() or fail()");
}
if (/const working = team\.filter\(\(s\) => s\.active\)/.test(r) && /ost-offhead/.test(r)) ok("Team: people who can sign in are listed apart from people who cannot");
else bad("Team: the disabled people are mixed back into the working list");
if ((r.match(/const personRow = /g) || []).length === 1) ok("Team: both groups render through ONE row function");
else bad("Team: the person row is duplicated — two copies is how twin surfaces drift");
if (/className="ost-find"/.test(r) && /includes\(needle\)/.test(r) && !/fetch\([^)]*\bq\b/.test(r)) ok("Team: the search filters the list already loaded and fetches nothing");
else bad("Team: the roster search is gone, or it has started issuing requests");

// ── the person page ───────────────────────────────────────────────────────────────────────────
if (/<StaffProfile userId=\{id\} host=\{host\}/.test(pr)) ok("Person: it mounts the SHARED profile, not a second layout");
else bad("Person: it no longer mounts the shared profile component");
if (/\[router, rid, as\]/.test(pr) && /as=\$\{encodeURIComponent\(as\)\}/.test(pr)) ok("Person: closing it carries both pins back");
else bad("Person: closing it drops a pin, so the roster resolves a different owner");
if (/router\.replace\(/.test(pr) && !/router\.push\(/.test(pr)) ok("Person: closing REPLACES the detour rather than stacking an entry");
else bad("Person: closing pushes again — ✕ then Back would re-open what was closed");
if (!/fetch\(/.test(pr) && !/permissions/.test(pr)) ok("Person: it fetches nothing and holds no permission list of its own");
else bad("Person: it has grown its own fetch or permission list");

// ── settings ──────────────────────────────────────────────────────────────────────────────────
{
  const keysLine = (ents.match(/OWNER_SECTION_KEYS\s*=\s*\[([^\]]+)\]/) || [])[1] || "";
  const keys = [...keysLine.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((k) => !["logs_signins", "logs_service", "logs_staff_changes"].includes(k));
  const labBlock = (st.match(/SECTION_LABEL[^{]*\{([\s\S]*?)\n\};/) || [])[1] || "";
  const lab = Object.fromEntries([...labBlock.matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((x) => [x[1], x[2]]));
  const missing = keys.filter((k) => !(k in lab));
  if (!missing.length) ok(`Settings: every switchable section has a label (${keys.length}), so one he HAS is never missing`);
  else bad(`Settings: no label for ${missing.join(", ")} — a restaurant with it ON would not see it listed`);
  const nav = Object.fromEntries([...shell.matchAll(/\{[^{}]*label:\s*"([^"]+)"[^{}]*ent:\s*"(\w+)"[^{}]*\}/g)].map((x) => [x[2], x[1]]));
  const drift = Object.entries(nav).filter(([k, v]) => k in lab && lab[k] !== v);
  if (!drift.length) ok("Settings: every chip is named exactly as the sidebar names that section");
  else bad(`Settings: chip vs sidebar drift — ${drift.map(([k, v]) => `${k}: "${lab[k]}" vs "${v}"`).join("; ")}`);
}
{
  const card = st.slice(st.indexOf("What&apos;s enabled"), st.indexOf("Your restaurants"));
  if (!/fa-xmark/.test(card) && /filter\(\(k\) => data\.sections\[k\] !== false\)/.test(card)) ok("Settings: the card lists what is ON and shows no off-state (R36)");
  else bad("Settings: the card reveals what is switched off — R36 forbids it; only the admin knows that");
}
if (/localStorage\.setItem\("aevidine_skin"/.test(st) && /document\.cookie = `aevidine_skin=/.test(st)) ok("Settings: the skin is written to both the key and the cookie");
else bad("Settings: the skin is no longer written to both, so SSR and the client would disagree");
if (!/lfh_theme|lfh_panel_theme/.test(st + r + m)) ok("Settings: only the owner-console skin key is touched here");
else bad("Settings: this territory touches the guest or staff-panel theme key");
if (/nw\.length < 6/.test(st) && /if \(nw !== cf\)/.test(st)) ok("Settings: a mismatched or short password is refused before anything is sent");
else bad("Settings: a local password check has gone");
if (!/modules\.map|modules\?\.map/.test(st)) ok("Settings: no feature toggle is rendered — owners configure none");
else bad("Settings: feature toggles are back on the owner's settings page");

// ── territory-wide ────────────────────────────────────────────────────────────────────────────
if (![m, r, pr, st].some((x) => /\/aevinite/.test(x))) ok("nothing in this territory links to the admin console");
else bad("something here links to /aevinite — admin is a higher, password-gated privilege");
if (![m, r, pr, st].some((x) => /power_/.test(x))) ok("the retired power_ ladder leaves no trace");
else bad("a power_ entitlement is being read again — that rung is unwritable and was deleted");
if (![m, r, pr, st].some((x) => /french-house|aangan/i.test(x))) ok("no restaurant name or slug is hard-coded");
else bad("a restaurant name or slug is hard-coded — every restaurant is genuinely different");
if (![MENU, ROSTER, PERSON, SET].some((f) => /\r\n/.test(read(f)))) ok("all four files are still LF, not CRLF");
else bad("a file gained CRLF line endings — a bulk rewrite has damaged it");
{
  const fgUses = (r.match(/var\(--fg[^)]*\)/g) || []);
  if (fgUses.every((x) => /,/.test(x))) ok("--fg is undeclared by design, and every use still carries a fallback");
  else bad("a var(--fg) use has lost its fallback — that token is declared nowhere");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("\n❌ FAIL — see .claude/sweep/LEDGER/T13.md for the row each claim belongs to.");
else console.log("\n✅ PASS — the owner's three screens still do what 500 recorded checks say they do");
process.exit(fail ? 1 : 0);
