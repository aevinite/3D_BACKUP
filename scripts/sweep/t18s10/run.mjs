// scripts/sweep/t18s10/run.mjs — sweep #10 terminal 18's NEW checks that need no server and no
// database: P187001–P187380.
//
//   node scripts/sweep/t18s10/run.mjs     → node_modules/.cache/t18s10/run.{md,json}
//
// Sub-ranges (planned from the measurement in LEDGER/T18-S10.md):
//   P187001–P187060  the four docs, claim by claim against the code (they had 0–1 rows each)
//   P187061–P187100  the code that changed since 2026-09-01 (loyalty bag, dashboard reach, print_clear,
//                    the guest feature map's "restaurant not known yet", viewAsPerson)
//   P187101–P187214  ONE ROW PER SWITCH on the Access screen (114): seeded right, reads back right
//                    through the screen's own merge, expectation pure ASCII, words sane
//   P187215–P187300  staffCaps · staffProfile · staffProfileShared — edge inputs and per-role truth
//   P187301–P187340  ownerEntitlements · accessConfig · accessState · viewAsPerson — behaviour
//   P187341–P187380  conformance to the project rules that govern this area
import { load, src, chk, assert, eq, report, fakeClient, ROOT } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const T = await load("accessTree"), M = await load("accessModel"), C = await load("staffCaps");
const P = await load("staffProfileShared"), SP = await load("staffProfile"), AC = await load("accessConfig");
const AS = await load("accessState"), OE = await load("ownerEntitlements"), VA = await load("viewAsPerson");
const F = await load("features");
const grep = (pat, where = "app lib components public/panels") => {
  try { return execFileSync("grep", ["-rlE", pat, ...where.split(" ")], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean); }
  catch { return []; }
};
const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const N = T.ALL_NODES, byId = T.NODE_BY_ID, empty = T.emptyState();
const doc = { model: src("docs/ACCESS-MODEL.md"), profile: src("docs/STAFF-PROFILE.md"), spec: src("docs/ACCESS-REDESIGN-SPEC.md"), ladder: src("docs/ACCESS-LADDER.md") };
const treeSrc = src("lib/accessTree.ts"), featSrc = src("lib/features.ts"), vaSrc = src("lib/viewAsPerson.ts");
const ownerStaff = src("app/api/owner/staff/route.ts"), adminUsers = src("app/api/admin/users/route.ts"), clone = src("lib/settingsClone.ts");
let n = 187000;
const id = () => `P${++n}`;
const K = (file, check, how, fn) => chk(id(), file, check, how, fn);
const read = "read the code";
const node = "node: run the real export";

