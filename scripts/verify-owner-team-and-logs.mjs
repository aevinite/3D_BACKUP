#!/usr/bin/env node
// verify:owner-team-and-logs — the guard behind sweep #8 terminal 15.
//
// Territory: the owner's **Audit & logs** (`app/owner/activity/page.tsx`), the owner's **Team**
// roster (`app/owner/staff/page.tsx` + `app/owner/staff/[id]/page.tsx`), and the two libraries a
// person's record is built from (`lib/staffProfileShared.ts`, `lib/staffCaps.ts`) with their doc
// (`docs/STAFF-PROFILE.md`).
//
// WHAT THIS FILE IS FOR. Four faults were fixed on 2026-09-04 and each one is asserted here, by the
// RULE it broke rather than by the shape of the fix — a guard pinned to a code shape goes red for a
// refactor and green for the fault coming back a different way. Where a claim can only be settled by
// running the product, it lives in the LIVE half (`verify:owner-team-and-logs-live`) instead; this
// half reads source and needs no server, so it is safe in a hook and safe in CI.
//
// Run:  npm run verify:owner-team-and-logs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let pass = 0; const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
};

// Strip comments so a rule can never be satisfied by a sentence ABOUT it. LINE comments first, then
// block comments — a `/*` sitting inside a `//` line hid 190 lines from two shipped guards once.
const strip = (src) => src
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const ACTIVITY = "app/owner/activity/page.tsx";
const ROSTER = "app/owner/staff/page.tsx";
const PERSON = "app/owner/staff/[id]/page.tsx";
const SHARED = "components/admin/shared.tsx";
const CAPS = "lib/staffCaps.ts";
const PROF = "lib/staffProfileShared.ts";
const DOC = "docs/STAFF-PROFILE.md";

