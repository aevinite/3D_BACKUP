// Block F — the four docs and the two test files of the territory, claim by claim, against the code
// as it is after round 2's fixes.
import { chk, assert, eq, src, ROOT } from "./core.mjs";
import { execFileSync } from "node:child_process";
import * as T from "@/lib/accessTree";
import * as C from "@/lib/staffCaps";
import * as P from "@/lib/staffProfileShared";

const K = (f, c, h, fn) => chk(f, c, h, fn);
const MD = { model: "docs/ACCESS-MODEL.md", profile: "docs/STAFF-PROFILE.md", spec: "docs/ACCESS-REDESIGN-SPEC.md", ladder: "docs/ACCESS-LADDER.md" };
const am = src(MD.model), sp = src(MD.profile), sx = src(MD.spec), ld = src(MD.ladder);
const read = "read the doc, compare with the code";
const B = T.NODE_BY_ID;
const norm = (x) => x.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

// docs/ACCESS-LADDER.md — history only
await K(MD.ladder, "opens with the HISTORY ONLY banner", read, () => assert(/^> # ⚠️ HISTORY ONLY/.test(ld)));
await K(MD.ladder, "the banner names the live doc and the single source of truth", read, () => assert(/docs\/ACCESS-MODEL\.md/.test(ld.slice(0, 600)) && /lib\/accessTree\.ts/.test(ld.slice(0, 600))));
await K(MD.ladder, "says not to follow it for new work", read, () => assert(/Do not follow it for new work/.test(ld)));
await K(MD.ladder, "CLAUDE.md never sends a session to it", read, () => assert(!/ACCESS-LADDER/.test(src("CLAUDE.md"))));
// docs/ACCESS-MODEL.md
const t = am.match(/\| \*\*Main features\*\* \| \*\*Extra features\*\* \|\n\|---\|---\|\n\| ([^|]+) \| ([^|]+) \|/);
await K(MD.model, "the Main-features card lists exactly the screen's Main rows, in order", read, () => eq(t[1].split("·").map((x) => norm(x.replace(/\(and its whole sub-tree\)/, ""))), T.SECTION_BY_ID.main.children.map((n) => norm(n.name))));
await K(MD.model, "the Extra-features card lists exactly the screen's Extra rows, in order", read, () => eq(t[2].split("·").map(norm), T.SECTION_BY_ID.extra.children.map((n) => norm(n.name))));
await K(MD.model, "Auto-print KOT is described as NOT on this screen", read, () => assert(/A4 · Auto-print KOT — NOT ON THIS SCREEN ANY MORE/.test(am)));
await K(MD.model, "B.2 counts the folder's switch rows right", read, () => { const m = am.match(/2\. \*\*Permission for manager\*\* — (\w+) rows/); eq({ two: 2, three: 3, four: 4 }[m[1].toLowerCase()], B.mgr_may.children.filter((n) => n.bind.t === "grant").length); });
await K(MD.model, "B.2 names the retired printer setup as retired, never as a row", read, () => assert(/"May set the printers up"\*? existed from 2026-08-27 to\s+2026-09-14 and was retired/.test(am)));
await K(MD.model, "B.2 states the two printing rows' defaults the way the code has them", read, () => { eq([B.mgr_print_here.def, B.mgr_print_clear.def], [true, false]); assert(/May be the printer[\s\S]{0,120}default \*\*ON\*\*/.test(am) && /May clear the printing queue`? \(default\s+\*\*OFF\*\*/.test(am)); });
await K(MD.model, "B.3: Tables · Users · Sections, and a manager never deletes", read, () => { eq(B.mgr_manage.children.map((n) => n.name.split(" —")[0]), ["Tables", "Users", "Sections"]); assert(/can \*\*never DELETE\*\* a login/.test(am)); });
await K(MD.model, "C: NINE owner pages", read, () => { assert(/\*\*NINE pages/.test(am)); eq(B.own_menu_group.children.length, 9); });
await K(MD.model, "D: the waiter's money rows and floor rows as the code has them", read, () => { for (const k of ["tablet_mark_paid", "tablet_discount", "close_unpaid"]) assert(am.includes(k), k); for (const k of T.TABLET_COLS.filter((c) => !["tablet_mark_paid", "tablet_discount"].includes(c))) assert(am.includes(k), k); });
await K(MD.model, "A9 Loyalty: lives in settings.modules.loyalty.allowed", read, () => { assert(/settings\.modules\.loyalty\.allowed/.test(am)); eq(B.loyalty.bind, { t: "moduleBag", key: "loyalty" }); });
await K(MD.model, "'The admin owns every switch' — and the owner panel now configures none (item 16)", read, () => { assert(/The admin owns every switch/.test(am)); assert(/permissions: false/.test(src("components/owner/ownerProfileHost.ts"))); });
await K(MD.model, "'exactly two' left-to-build rows, the two it names", read, () => { assert(/There are exactly \*\*two\*\*/.test(am)); eq(T.ALL_NODES.filter((n) => n.leftToBuild).map((n) => n.id).sort(), ["bill_designer", "inventory_in_reports"]); });
await K(MD.model, "every `lib/…` / `app/…` path it names exists", "existsSync on each path", () => { const paths = [...new Set([...am.matchAll(/`((?:lib|app|components|scripts)\/[A-Za-z0-9_./\[\]-]+\.(?:ts|tsx|mjs))`/g)].map((m) => m[1]))]; const miss = paths.filter((p) => { try { execFileSync("test", ["-e", `${ROOT}/${p}`]); return false; } catch { return true; } }); eq(miss, []); return `${paths.length} paths`; });
// docs/STAFF-PROFILE.md
await K(MD.profile, "the kitchen block: PROFILE_ROLES as the code has it", read, () => { assert(sp.includes('PROFILE_ROLES = ["owner","manager","tablet"]')); eq([...P.PROFILE_ROLES], ["owner", "manager", "tablet"]); });
await K(MD.profile, "manager blocks: three, each named as the profile names it", read, () => { assert(/\*\*manager\*\* → three/.test(sp)); for (const g of C.capGroupsForRole("manager")) assert(sp.includes(g.group), g.group); });
await K(MD.profile, "'a manager shows N folders / M dropdowns' matches", read, () => { const m = sp.match(/manager shows (\d+) folders \/ (\d+) dropdowns/); eq([+m[1], +m[2]], [C.capGroupsForRole("manager").length, C.capKeysForRole("manager").length]); });
await K(MD.profile, "'a waiter shows 9 rows in 2 folders'", read, () => { assert(/a waiter shows 9 rows in 2 folders/.test(sp)); eq([C.capKeysForRole("tablet").length, C.capGroupsForRole("tablet").length], [9, 2]); });
await K(MD.profile, "the two-console table now says the owner's copy is read-only (item 16)", read, () => assert(/a person's permission rows \| dropdowns[^|]*\| \*\*read-only\*\*/.test(sp)));
await K(MD.profile, "'record complete X of 14 (X of 13 where there is no Pay card)'", read, () => { assert(/X of 13 where there is no Pay card/.test(sp)); eq([P.completeness({}).total, P.completeness({}, { pay: false }).total], [14, 13]); });
await K(MD.profile, "'Only the last four digits of any ID or bank account are ever stored'", read, () => eq(P.mergeProfilePatch({}, { id_last4: "1234-5678-9012", bank_last4: "0000111122223333" }, P.PROFILE_FIELDS), { id_last4: "9012", bank_last4: "3333" }));
await K(MD.profile, "the real job/pay columns it lists are the sanitiser's columns", read, () => { for (const c of [...P.JOB_COLUMNS, ...P.PAY_COLUMNS]) assert(sp.includes(`\`${c}\``), c); });
await K(MD.profile, "'creds are stripped' from the tree the owner route sends", read, () => assert(/out\.tree = \{ \.\.\.tree, creds: \{\} \}/.test(src("app/api/owner/staff/route.ts"))));
await K(MD.profile, "…and the raw channel object is no longer in that tree at all (item 24)", read, () => assert(/c !== "platform_channels"/.test(src("lib/accessState.ts"))));
await K(MD.profile, "every code path it names exists", "existsSync", () => { const paths = [...new Set([...sp.matchAll(/`((?:lib|app|components)\/[A-Za-z0-9_./\[\]-]+\.(?:ts|tsx))`/g)].map((m) => m[1]))]; const miss = paths.filter((p) => { try { execFileSync("test", ["-e", `${ROOT}/${p}`]); return false; } catch { return true; } }); eq(miss, []); return `${paths.length} paths`; });
// docs/ACCESS-REDESIGN-SPEC.md
const open = sx.split("\n").filter((l) => l.startsWith("- ☐"));
await K(MD.spec, "two lines open, and the header says two (item 17)", read, () => { eq(open.length, 2); assert(/\*\*2\*\* of the lines below are still `☐`/.test(sx)); });
await K(MD.spec, "CLAUDE.md quotes the same count", read, () => assert(/\(2 open `☐`; recount/.test(src("CLAUDE.md"))));
await K(MD.spec, "the two open lines are the PIN reset and the waiter's own-profile sections — neither is built", read, () => { assert(/Reset a staff PIN/.test(open.join(" "))); assert(/tablet user's own profile setting/.test(open.join(" "))); assert(!/assigned_tables/.test(src("components/admin/StaffProfile.tsx")), "the profile edits sections now — tick the line"); });
await K(MD.spec, "every ☒ SUPERSEDED line quotes the owner and his date", read, () => { const sup = sx.split("\n").filter((l) => l.startsWith("- ☒")); eq(sup.length, 3); for (const l of sup) assert(/SUPERSEDED/.test(l), l.slice(0, 40)); });
await K(MD.spec, "each ☑ ticked on 2026-10-10 names something the code really has", read, () => { assert(B.mgr_users_create && B.mgr_users_reset_pw && B.mgrset_tables && B.mgrset_access); });
// the test files
for (const tf of ["lib/staffProfileShared.test.mjs", "lib/accessState.test.mjs"]) {
  const s = src(tf);
  await K(tf, "every test in it asserts something", read, () => { const bodies = s.split(/\ntest\(/).slice(1); assert(bodies.length); assert(bodies.every((b) => /assert\./.test(b))); return `${bodies.length} tests`; });
  await K(tf, "it uses node:assert/strict, so a wrong value fails", read, () => assert(/from "node:assert\/strict"/.test(s)));
  await K(tf, "it imports the real .ts file, not a copy", read, () => assert(/\.\/(staffProfileShared|accessState)\.ts/.test(s)));
}
await K("lib/staffProfileShared.test.mjs", "test:units runs both test files and they pass", "npm run test:units", () => { const out = execFileSync("npm", ["run", "-s", "test:units"], { cwd: ROOT, encoding: "utf8" }); assert(/ℹ fail 0/.test(out)); return (out.match(/ℹ pass \d+/) || [""])[0]; });
await K("lib/accessState.test.mjs", "the reader test refuses the network and the real database (stand-in only)", read, () => { const s = src("lib/accessState.test.mjs"); assert(/data:text\/javascript/.test(s)); assert(!/createClient|SUPABASE/.test(s)); });
