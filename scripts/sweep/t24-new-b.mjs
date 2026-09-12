// t24-new-b.mjs — sweep #8 T24, block B: what a manager is ALLOWED to do — the nine menu parts,
// the three log views, the retention lock, the delete-a-bill rule, and the discount ceiling.
import { check, nid, F } from "./t24-run.mjs";

const { src, HELPERS, GETBLK, POSTBLK_A, endpointBlock, live, needLive, J, panel } = F;
const code = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const HC = code(HELPERS);
const GC = code(GETBLK);
const SC = code(src);
const WHO = code(endpointBlock("whoami"));
const count = (t, re) => (t.match(re) || []).length;


// The nine sub-options of "Edit the menu", resolved for one role. Re-implemented HERE from the
// rule as written down, then run against the same inputs the route resolves — so a change to the
// route's own resolution shows up as a disagreement rather than as a test that moved with it.
const KEYS = ["edit_options", "add_dish", "edit_dish", "edit_price", "delete_dish", "mark_86",
  "manage_categories", "manage_filters", "edit_3d"];
check(nid(), "the nine parts of Edit-the-menu are still exactly nine, and named the same", "read MENU_PART_KEYS",
  () => {
    const i = HC.indexOf("MENU_PART_KEYS");
    const lit = HC.slice(HC.indexOf("[", i), HC.indexOf("]", i) + 1);
    const found = [...lit.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return { ok: found.length === 9 && KEYS.every((k) => found.includes(k)), note: found.join(" ") };
  });
check(nid(), "the ADMIN gets all nine, always — visible means usable", "read resolveMenuParts", () => /role === "admin" \? true/.test(HC));
check(nid(), "an owner (or any non-manager staff) gets all nine EXCEPT the 3D model", "read resolveMenuParts",
  () => /role !== "manager" \? k !== "edit_3d"/.test(HC));
check(nid(), "a manager's stored true/false wins in BOTH directions", "read resolveMenuParts",
  () => /typeof stored\?\.\[k\] === "boolean" \? stored\[k\]/.test(HC));
check(nid(), "a key nobody ever stored means the ROW'S OWN DEFAULT, not 'no'", "read resolveMenuParts",
  () => /: MENU_PART_DEFAULTS\[k\] === true/.test(HC));
check(nid(), "…which is the same resolution the Access screen draws (one source, lib/accessTree)", "read the import",
  () => /MENU_PART_DEFAULTS/.test(src) && /from "@\/lib\/accessTree"/.test(src));
check(nid(), "the 3D model defaults OFF, because attaching one writes to storage every restaurant reads", "read lib/accessTree's defaults",
  async () => { const t = await import("../../lib/accessTree.ts").catch(() => null); return t ? t.MENU_PART_DEFAULTS.edit_3d !== true : "skip: TS module cannot be imported from a plain node run"; });
check(nid(), "the nine are read ONCE per request, not re-read per question", "read menuPartsFor + menuSubAllowed",
  () => /async function menuPartsFor\([\s\S]{0,400}?maybeSingle\(\)/.test(HC) && /return \(await menuPartsFor\(g, rid\)\)\[action\] === true/.test(HC));
check(nid(), "the panel's own answer and the save path's answer come from the SAME function", "read whoami + the save gate",
  () => /const menuSub = resolveMenuParts\(/.test(WHO) && /menuSubAllowed\(g, rid,/.test(SC));
check(nid(), "the admin ALSO gets the manager's nine, marked — otherwise the console reads 'this restaurant has everything'", "read whoami",
  () => /menuSubTint: resolveMenuParts\("manager", mo\)/.test(WHO));
check(nid(), "the simulate view answers the nine as a REAL manager would be answered", "read whoami",
  () => /simulate \? "manager" : !g\.user \? "admin" : g\.user\.role === "manager" \? "manager" : "other"/.test(WHO));
for (const k of KEYS) check(nid(), `the manager panel is told about "${k}" so it can remove that control`, "drive GET /whoami live and read menuSub",
  () => needLive("whoami") || (J("whoami").menuSub && typeof J("whoami").menuSub[k] === "boolean"));
for (const k of KEYS) check(nid(), `…and the admin's marking copy carries "${k}" too`, "drive GET /whoami live and read menuSubTint",
  () => needLive("whoami") || (J("whoami").menuSubTint && typeof J("whoami").menuSubTint[k] === "boolean"));

// ── The three views of Audit & logs ────────────────────────────────────────────────────────────
for (const [part, ep, phrase] of [["removals", "audit", "view the removals record"],
  ["activity", "oplog", "view the activity log"], ["customers", "users", "view the customer log"]]) {
  check(nid(), `the "${part}" view of Audit & logs can be switched off on its own, and GET /${ep} refuses when it is`,
    "read the endpoint's own guard", () => new RegExp(`logPartAllowed\\(g, rid, "${part}"\\)\\)\\) return permDenied\\("${phrase}"\\)`).test(GC));
}
check(nid(), "ABSENT means ON for those three — no restaurant changes until an admin switches one off", "read logPartAllowed",
  () => /if \(!opts \|\| typeof opts !== "object"\) return true;\s*return opts\[part\] !== false;/.test(HC));
check(nid(), "the owner and the admin always see all three views", "read logPartAllowed", () => /if \(!u \|\| u\.role === "owner"\) return true;/.test(HC));
check(nid(), "the panel is told which of the three it gets, so it hides rather than refuses", "drive GET /whoami live",
  () => needLive("whoami") || (J("whoami").logParts && ["removals", "activity", "customers"].every((k) => typeof J("whoami").logParts[k] === "boolean")));
check(nid(), "canViewLogs is NON-BREAKING — a manager keeps the log unless it was explicitly switched off", "read canViewLogs",
  () => /if \(r\?\.manager_permissions\?\.view_logs === false\) return false;[^\n]*\n\s*return true;/.test(HC));
check(nid(), "…and a person's own override outranks the restaurant-wide grant", "read canViewLogs",
  () => /const ov = u\.permissions\?\.view_logs;[\s\S]{0,200}?if \(ov === "off"\) return false;/.test(HC));
check(nid(), "…in the same order managerCan uses, so the two cannot disagree", "read canViewLogs",
  () => HC.indexOf('const ov = u.permissions?.view_logs') < HC.indexOf('r?.manager_permissions?.view_logs === false'));

// ── Log retention — the admin LOCKS, the panel SHOWS the lock ──────────────────────────────────
check(nid(), "a real manager may never set the retention windows — it is the dial that audits them", "read canSetRetention",
  () => /retention_manager_blocked/.test(HC));
check(nid(), "the owner may, unless the admin has locked it", "read canSetRetention", () => /retention_locked/.test(HC));
check(nid(), "the Aevidine admin console is not bound by its own lock", "read canSetRetention", () => /if \(!g\.user\) return \{ ok: true, code: "" \};/.test(HC));
check(nid(), "the lock is read from app_config, the same row the admin console writes", "read retentionLock",
  () => /from\("app_config"\)\.select\("value"\)\.eq\("key", "log_retention_lock"\)/.test(HC));
check(nid(), "the lock is DELIBERATELY not cached — a freeze cannot be eventually consistent", "read retentionLock",
  () => !/cache|CACHE|ttl|TTL/.test(HC.slice(HC.indexOf("async function retentionLock"), HC.indexOf("async function retentionLock") + 500)));
check(nid(), "whoami resolves the lock ONCE, not once per question it answers", "read whoami",
  () => count(WHO, /await retentionLock\(\)/g) === 1 && /const retMay = canSetRetention\(g, retLock\)/.test(WHO));
check(nid(), "the panel repeats the server's answer instead of guessing who may edit", "drive GET /whoami live",
  () => needLive("whoami") || (J("whoami").retention && typeof J("whoami").retention.canEdit === "boolean" && typeof J("whoami").retention.locked === "boolean"));
check(nid(), "…and 'view as a manager' shows the dropdown a real manager gets, not the owner's", "read whoami",
  () => /canEdit: retMay\.ok && !simulate/.test(WHO));
check(nid(), "…and it says WHY, so the screen can print the reason instead of going quiet", "read whoami",
  () => /why: simulate \? "retention_manager_blocked" : retMay\.code/.test(WHO));

// ── A sale can be cancelled; a sale can never disappear (R27) ──────────────────────────────────
check(nid(), "nobody at the restaurant can remove a bill — not the manager, and not the owner either", "read canDeleteBill",
  () => /return !g\.user;/.test(HC.slice(HC.indexOf("async function canDeleteBill"), HC.indexOf("async function canDeleteBill") + 300)));
check(nid(), "the rejection is written ON the line someone would otherwise change (the house rule for a rejection)", "read the comment above canDeleteBill",
  () => /REJECTED \(owner, 2026-08-16\) — docs\/REJECTED-IDEAS\.md → R27/.test(HELPERS));
check(nid(), "…and no grantable 'Delete a bill' permission has been rebuilt to feed it", "read the whole route",
  () => !/"delete_bill"/.test(SC));
check(nid(), "the simulate view answers false too, so the admin's 'view as a manager' shows no delete button", "read whoami",
  () => /canDeleteBill: simulate \? false : await canDeleteBill\(g, rid\)/.test(WHO));
check(nid(), "…and the live answer for a real manager is false", "drive GET /whoami live",
  () => needLive("whoami") || J("whoami").canDeleteBill === false);

// ── The discount ceiling the modal is told about ───────────────────────────────────────────────
check(nid(), "the panel is told the person's own %-ceiling, so the modal cannot offer a number the server refuses", "read whoami",
  () => /discountCapPct: await discountCapPct\(rid, discountRole\(/.test(WHO));
check(nid(), "…measured against the NAMED person when the admin came in through a profile (?as=)", "read whoami",
  () => /discountRole\(person \? person\.role : \(g\.user \? g\.user\.role : null\)\)/.test(WHO));
check(nid(), "…and it is a number or null, never undefined, so the modal can tell 'uncapped' from 'unknown'", "drive GET /whoami live",
  () => needLive("whoami") || (J("whoami").discountCapPct === null || typeof J("whoami").discountCapPct === "number"));
check(nid(), "the SERVER check is unchanged and still decides — the ceiling sent here only stops a wasted tap", "read the discount write path",
  () => /overDiscountCap\(/.test(SC));

// ── Every grant the access model has reaches the panel ─────────────────────────────────────────
check(nid(), "the powers list is the union of the legacy flags AND every grant on the Access screen", "read whoami",
  () => /Array\.from\(new Set\(\[\.\.\.MANAGER_POWER_FLAGS, \.\.\.GRANT_FLAGS\]\)\)/.test(WHO));
check(nid(), "each power is resolved by the SAME three rungs managerCan applies, in the same order", "read whoami",
  () => /const hasFeature = cfgOn\[flag\]\?\.on !== false;[\s\S]{0,400}?effectivePowers\[flag\] = hasFeature && granted;/.test(WHO));
check(nid(), "…and the panel is told WHICH half said no, so it can name who turned it off", "read whoami",
  () => /offByAdmin\[flag\] = !hasFeature;/.test(WHO));
check(nid(), "a module that is off for this restaurant turns its capability off wherever it appears", "read whoami",
  () => /if \(!ladders\[moduleKey\(mp\)\]\?\.effective\) effectivePowers\[mp\.power\] = false;/.test(WHO));
check(nid(), "…resolved from ONE settings read for every module, not five hand-written ones", "read whoami",
  () => /const ladders = await allModuleLadders\(rid\)/.test(WHO));
check(nid(), "the person's own override is applied to the panel's answer as well as the server's", "read whoami",
  () => /if \(ov === "on" \|\| ov === "pin"\) granted = true;\s*else if \(ov === "off"\) granted = false;/.test(WHO));
check(nid(), "looking through one manager (?as=) measures THAT individual's overrides", "read whoami",
  () => /const myOv = person \? \(person\.permissions \|\| \{\}\)/.test(WHO));
check(nid(), "the ribbon's name comes from the SERVER's confirmation of the pin, never from the URL", "read whoami",
  () => /asName: personLabel\(person\)/.test(WHO));
check(nid(), "the admin sees every tab (tabsOff is empty) but is TOLD which are off (tabsTint)", "read whoami",
  () => /tabsOff: actor === "admin" \? \[\] : managerTabsOff\(/.test(WHO) && /tabsTint: managerTabsOff\(/.test(WHO));
check(nid(), "…the same for the Settings sections", "read whoami",
  () => /settingsOff: actor === "admin" \? \[\] : managerSettingsOff\(/.test(WHO) && /settingsTint: managerSettingsOff\(/.test(WHO));
check(nid(), "the FLOOR definition is the admin's alone — an owner is on the wrong side of that line", "read whoami",
  () => /isAdmin: actor === "admin"/.test(WHO));
check(nid(), "…and higherView (true for an owner) is a different question, kept separate", "read whoami",
  () => /higherView: actor === "admin" \|\| actor === "owner"/.test(WHO));
check(nid(), "how far back the Dashboard reaches is answered by the server, not chosen by the panel", "read whoami + /stats",
  () => /dashReach: dashboardReach\(r\?\.access_config\)/.test(WHO) && /clampDashRange\(new URL\(req\.url\)\.searchParams\.get\("range"\), reach\)/.test(GC));
check(nid(), "how far back the BILLS record reaches is answered the same way", "read whoami + /orders",
  () => /billsReach: billsReach\(r\?\.access_config\)/.test(WHO) && /reach = billsReach\(/.test(GC));
check(nid(), "the live panel really is handed both reaches", "drive GET /whoami live",
  () => needLive("whoami") || (["today", "today_yesterday"].includes(J("whoami").dashReach) && ["today", "today_yesterday"].includes(J("whoami").billsReach)));
check(nid(), "one entry per module-backed capability, derived — so a new module appears without a code change", "read whoami",
  () => /features: Object\.fromEntries\(PERMISSIONS\.filter\(\(mp\) => mp\.module\)/.test(WHO));
check(nid(), "…and the live answer carries table_ops, the one the panel actually reads before drawing the KOT menu", "drive GET /whoami live and grep the panel for what it reads",
  // NOT a hard-coded list of six. The route's own comment still names `parcel`, which the derived
  // set no longer contains — asserting the comment's list would fail over a key nothing reads.
  // What has to hold is that every key the PANEL asks for is answered.
  () => needLive("whoami") || (J("whoami").features && typeof J("whoami").features.table_ops === "boolean"
    && [...code(panel).matchAll(/\bw?\.?features\.([a-z_]+)/g)].map((m) => m[1]).every((k) => typeof J("whoami").features[k] === "boolean")));