// ── 1. A REFUSED SIGN-IN IS NOT A MANAGER'S APPROVAL ─────────────────────────────────────────────
// Owner, 2026-07-25: "if there is not manager PIN involved, the manager PIN part should not be
// there." `isManagerPinRow` draws the gold 🔑 chip on any TABLET row with an actor, minus a set of
// the person's OWN identity actions. `login_failed` was not in that set, so 10 of the 200 rows on
// the owner's Activity log said a manager had authorised an attempt that was in fact refused.
//
// Asserted as the RULE, not the entry: every action name this app writes that is about signing in,
// a password, a PIN or a profile must be in the set. That is what catches the NEXT one.
console.log("\n1 · a refused sign-in is not a manager's approval");
{
  const src = read(SHARED);
  const m = /const SELF_ACTOR_ACTIONS = new Set\(\[([^\]]*)\]\)/.exec(strip(src));
  ok("shared.tsx still keeps one list of the person's own identity actions", !!m);
  const set = new Set((m?.[1] || "").match(/"[a-z_]+"/g)?.map((x) => x.slice(1, -1)) || []);
  ok("…and a refused sign-in is one of them", set.has("login_failed"),
     `set is {${[...set].join(", ")}}`);

  // Every identity-shaped action name the product actually writes, harvested from the source.
  const files = [];
  const walk = (d) => { for (const e of readdirSync(join(ROOT, d))) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const rel = `${d}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
    else if (/\.(ts|tsx|js|mjs)$/.test(e)) files.push(rel);
  } };
  ["app", "lib", "public/panels"].forEach(walk);
  const IDENTITY = /"((?:login|logout|password|pin|profile)_?[a-z_]*)"/g;
  const seen = new Set();
  for (const f of files) {
    // Only where the string is being LOGGED as an action, so ordinary words are not swept in.
    const src2 = read(f);
    if (!/logAction|action:\s*"/.test(src2)) continue;
    for (const mm of src2.matchAll(IDENTITY)) seen.add(mm[1]);
  }
  // Names that are plainly an action about a person's own identity, not a field or a route word.
  const KNOWN_NOT_ACTIONS = new Set(["login", "logout", "profile", "pin", "password", "profile_photo", "login_url", "pin_hash"]);
  const identityActions = [...seen].filter((a) => !KNOWN_NOT_ACTIONS.has(a) || a === "login" || a === "logout");
  const missing = identityActions.filter((a) => !set.has(a) && /^(login|logout|password|pin|profile)(_|$)/.test(a) && !/(_hash|_url|_photo)$/.test(a));
  ok("…and no identity action this app writes is missing from the set",
     missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");
}

// ── 2. THE REMOVALS SEARCH SAYS WHICH SLICE IT SEARCHED ──────────────────────────────────────────
// `/api/owner/audit` takes page, kind and rid — and no search term. So the box on the Audit half is
// client-side over the 200 rows in hand, while the chips beside it count the whole record. It used
// to answer a term that exists on page 2 with a flat "Nothing matches that." over 791 records.
console.log("\n2 · the removals search does not claim a reach it has not got");
{
  const src = read(ACTIVITY);
  const bare = strip(src);
  ok("the audit fetch still sends no search term (so the box really is page-local)",
     !/loadAudit[\s\S]{0,600}?p\.set\("q"/.test(bare));
  ok("…and the empty state names the page it searched",
     /Nothing on this page matches/.test(src));
  ok("…and offers a way onward from it",
     /page \{page\} of \{pages\}/.test(src) && /Clear the search/.test(src));
  ok("…and a searched count is called matches, never a page size",
     /\{list\.length === 1 \? "match" : "matches"\} on this page/.test(src));
  // The Activity half's box IS server-side, and must stay that way — the two halves differ on
  // purpose now, and the wording depends on it.
  ok("the activity fetch still sends its search term to the server",
     /loadActivity[\s\S]{0,600}?params\.set\("q"/.test(bare));
}

// ── 3. RENAMING SOMEBODY CHANGES THEIR LOGIN, AND THE SCREEN SAYS SO ─────────────────────────────
// The route's `edit` action writes username as well as name. Every other control on the row that
// costs somebody their access warns first; this one did not, and it is the quietest of them (no
// token bump, so the person only finds out at their next sign-in).
console.log("\n3 · a rename warns that the login changes");
{
  const src = read(ROSTER);
  ok("the rename editor warns while the name has been changed",
     /editing\.name\.trim\(\) !== \(s\.name \|\| s\.username\)/.test(strip(src)));
  ok("…and the warning names both the new login and the old one",
     /ost-renamewarn[\s\S]{0,700}\{editing\.name\.trim\(\)\}[\s\S]{0,300}\{s\.username\}/.test(src));
  ok("…and it is not a confirm() (the same editor edits the harmless phone box)",
     !/confirm\([^)]*[Rr]ename/.test(src));
  // the neighbours it now matches
  for (const [what, rx] of [
    ["Disable", /Disable \$\{s\.name \|\| s\.username\}\?/],
    ["Reset password", /Reset \$\{s\.name \|\| s\.username\}'s password\?/],
    ["a role change", /Change \$\{s\.name \|\| s\.username\} from/],
    ["Remove", /Remove \$\{s\.name \|\| s\.username\} for good\?/],
  ]) ok(`…and ${what} still says what it costs, as it always did`, rx.test(src));
}

// ── 4. THE ROSTER HAS ONE VIEW, AND CLAIMS ONE ───────────────────────────────────────────────────
// The Powers tab left in the access rebuild (owner, 2026-07-31). Its CSS went 2026-08-19 and its
// controls 2026-08-04; the dead `tab` state and a comment promising `?tab=powers` outlived both.
console.log("\n4 · the roster has one view and promises one");
{
  const src = read(ROSTER);
  const bare = strip(src);
  ok("no dead `tab` state survives", !/\[tab\]\s*=\s*useState/.test(bare) && !/tab === "team"/.test(bare));
  // Comments are STRIPPED for both of these: the file carries obituaries naming the removed
  // ?tab= link and the retired /api/owner/manager-permissions route on purpose, and a guard that
  // reads a gravestone as a live promise is the "read the sentence, not the path scan" trap.
  ok("…and nothing promises a ?tab= deep link", !/\?tab=/.test(bare));
  ok("…and the owner panel still configures no permission (only the admin holds them)",
     !/data-perm-key/.test(bare) && !/manager-permissions/.test(bare));
}

// ── 5. THE RULES THE TWO LIBRARIES CARRY ─────────────────────────────────────────────────────────
console.log("\n5 · one profile shape, and the kitchen has none");
{
  const prof = read(PROF);
  const m = /PROFILE_ROLES = \[([^\]]*)\]/.exec(strip(prof));
  const roles = (m?.[1] || "").match(/"[a-z]+"/g)?.map((x) => x.slice(1, -1)) || [];
  ok("PROFILE_ROLES is owner · manager · tablet", roles.join(",") === "owner,manager,tablet", roles.join(","));
  ok("…and kitchen is not on it (ruled three times — R7)", !roles.includes("kitchen"));
  ok("…and the doc's ⛔ block still says why", /KITCHEN HAS NO PROFILE/.test(read(DOC)));
  ok("the roster never decides eligibility for itself — it reads the server's answer",
     !/s\.role === "manager" \|\| s\.role === "tablet"[\s\S]{0,40}completeness/.test(read(ROSTER))
     && /profileEligible/.test(read(ROSTER)));
  ok("…and a kitchen row explains itself rather than looking unfinished",
     /kitchen screen only — no profile/.test(read(ROSTER)));
  // "last four", not "first four" — the sweep #7 fix
  ok("a last-4 field stores the LAST four digits", /s\.slice\(-n\)/.test(strip(prof)));
  ok("…and a payment cannot be dated in the future", /can't record a payment for a future date/.test(prof));
  ok("…and money is rounded to paise, never floored", /Math\.round\(amount \* 100\) \/ 100/.test(strip(prof)));
}
console.log("\n6 · a person's rows are exactly the rows Access has for their role");
{
  const caps = strip(read(CAPS));
  ok("only manager and waiter can be given a per-person answer",
     /ROLES_WITH_OVERRIDES = \["manager", "tablet"\]/.test(caps));
  ok("…so an owner's rows are read-only (owner_entitlements is a restaurant setting)",
     /role === "owner"[\s\S]{0,900}perPerson: false/.test(caps));
  ok("…and kitchen gets no rows at all", /return out; *$/m.test(caps));
  ok("the write allow-list is derived from the same list the screens render",
     /capKeysForRole[\s\S]{0,160}capsForRole\(role\)\.filter\(\(c\) => c\.perPerson\)/.test(caps));
  ok("a row whose FEATURE is off is hidden, never greyed", /export function capVisible/.test(caps));
  // A future limit row with no `def` would print "false%" where a number goes.
  const tree = read("lib/accessTree.ts");
  const limits = [...tree.matchAll(/bind: \{ t: "limit"[^}]*\}/g)];
  const treeLines = tree.split("\n");
  const badLimit = limits.filter((mm) => {
    const line = treeLines[tree.slice(0, mm.index).split("\n").length - 1] || "";
    return !/def:/.test(line);
  });
  ok("every numeric ceiling row carries a default, so no ceiling can read as 'false'",
     badLimit.length === 0, badLimit.length ? `${badLimit.length} without def:` : "");
}

// ── 7. THE STANDING RULES THIS TERRITORY LIVES UNDER ─────────────────────────────────────────────
console.log("\n7 · the standing rules");
{
  const act = read(ACTIVITY), ros = read(ROSTER), per = read(PERSON);
  ok("Audit & logs polls no faster than the 60s backstop", /useActiveAutoRefresh\(refreshView, 60_000\)/.test(strip(act)));
  ok("…and the roster polls not at all", !/setInterval|useActiveAutoRefresh/.test(strip(ros)));
  ok("the roster's value edit sends what it was editing from (no silent overwrites)",
     /X-LFH-Expect/.test(ros));
  ok("…and shows the loser of a clash the reason, AFTER the reload that would erase it",
     /await load\(\);\s*\n\s*fail\(e\);/.test(strip(ros)));
  ok("a withheld section is absent, never explained (R36) — Audit & logs", /router\.replace\("\/owner"\)/.test(act));
  ok("…and the Team roster", /router\.replace\("\/owner"\)/.test(ros));
  ok("both pins survive the trip out to a person and back", /rid=\$\{encodeURIComponent\(rid\)\}/.test(per) && /as=\$\{encodeURIComponent\(as\)\}/.test(per));
  ok("…and closing a person REPLACES the detour rather than stacking it", /router\.replace\(q \? `\/owner\/staff\?\$\{q\}`/.test(per));
  ok("the person page mounts the one shared profile, not a second layout", /<StaffProfile userId=\{id\} host=\{host\}/.test(per));
  ok("the removals record offers no restore and no delete (R27 / owner 2026-08-04)",
     !/canRestore: true/.test(act) && !/method: "DELETE"/.test(act));
  ok("…and its one write is the food-made answer only", (act.match(/method: "POST"/g) || []).length === 1);
  ok("every kind reaching the record has a readable word under it", /function humanKind/.test(act));
  ok("…and so does every reason code", /REMOVAL_REASON\[r\.reason_code\] \|\| humanKind\(r\.reason_code\)/.test(act));
  ok("no database id is printed where a person's name goes", /actorIsRawId/.test(act));
  ok("the doc's line count for the mount point is the real one",
     new RegExp(`is now a ${per.split("\n").length - (per.endsWith("\n") ? 1 : 0)}-line mount point`).test(read(DOC)),
     `file is ${per.split("\n").length - (per.endsWith("\n") ? 1 : 0)} lines`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("\n❌ FAIL — the owner's Audit & logs / Team rules:"); for (const f of fails) console.log("   • " + f); process.exit(1); }
console.log("\n✅ PASS — the owner's Audit & logs and Team say only what they can do");