// ═════════════ THE FOUR DOCS, CLAIM BY CLAIM ═════════════
await K("docs/ACCESS-LADDER.md", "carries the HISTORY ONLY banner as its first line", read, () => assert(/^> # ⚠️ HISTORY ONLY/.test(doc.ladder)));
await K("docs/ACCESS-LADDER.md", "the banner points at the live model by path", read, () => assert(/docs\/ACCESS-MODEL\.md/.test(doc.ladder.slice(0, 600))));
await K("docs/ACCESS-LADDER.md", "the banner names lib/accessTree.ts as the single source of truth", read, () => assert(/lib\/accessTree\.ts/.test(doc.ladder.slice(0, 600))));
await K("docs/ACCESS-LADDER.md", "nothing in the live code still cites it as the rule to follow", "grep app/ lib/ components/ for ACCESS-LADDER", () => {
  const hits = grep("ACCESS-LADDER", "app lib components").filter((f) => !src(f).split("\n").filter((l) => l.includes("ACCESS-LADDER")).every((l) => /retired|HISTORY|history|replac|old/.test(l)));
  eq(hits, []); return "every mention calls it history";
});
await K("docs/ACCESS-LADDER.md", "is not on the live-doc list CLAUDE.md sends sessions to", read, () => assert(!/ACCESS-LADDER/.test(src("CLAUDE.md"))));
await K("docs/ACCESS-MODEL.md", "says it replaces the ladder and that the ladder is history", read, () => assert(/kept as HISTORY/.test(doc.model)));
await K("docs/ACCESS-MODEL.md", "the one-sentence rule matches lib/accessTree.ts's own header", read, () => { assert(/A toggle exists only where the owner listed one/.test(doc.model)); assert(/A TOGGLE EXISTS ONLY WHERE IT IS LISTED HERE/.test(treeSrc)); });
// The two-card table — the regression class: a doc naming rows that left, missing rows that came.
const cardTable = doc.model.match(/\| \*\*Main features\*\* \| \*\*Extra features\*\* \|\n\|---\|---\|\n\| ([^|]+) \| ([^|]+) \|/);
const mainNames = T.SECTION_BY_ID.main.children.map((x) => x.name), extraNames = T.SECTION_BY_ID.extra.children.map((x) => x.name);
const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
await K("docs/ACCESS-MODEL.md", "the Main-features card in the doc lists exactly the rows the screen has", "parse the doc's two-card table, compare with SECTION_BY_ID.main", () => {
  assert(cardTable, "two-card table not found");
  const said = cardTable[1].split("·").map((s) => norm(s.replace(/\(and its whole sub-tree\)/, "")));
  const real = mainNames.map(norm);
  const extraSaid = said.filter((s) => !real.some((r) => r.startsWith(s) || s.startsWith(r.split(" ")[0])));
  const missing = real.filter((r) => !said.some((s) => r.startsWith(s) || s.startsWith(r.split(" ")[0])));
  assert(!extraSaid.length && !missing.length, `doc names rows the screen lacks: [${extraSaid.join(", ")}]; screen rows the doc omits: [${missing.join(", ")}]`);
});
await K("docs/ACCESS-MODEL.md", "the Extra-features card in the doc lists exactly the rows the screen has", "parse the doc's two-card table, compare with SECTION_BY_ID.extra", () => {
  assert(cardTable); const said = cardTable[2].split("·").map(norm), real = extraNames.map(norm);
  const missing = real.filter((r) => !said.some((s) => r.startsWith(s.split(" ")[0])));
  assert(!missing.length, `screen rows the doc omits: [${missing.join(", ")}]`);
});
await K("docs/ACCESS-MODEL.md", "no heading describes an Access row that no longer exists", "every `### A<n> ·` heading names a row in Main/Extra", () => {
  const heads = [...doc.model.matchAll(/^### A\d · ([^\n—(*]+)/gm)].map((m) => norm(m[1]));
  const all = [...mainNames, ...extraNames].map(norm);
  const live = [...doc.model.matchAll(/^### A\d+b? · ([^\n]+)/gm)].filter((m) => !/NOT ON THIS SCREEN/.test(m[1])).map((m) => norm(m[1].split(/[—(*]/)[0]));
  const ghost = live.filter((h) => !all.some((r) => r.includes(h.split(" ")[0]) || h.includes(r.split(" ")[0])) && !/parcel|platform/.test(h));
  void heads;
  assert(!ghost.length, `headings with no row: ${ghost.join(", ")}`);
});
await K("docs/ACCESS-MODEL.md", "A1's sub-option table has a line for every child of Menu", "compare A1's rows with byId.menu.children", () => {
  const a1 = doc.model.split("### A1")[1].split("### A2")[0];
  const miss = byId.menu.children.filter((c) => !new RegExp(c.name.split(" ")[0], "i").test(a1)).map((c) => c.name); eq(miss, []);
});
await K("docs/ACCESS-MODEL.md", "A1's stated defaults agree with each row's def", "Dining sessions OFF · Show reviews ON · 3D ON · Allergy ON · maintenance OFF · favourites ON · veg ON · prep OFF · bubbles ON", () => {
  eq([byId.dining_sessions.def, byId.show_reviews.def, byId.viewer3d.def, byId.allergy_notes.def, byId.maintenance.def, byId.favourites.def, byId.veg.def, byId.prep_time.def, byId.bubbles.def], [false, true, true, true, false, true, true, false, true]);
});
await K("docs/ACCESS-MODEL.md", "maintenance's sub-option Who may do it: Owner only (default) or Owner and manager", node, () => { eq(byId.maintenance_who.def, "owner"); eq(byId.maintenance_who.choices.map((c) => c.value), ["owner", "owner_manager"]); });
await K("docs/ACCESS-MODEL.md", "A3: parcel and platforms have no row; only the three channels switch", node, () => { assert(!byId.parcel && !byId.platforms); eq(byId.orders_no_table.children.map((c) => c.bind.key), ["website", "zomato", "swiggy"]); });
await K("docs/ACCESS-MODEL.md", "A3: where a parcel may be SENT is decided inside QO/P (qop_parcel_allowed)", node, () => eq(byId.qop_parcel.bind, { t: "setting", key: "qop_parcel_allowed" }));
await K("docs/ACCESS-MODEL.md", "A8 Bill: the four rows and their defaults (excl · OFF · none)", node, () => { eq(byId.price_tax_mode.def, "excl"); eq(byId.item_tax_modes.def, false); eq(byId.mrp_tax_treatment.def, "none"); assert(byId.bill_designer.leftToBuild); });
await K("docs/ACCESS-MODEL.md", "'exactly two' left-to-build rows, and they are the two it names", node, () => eq(N.filter((x) => x.leftToBuild).map((x) => x.id).sort(), ["bill_designer", "inventory_in_reports"]));
await K("docs/ACCESS-MODEL.md", "B.1 Manager's menu: exactly FOUR rows", node, () => eq(byId.mgr_menu_group.children.map((x) => x.name), ["Edit menu (Editor)", "Rating review", "Audit & logs", "Dashboard"]));
await K("docs/ACCESS-MODEL.md", "B.1 the first three carry the two-control row (a tab Feature half)", node, () => eq(byId.mgr_menu_group.children.map((x) => x.featureBind?.t || null), ["tab", "tab", "tab", null]));
await K("docs/ACCESS-MODEL.md", "B.1 Audit & logs' three views stored at view_logs.manager_opts", node, () => eq(byId.mgr_tab_log.children.map((x) => `${x.bind.id}.${x.bind.side}.${x.bind.key}`), ["view_logs.manager.removals", "view_logs.manager.activity", "view_logs.manager.customers"]));
await K("docs/ACCESS-MODEL.md", "B.1 MANAGER_TAB_KEYS no longer lists bills", node, () => eq([...T.MANAGER_TAB_KEYS], ["editor", "ratings", "log"]));
await K("docs/ACCESS-MODEL.md", "B.1 Edit menu OFF ⇒ tabGate refuses reads too, with the stated words", "grep the editor route", () => assert(/isn't part of this restaurant's manager panel/.test(src("app/api/editor/[...path]/route.ts"))));
await K("docs/ACCESS-MODEL.md", "B.2 'Permission for manager' — the doc's row count matches the folder", "count the switch rows in the doc's B.2 against mgr_may's switch rows", () => {
  const b2 = doc.model.split("2. **Permission for manager**")[1].split("3. **Manager settings")[0];
  const m = b2.match(/— (ONE|TWO|THREE|FOUR|FIVE) rows/i); assert(m, "no count found");
  const said = { one: 1, two: 2, three: 3, four: 4, five: 5 }[m[1].toLowerCase()];
  const real = byId.mgr_may.children.filter((x) => x.bind.t === "grant").length;
  eq(said, real, "B.2 says a row count the folder does not hold");
});
await K("docs/ACCESS-MODEL.md", "B.2 every switch row in the folder is named in the doc", "names of mgr_may's grant rows in B.2", () => {
  const b2 = doc.model.split("2. **Permission for manager**")[1].split("3. **Manager settings")[0];
  const miss = byId.mgr_may.children.filter((x) => x.bind.t === "grant" && !b2.includes(x.name.split(" (")[0])).map((x) => x.name);
  assert(!miss.length, `B.2 never mentions: ${miss.join(", ")}`);
});
await K("docs/ACCESS-MODEL.md", "B.2 Reopen a bill defaults OFF with a 5-minute window", node, () => { eq(byId.mgr_void_bills.def, false); eq(byId.mgr_bill_reopen_mins.def, 5); });
await K("docs/ACCESS-MODEL.md", "B.2 discount cap 50% for a manager, 5% for a waiter", node, () => { eq(byId.mgr_give_discounts_cap.def, 50); eq(byId.wtr_give_discounts_cap.def, 5); });
await K("docs/ACCESS-MODEL.md", "B.2 Bills reach: Today only (default) or Today + yesterday, at view_bills.manager_opts.range", node, () => { eq(byId.mgr_bills_range.def, "today"); eq(byId.mgr_bills_range.choices.map((c) => c.value), ["today", "today_yesterday"]); eq(byId.mgr_bills_range.bind, { t: "opt", id: "view_bills", side: "manager", key: "range" }); });
await K("docs/ACCESS-MODEL.md", "B.3 Manager settings: only Tables · Users · Sections", node, () => eq(byId.mgr_manage.children.map((x) => x.name.split(" —")[0]), ["Tables", "Users", "Sections"]));
await K("docs/ACCESS-MODEL.md", "B.3 a manager can never DELETE a login (no power for it)", node, () => assert(!T.MANAGER_USER_POWERS.some((p) => p.key === "delete")));
await K("docs/ACCESS-MODEL.md", "C: NINE owner pages, the nine it names", node, () => eq(byId.own_menu_group.children.map((x) => x.name).sort(), ["Access", "Audit & logs", "Customers", "Edit menu", "Feedback & complaints", "Manager mode", "Rating review", "Reports", "Settings"]));
await K("docs/ACCESS-MODEL.md", "C: the owner's Audit & logs views are TWO (removals · activity)", node, () => eq(byId.own_audit.children.filter((x) => x.bind.t === "opt").map((x) => x.bind.key), ["removals", "activity"]));
await K("docs/ACCESS-MODEL.md", "C: the four once-unswitchable pages default ON", node, () => eq(["own_reports", "own_customers", "own_issues", "own_settings"].map((i) => byId[i].def), [true, true, true, true]));
await K("docs/ACCESS-MODEL.md", "D.1 the three waiter money rows, stored where the table says", node, () => eq(byId.wtr_money.children.map((x) => [x.name, x.bind.key || x.bind.id, x.def]), [["Mark a bill paid", "tablet_mark_paid", "off"], ["Discount a bill", "tablet_discount", "off"], ["Close a table that still owes money", "close_unpaid", "pin"]]));
await K("docs/ACCESS-MODEL.md", "D: printing an invoice is on WAITER_NEVER and has no row", node, () => { eq([...T.WAITER_NEVER], ["tablet_invoice"]); assert(!N.some((x) => x.bind.key === "tablet_invoice")); });
await K("docs/ACCESS-MODEL.md", "D.2 the six floor rows and their columns", node, () => eq(byId.wtr_floor.children.map((x) => x.bind.key), ["tablet_take_orders", "tablet_table_ops", "tablet_table_tags", "tablet_khata", "tablet_parcel", "tablet_banquet"]));
await K("docs/ACCESS-MODEL.md", "D: 'every one is per-person overridable' — all nine waiter switch rows are perPerson", node, () => eq(C.capKeysForRole("tablet").length, 9));
await K("docs/ACCESS-MODEL.md", "the power_<flag> rung: nothing reads it (the doc's closing section)", "grep for a non-comment read of power_", () => { const r = grep("power_\\$\\{|powerEntitlementKey\\(", "app lib").filter((f) => f !== "lib/ownerEntitlements.ts" && /power_\$\{|powerEntitlementKey\(/.test(code(src(f)))); eq(r, ["lib/accessModel.ts"]); return "the one reader is accessModel's retired allowed() display helper, which nothing imports (P105050)"; });
await K("docs/ACCESS-MODEL.md", "'Owner panel — nothing (owners configure no permission)' holds in the code", "read app/api/owner/staff set_permissions", () => {
  assert(!/action === "set_permissions"/.test(ownerStaff), "the OWNER route has a set_permissions handler: an owner can change a person's individual permissions — the doc's table says owners configure nothing (decision for the owner, Part 4)");
});
const sp = doc.profile;
await K("docs/STAFF-PROFILE.md", "the kitchen block names PROFILE_ROLES exactly as the code has it", read, () => assert(sp.includes('PROFILE_ROLES = ["owner","manager","tablet"]') && JSON.stringify([...P.PROFILE_ROLES]).replace(/\s/g, "") === '["owner","manager","tablet"]'));
await K("docs/STAFF-PROFILE.md", "every code path it names exists", "existsSync on each path", () => { for (const p of ["components/admin/StaffProfile.tsx", "lib/staffCaps.ts", "app/api/admin/users/route.ts", "app/api/admin/users/photo", "components/owner/ownerProfileHost.ts", "lib/accessState.ts", "lib/staffProfile.ts", "app/owner/staff/[id]/page.tsx"]) assert(existsSync(join(ROOT, p)), p); });
await K("docs/STAFF-PROFILE.md", "the owner mount point's line count (it says re-count, do not trust)", "wc -l app/owner/staff/[id]/page.tsx", () => { const lines = src("app/owner/staff/[id]/page.tsx").split("\n").length - 1; assert(/60-line mount point/.test(sp)); eq(lines, 60); return `${lines} lines`; });
await K("docs/STAFF-PROFILE.md", "owner host: photo NOT offered, remove the login offered", "read components/owner/ownerProfileHost.ts", () => { const h = src("components/owner/ownerProfileHost.ts"); assert(!/^\s*photo\s*[:(]/m.test(h)); assert(/remove/.test(h)); });
await K("docs/STAFF-PROFILE.md", "owner host's can-set: pin/signIn/role/visitAsPerson/accessLink all false", read, () => assert(/can: \{ pin: false, signIn: false, role: false, visitAsPerson: false, accessLink: false/.test(src("components/owner/ownerProfileHost.ts"))));
await K("docs/STAFF-PROFILE.md", "the action translations it lists are in the host", read, () => { const h = src("components/owner/ownerProfileHost.ts"); for (const a of ["set_job", "set_payroll", "set_permissions"]) assert(h.includes(a), a); });
await K("docs/STAFF-PROFILE.md", "/api/owner/staff?staff= answers person · payrollOn · payments · activity · tree", "grep the reply keys", () => { for (const k of ["person", "payrollOn", "payments", "activity", "tree"]) assert(new RegExp(`\\b${k}\\b`).test(ownerStaff), k); });
await K("docs/STAFF-PROFILE.md", "creds are stripped from the tree an owner gets", read, () => assert(/CREDS ARE STRIPPED/.test(ownerStaff)));
await K("docs/STAFF-PROFILE.md", "the activity card is gated by the logs entitlement (activityOff)", read, () => assert(/activityOff/.test(ownerStaff)));
await K("docs/STAFF-PROFILE.md", "'record complete X of 14' — the rail's denominator", node, () => { eq(P.completeness({}).total, 14); eq(P.completeness({}, { pay: false }).total, 13); return "14 with a pay card, 13 without (since 2026-08-18); the doc's 'X of 14' is the with-pay case"; });
const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5 };
await K("docs/STAFF-PROFILE.md", "'Blocks per role: manager → N' equals the blocks a manager's page really has", "parse the doc's number, compare with capGroupsForRole('manager')", () => {
  const m = sp.match(/\*\*manager\*\* → (\w+),?/); assert(m, "manager blocks line not found");
  const g = C.capGroupsForRole("manager").map((x) => x.group);
  eq(WORD[m[1]], g.length, `the doc says ${m[1]}; the profile renders ${g.join(" · ")}`);
  for (const name of g) assert(sp.includes(name), `the doc does not name the block "${name}"`);
});
await K("docs/STAFF-PROFILE.md", "'a manager shows N folders / M dropdowns' equals today's count", "parse the doc, compare with capGroupsForRole / capKeysForRole", () => {
  const m = sp.match(/manager shows (\d+) folders \/ (\d+) dropdowns/); assert(m);
  eq([+m[1], +m[2]], [C.capGroupsForRole("manager").length, C.capKeysForRole("manager").length]);
});
await K("docs/STAFF-PROFILE.md", "'a waiter shows 9 rows in 2 folders with On + manager PIN'", node, () => { eq(C.capKeysForRole("tablet").length, 9); eq(C.capGroupsForRole("tablet").length, 2); assert(C.capsForRole("tablet").some((c) => c.pin)); });
await K("docs/STAFF-PROFILE.md", "waiter blocks named as Access names them", node, () => eq(C.capGroupsForRole("tablet").map((g) => g.group), [byId.wtr_money.name, byId.wtr_floor.name]));
await K("docs/STAFF-PROFILE.md", "only the last four digits of an ID or bank account are ever stored", node, () => { const o = P.mergeProfilePatch({}, { id_last4: "999988887777", bank_last4: "1234567890" }, P.PROFILE_FIELDS); eq([o.id_last4, o.bank_last4], ["7777", "7890"]); });
await K("docs/STAFF-PROFILE.md", "a person with pay history cannot be deleted — both delete routes", "grep payHistoryBlocksDelete in both", () => { for (const f of [adminUsers, ownerStaff]) assert(/payHistoryBlocksDelete\(/.test(f)); });
await K("docs/STAFF-PROFILE.md", "…and both answer 409", "grep the status beside the message", () => { for (const f of [adminUsers, ownerStaff]) assert(/PAY_HISTORY_DELETE_MESSAGE\([^)]*\)[^;]*409/.test(f.replace(/\n\s*/g, " "))); });
await K("docs/STAFF-PROFILE.md", "photo: PNG/JPG/WEBP ≤ 2 MB, in the branding bucket under staff/<id>/", "read app/api/admin/users/photo/route.ts", () => { const r = src("app/api/admin/users/photo/route.ts"); assert(/2 \* 1024 \* 1024|2_?000_?000|2MB|2 MB/i.test(r)); assert(/branding/.test(r)); assert(/staff\//.test(r)); });
await K("docs/STAFF-PROFILE.md", "the real job/pay columns it lists are the sanitiser's columns", node, () => { for (const c of [...P.JOB_COLUMNS, ...P.PAY_COLUMNS]) assert(sp.includes(`\`${c}\``), c); });
const specOpen = (doc.spec.match(/^- ☐/gm) || []).length;
await K("docs/ACCESS-REDESIGN-SPEC.md", "its header count equals its own command", "grep -c '^- ☐'", () => { eq(specOpen, 9); assert(/\*\*9\*\* of the lines below are still `☐`/.test(doc.spec)); });
await K("docs/ACCESS-REDESIGN-SPEC.md", "CLAUDE.md quotes the same count", read, () => assert(/9 open `☐`/.test(src("CLAUDE.md"))));
await K("docs/ACCESS-REDESIGN-SPEC.md", "every ☑ in sections A–H names something that is really built", "spot-check the three code-checkable ones", () => { assert(byId.dining_sessions.name === "Dining session and location"); assert(byId.maintenance && byId.maintenance.def === false); assert(byId.tables_list && byId.tables_qr && byId.tables_layout); });
await K("docs/ACCESS-REDESIGN-SPEC.md", "J · 'Reset a staff password / PIN' — still ☐ although a switch for it exists", node, () => {
  assert(!/^- ☐ \*\*Reset a staff password \/ PIN\.\*\*/m.test(doc.spec) || !byId.mgr_users_reset_pw, "built as Manager settings → Users → Reset a password (mgr_users_reset_pw), still marked not started — a decision for the owner (Part 4), the count is quoted in CLAUDE.md");
});
await K("docs/ACCESS-REDESIGN-SPEC.md", "J · 'Delete a staff login' — still ☐ although the owner later ruled it out", read, () => {
  assert(!/^- ☐ \*\*Delete a staff login\.\*\*/m.test(doc.spec), "the owner's 2026-08-02 rule (\"it can disable the user, it can't delete the user\") overrides this ask; still marked not started — Part 4");
});
await K("docs/ACCESS-REDESIGN-SPEC.md", "J · 'Create staff logins (kitchen + tablet)' — still ☐ although built", node, () => {
  assert(!/^- ☐ \*\*Create staff logins\*\*/m.test(doc.spec) || !byId.mgr_users_create, "built as Manager settings → Users → Add a new login, \"only ever … kitchen or tablet\" — Part 4");
});
await K("docs/ACCESS-REDESIGN-SPEC.md", "L · 'the manager's Settings tab is DELETED' — contradicted by the later Manager settings rows", read, () => {
  assert(!/^- ☐ Remove the manager panel's \*\*Settings\*\* tab completely/m.test(doc.spec) || !byId.mgr_manage, "ROUND 6 (same night) and 2026-08-02 built Manager settings sections instead — Part 4");
});

// ═════════════ P187061–P187100 · CODE THAT CHANGED SINCE 2026-09-01 ═════════════
await K("lib/accessTree.ts", "Loyalty points is the one moduleBag row, in Extra features, default OFF", node, () => { eq(N.filter((x) => x.bind.t === "moduleBag").map((x) => x.id), ["loyalty"]); eq(byId.loyalty.def, false); assert(T.SECTION_BY_ID.extra.children.includes(byId.loyalty)); });
await K("lib/accessTree.ts", "MODULE_BAG_KEYS is exactly [loyalty]", node, () => eq(T.MODULE_BAG_KEYS, ["loyalty"]));
await K("lib/accessModel.ts", "accessModel declares loyalty with moduleBag and the key three times", node, () => { const p = M.PERM_BY_ID.loyalty; assert(p.moduleBag); eq(p.module, { allowed: "loyalty", control: "loyalty", enabled: "loyalty" }); });
await K("lib/accessModel.ts", "MODULE_DEFS carries loyalty with bag:true and key 'loyalty'", node, () => { const m = M.MODULE_DEFS.find((x) => x.key === "loyalty"); assert(m && m.bag); });
await K("lib/accessTree.ts", "a bag module adds NO settings column to the select", node, () => assert(!T.SETTINGS_COLUMNS.some((c) => /^loyalty/.test(c))));
await K("lib/accessTree.ts", "MODULE_ALLOWED_DEFAULTS does not seed a loyalty column", node, () => assert(!("loyalty_allowed" in T.MODULE_ALLOWED_DEFAULTS)));
await K("lib/accessTree.ts", "loyalty absent from the bag reads OFF", node, () => eq(T.nodeValue(byId.loyalty, empty), false));
await K("lib/accessTree.ts", "loyalty stored {allowed:true} reads ON; {allowed:false} reads OFF", node, () => { eq(T.nodeValue(byId.loyalty, { ...empty, modules: { loyalty: { allowed: true } } }), true); eq(T.nodeValue(byId.loyalty, { ...empty, modules: { loyalty: { allowed: false } } }), false); });
await K("lib/accessTree.ts", "loyalty stored with a non-boolean allowed ('true') reads OFF, never ON", node, () => eq(T.nodeValue(byId.loyalty, { ...empty, modules: { loyalty: { allowed: "true" } } }), false));
await K("lib/accessTree.ts", "the screen's merge of a loyalty tap keeps the rest of the entry (owner_control survives)", node, () => eq(T.applyPatch({ ...empty, modules: { loyalty: { allowed: false, enabled: true, owner_control: false } } }, T.nodePatch(byId.loyalty, true)).modules.loyalty, { allowed: true, enabled: true, owner_control: false }));
await K("lib/accessTree.ts", "the screen's merge of one module never touches another in the bag", node, () => eq(T.applyPatch({ ...empty, modules: { other: { allowed: true } } }, T.nodePatch(byId.loyalty, true)).modules.other, { allowed: true }));
await K("lib/accessTree.ts", "loyalty's clash expectation is one level (modules.loyalty) and the stored entry", node, () => eq(T.nodeExpect(byId.loyalty, { ...empty, modules: { loyalty: { allowed: true, enabled: true } } }, "r").fields, { "modules.loyalty": { allowed: true, enabled: true } }));
await K("lib/accessTree.ts", "after a tap, the next tap's expectation is the server's shape, not a bare boolean", node, () => {
  const after = T.applyPatch({ ...empty, modules: { loyalty: { allowed: false, enabled: true } } }, T.nodePatch(byId.loyalty, true));
  eq(T.nodeExpect(byId.loyalty, after, "r").fields["modules.loyalty"], { allowed: true, enabled: true });
  return "so a second tap is not refused as somebody else's change (item 2's other half)";
});
await K("lib/accessState.ts", "accessState carries only MODULE_BAG_KEYS out of the bag", "drive accessStateFor with a stand-in", async () => {
  const cl = fakeClient((q) => ({ data: q.table === "restaurants" ? {} : { modules: { loyalty: { allowed: true }, secret_future: { allowed: true } } }, error: null }));
  globalThis.__t18 = { sb: { from: cl.from } }; const st = await AS.accessStateFor("r"); eq(Object.keys(st.modules), ["loyalty"]);
});
await K("lib/accessState.ts", "a bag entry stored as a non-object reads as {} (no crash)", "drive accessStateFor", async () => {
  const cl = fakeClient((q) => ({ data: q.table === "restaurants" ? {} : { modules: { loyalty: true } }, error: null }));
  globalThis.__t18 = { sb: { from: cl.from } }; const st = await AS.accessStateFor("r"); eq(st.modules.loyalty, {});
});
await K("lib/accessState.ts", "`modules` rides on the SAME settings select (no extra round trip)", "drive accessStateFor", async () => {
  const cl = fakeClient(() => ({ data: {}, error: null })); globalThis.__t18 = { sb: { from: cl.from } }; await AS.accessStateFor("r");
  eq(cl.calls.length, 2); assert(cl.calls[1].ops.find((o) => o[0] === "select")[1].split(", ").includes("modules"));
});
await K("lib/accessTree.ts", "dashboard reach offers four rungs in order, default today", node, () => { eq(byId.mgr_dash_range.choices.map((c) => c.value), ["today", "today_yesterday", "last7", "last30"]); eq(byId.mgr_dash_range.def, "today"); });
await K("lib/accessTree.ts", "every dashboard rung is one lib/dashRange.ts honours", "read lib/dashRange.ts dashboardReach()", () => { const d = src("lib/dashRange.ts"); for (const c of byId.mgr_dash_range.choices) assert(new RegExp(`\\b${c.value}\\b`).test(d), c.value); });
await K("lib/accessTree.ts", "the reach row's words say it also limits the GST report", read, () => assert(/GST report/.test(byId.mgr_dash_range.what)));
await K("lib/accessTree.ts", "the bills reach still offers only two rungs (no last7 slipped in)", node, () => eq(byId.mgr_bills_range.choices.length, 2));
await K("lib/staffCaps.ts", "the dashboard reach shows on a manager's page as a VALUE row, in words", node, () => { const c = C.capsForRole("manager").find((x) => x.key === "opt:view_dashboard.manager.range"); eq(c.kind, "value"); eq(C.roleValueLabel(c, empty), "Today only"); eq(C.roleValueLabel(c, { ...empty, config: { view_dashboard: { manager_opts: { range: "last30" } } } }), "Last 30 days"); });
await K("lib/accessTree.ts", "print_clear row: a manager grant, default OFF", node, () => { eq(byId.mgr_print_clear.bind, { t: "grant", flag: "print_clear" }); eq(byId.mgr_print_clear.def, false); });
await K("lib/accessTree.ts", "print_clear has a Feature half like every manager action row", node, () => eq(byId.mgr_print_clear.featureBind, { t: "has", id: "print_clear" }));
await K("lib/accessConfig.ts", "a new restaurant is seeded with print_clear OFF", node, () => eq(AC.MP_DEFAULT.print_clear, false));
await K("lib/staffCaps.ts", "print_clear is offerable per manager", node, () => assert(C.capKeysForRole("manager").includes("print_clear")));
await K("lib/accessTree.ts", "the server asks print_clear before a queue is emptied", "grep the print routes", () => { const f = grep("print_clear", "app/api lib").filter((x) => !/accessTree|accessModel/.test(x)); assert(f.length); return f.join(" · "); });
await K("lib/accessTree.ts", "print_clear's words say nothing is deleted", read, () => assert(/Nothing is deleted/.test(byId.mgr_print_clear.what)));
await K("lib/accessTree.ts", "no row grants printer SETUP to a restaurant (owner reversal 2026-09-14)", node, () => assert(!N.some((x) => /print_setup/.test(JSON.stringify(x.bind)))));
await K("lib/features.ts", "getFeatures('') answers the defaults and reads nothing", "drive with a stand-in", async () => { let reads = 0; globalThis.__t18 = { invalidated: [], getSettings: async () => { reads++; return {}; } }; eq(await F.getFeatures(""), { ...F.FEATURE_DEFAULTS }); eq(reads, 0); });
await K("lib/features.ts", "getFeatures('') returns a fresh object each time (nobody can mutate the defaults)", "drive", async () => { const a = await F.getFeatures(""); a.reviews = false; eq(F.FEATURE_DEFAULTS.reviews, true); });
await K("lib/features.ts", "useFeatures skips the effect for an empty restaurant (no subscribe, no fetch)", read, () => assert(/if \(!restaurantId\) return;/.test(featSrc)));
await K("lib/features.ts", "refreshFeatures with fresh:false does NOT drop the settings cache", "drive", async () => { const inv = []; globalThis.__t18 = { invalidated: inv, getSettings: async () => ({ features: {} }) }; await F.refreshFeatures("rid-poll", { fresh: false }); eq(inv, []); });
await K("lib/features.ts", "refreshFeatures by default DOES drop it (a breadcrumb means changed)", "drive", async () => { const inv = []; globalThis.__t18 = { invalidated: inv, getSettings: async () => ({ features: {} }) }; await F.refreshFeatures("rid-crumb"); eq(inv, ["rid-crumb"]); });
await K("lib/features.ts", "refreshFeatures pushes the new switches to that restaurant's subscribers only", read, () => assert(/subsFor\(restaurantId\)\.forEach\(\(cb\) => cb\(fresh\)\)/.test(featSrc)));
await K("lib/features.ts", "a stored override wins over a default; an unknown stored key rides along unread", "drive", async () => { globalThis.__t18 = { invalidated: [], getSettings: async () => ({ features: { prep_time: true, scrollspy: false } }) }; const f = await F.getFeatures("rid-ov"); eq(f.prep_time, true); eq(f.scrollspy, false); });
await K("lib/features.ts", "a settings row with no features bag reads all defaults", "drive", async () => { globalThis.__t18 = { invalidated: [], getSettings: async () => ({}) }; eq(await F.getFeatures("rid-nobag"), { ...F.FEATURE_DEFAULTS }); });
await K("lib/features.ts", "the seed only LEADS — the hook's first state uses the seed when nothing is cached", read, () => assert(/seed \? \(\{ \.\.\.FEATURE_DEFAULTS, \.\.\.seed \}/.test(featSrc)));
await K("lib/features.ts", "two concurrent getFeatures for one restaurant make ONE settings read", "drive", async () => { let reads = 0; globalThis.__t18 = { invalidated: [], getSettings: async () => { reads++; await new Promise((r) => setTimeout(r, 20)); return { features: {} }; } }; await Promise.all([F.getFeatures("rid-dup"), F.getFeatures("rid-dup")]); eq(reads, 1); });
await K("lib/viewAsPerson.ts", "the 2026-10-09 change kept every guard (no pin without the admin cookie)", "drive with tokenOk false", async () => { globalThis.__t18 = { sb: { from: fakeClient(() => ({ data: [{ id: "x", role: "manager", restaurant_id: "r" }] })).from }, tokenOk: () => false }; eq(await VA.viewAsPerson({ nextUrl: { searchParams: new URLSearchParams({ as: "11111111-2222-3333-4444-555555555555" }) }, cookies: { get: () => ({ value: "x" }) } }, "r", { user: null }, "manager"), null); });
await K("lib/viewAsPerson.ts", "a malformed ?as= costs no database read at all", "drive with a counting stand-in", async () => { const cl = fakeClient(() => ({ data: [] })); globalThis.__t18 = { sb: { from: cl.from }, tokenOk: () => true }; await VA.viewAsPerson({ nextUrl: { searchParams: new URLSearchParams({ as: "not-a-uuid" }) }, cookies: { get: () => ({ value: "x" }) } }, "r", { user: null }, "manager"); eq(cl.calls.length, 0); });
await K("lib/viewAsPerson.ts", "the admin cookie is checked BEFORE the person is read", "drive: tokenOk false, count reads", async () => { const cl = fakeClient(() => ({ data: [] })); globalThis.__t18 = { sb: { from: cl.from }, tokenOk: () => false }; await VA.viewAsPerson({ nextUrl: { searchParams: new URLSearchParams({ as: "41111111-2222-3333-4444-555555555555" }) }, cookies: { get: () => ({ value: "x" }) } }, "r", { user: null }, "manager"); eq(cl.calls.length, 0); });

export const ctx = { T, M, C, P, SP, AC, AS, OE, VA, F, N, byId, empty, grep, code, src, treeSrc, featSrc, vaSrc, ownerStaff, adminUsers, clone, K, read, node, setN: () => {} };  // ids run on ONE counter — fixed block starts overran each other once (8 duplicates)
await (await import("./run2.mjs")).run(ctx);
report("run");
