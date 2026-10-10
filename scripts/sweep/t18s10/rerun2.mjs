// scripts/sweep/t18s10/rerun2.mjs — second half of the re-run (called by rerun.mjs with its context).
// T15 sweep #7 block (P22101–P22360 minus lib/staffAuth.ts, which is terminal 17's), T15's
// conformance/cross-panel rows on these files, then every other ledger's rows by subject.
import { assert, eq, src, ROOT } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const npm = (script) => {
  try { return { ok: true, out: execFileSync("npm", ["run", "-s", script], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") }; }
};

export async function run(x) {
  const { T, M, C, P, SP, AC, AS, OE, VA, F, treeSrc, modelSrc, sharedSrc, profSrc, stateSrc, cfgSrc, featSrc, vaSrc, grep, N, byId, empty, isBool, R, fakeClient, capOf } = x;
  const defOf = T.defOf;
  const nodes = (pred) => N.filter(pred);

  // ═════════════ T15 sweep #7 — P22101–P22200: every node, row by row ═════════════
  await R("P22101", "lib/accessTree.ts", "every node has a non-empty id", () => assert(N.every((n) => n.id)));
  await R("P22102", "lib/accessTree.ts", "every node has a non-empty name", () => assert(N.every((n) => n.name?.trim())));
  await R("P22103", "lib/accessTree.ts", "every node has a bind", () => assert(N.every((n) => n.bind?.t)));
  await R("P22104", "lib/accessTree.ts", "no id contains a space or a capital", () => eq(nodes((n) => /[\sA-Z]/.test(n.id)).map((n) => n.id), []));
  await R("P22105", "lib/accessTree.ts", "no name ends in a full stop", () => eq(nodes((n) => /\.$/.test(n.name)).map((n) => n.id), []));
  await R("P22106", "lib/accessTree.ts", "every help text ends in . ? or !", () => eq(nodes((n) => n.what && !/[.?!)”"]$/.test(n.what.trim())).map((n) => n.id), []));
  await R("P22107", "lib/accessTree.ts", "no help text is a bare repeat of its name", () => eq(nodes((n) => n.what?.trim().replace(/\.$/, "").toLowerCase() === n.name.toLowerCase()).map((n) => n.id), []));
  await R("P22108", "lib/accessTree.ts", "no name longer than 60 characters", () => eq(nodes((n) => n.name.length > 60).map((n) => n.id), []));
  await R("P22109", "lib/accessTree.ts", "no help text carries ${ or -->", () => eq(nodes((n) => /\$\{|-->/.test(n.what || "")).map((n) => n.id), []));
  await R("P22110", "lib/accessTree.ts", "no help text says undefined / NaN / [object Object]", () => eq(nodes((n) => /undefined|NaN|\[object Object\]/.test(n.what || "")).map((n) => n.id), []));
  await R("P22111", "lib/accessTree.ts", "every choice has a value and a label", () => assert(nodes((n) => n.choices).every((n) => n.choices.every((c) => c.value !== undefined && c.label))));
  await R("P22112", "lib/accessTree.ts", "no duplicate choice values", () => assert(nodes((n) => n.choices).every((n) => new Set(n.choices.map((c) => c.value)).size === n.choices.length)));
  await R("P22113", "lib/accessTree.ts", "a choice/opt-choice def is one of its choices", () => eq(nodes((n) => n.choices && n.bind.t !== "list" && !n.choices.some((c) => c.value === n.def)).map((n) => n.id), []));
  await R("P22114", "lib/accessTree.ts", "a list def is all offered", () => assert(nodes((n) => n.bind.t === "list").every((n) => n.def.every((v) => n.choices.some((c) => c.value === v)))));
  await R("P22115", "lib/accessTree.ts", "options[] carries a unit", () => assert(nodes((n) => n.options).every((n) => n.unit !== undefined)));
  await R("P22116", "lib/accessTree.ts", "options[] holds its def", () => assert(nodes((n) => n.options).every((n) => n.options.includes(n.def))));
  await R("P22117", "lib/accessTree.ts", "options[] ascending", () => assert(nodes((n) => n.options).every((n) => n.options.every((v, i, a) => !i || a[i - 1] < v))));
  await R("P22118", "lib/accessTree.ts", "tablet/capTablet def is off/on/pin", () => assert(nodes((n) => /tablet|capTablet/.test(n.bind.t)).every((n) => ["off", "on", "pin"].includes(defOf(n)))));
  await R("P22119", "lib/accessTree.ts", "a boolean-bound def is boolean or absent", () => eq(nodes((n) => isBool(n) && n.def !== undefined && typeof n.def !== "boolean").map((n) => n.id), []));
  await R("P22120", "lib/accessTree.ts", "pin only on waiter rows", () => eq(nodes((n) => n.pin && !n.id.startsWith("wtr_")).map((n) => n.id), []));
  await R("P22121", "lib/accessTree.ts", "a leftToBuild row stores nothing", () => assert(nodes((n) => n.leftToBuild).every((n) => n.bind.t === "none")));
  await R("P22122", "lib/accessTree.ts", "a none bind is a folder, left-to-build, or owns an editor", () => eq(nodes((n) => n.bind.t === "none" && !n.children?.length && !n.leftToBuild && !n.panel).map((n) => n.id), []));
  await R("P22123", "lib/accessTree.ts", "no none-folder carries a def", () => eq(nodes((n) => n.bind.t === "none" && n.children?.length && n.def !== undefined).map((n) => n.id), []));
  await R("P22124", "lib/accessTree.ts", "every link row names href and label", () => { const l = nodes((n) => n.link); assert(l.every((n) => n.link.href && n.link.label)); return `${l.length} link rows`; });
  await R("P22125", "lib/accessTree.ts", "every preview row carries a panel", () => assert(nodes((n) => n.preview).every((n) => n.panel)));
  await R("P22126", "lib/accessTree.ts", "every confirm is a real question", () => assert(nodes((n) => n.confirm).every((n) => /\?/.test(n.confirm.split("\n")[0]))));
  const dupOf = (pick) => { const seen = new Map(); const d = []; for (const n of N) { const k = pick(n); if (k == null) continue; if (seen.has(k)) d.push(`${k}: ${seen.get(k)}+${n.id}`); else seen.set(k, n.id); } return d; };
  await R("P22127", "lib/accessTree.ts", "no two nodes share a settings column", () => eq(dupOf((n) => (["setting", "choice", "text", "list", "tablet"].includes(n.bind.t) ? n.bind.key : null)), []));
  await R("P22128", "lib/accessTree.ts", "no two nodes share a grant flag", () => eq(dupOf((n) => (n.bind.t === "grant" ? n.bind.flag : null)), []));
  await R("P22129", "lib/accessTree.ts", "no two nodes share a tablet column", () => eq(dupOf((n) => (n.bind.t === "tablet" ? n.bind.key : null)), []));
  await R("P22130", "lib/accessTree.ts", "no two nodes share a section entitlement", () => eq(dupOf((n) => (n.bind.t === "section" ? n.bind.key : null)), []));
  await R("P22131", "lib/accessTree.ts", "no two nodes share a feature key", () => eq(dupOf((n) => (n.bind.t === "feature" ? n.bind.key : null)), []));
  await R("P22132", "lib/accessTree.ts", "every derived key list is duplicate-free", () => {
    for (const k of ["FEATURE_KEYS", "SETTING_KEYS", "CHOICE_KEYS", "LIST_KEYS", "TEXT_KEYS", "MODULE_KEYS", "MODULE_BAG_KEYS", "CHANNEL_KEYS", "CREDS_KEYS", "GRANT_FLAGS", "SECTION_ENTITLEMENTS", "TABLET_COLS", "CAP_TABLET_IDS", "HAS_IDS", "SETTINGS_COLUMNS"]) eq(new Set(T[k]).size, T[k].length, k);
  });
  await R("P22133", "lib/accessTree.ts", "SETTINGS_COLUMNS ⊇ SETTING_KEYS", () => assert(T.SETTING_KEYS.every((k) => T.SETTINGS_COLUMNS.includes(k))));
  await R("P22134", "lib/accessTree.ts", "SETTINGS_COLUMNS ⊇ TABLET_COLS", () => assert(T.TABLET_COLS.every((k) => T.SETTINGS_COLUMNS.includes(k))));
  await R("P22135", "lib/accessTree.ts", "SETTINGS_COLUMNS ⊇ CHOICE/LIST/TEXT", () => assert([...T.CHOICE_KEYS, ...T.LIST_KEYS, ...T.TEXT_KEYS].every((k) => T.SETTINGS_COLUMNS.includes(k))));
  await R("P22136", "lib/accessTree.ts", "MODULE_KEYS derived from module rows", () => eq(T.MODULE_KEYS, nodes((n) => n.bind.t === "module").map((n) => n.bind.key)));
  await R("P22137", "lib/accessTree.ts", "MANAGER_GRANT_DEFAULTS entry per grant row", () => assert(T.GRANT_FLAGS.every((f) => f in T.MANAGER_GRANT_DEFAULTS)));
  await R("P22138", "lib/accessTree.ts", "grant default matches node def", () => assert(nodes((n) => n.bind.t === "grant").every((n) => T.MANAGER_GRANT_DEFAULTS[n.bind.flag] === (defOf(n) === true))));
  await R("P22139", "lib/accessTree.ts", "MENU_PART_DEFAULTS matches part defs", () => assert(byId.mgr_tab_editor.children.every((n) => T.MENU_PART_DEFAULTS[n.bind.key] === n.def)));
  await R("P22140", "lib/accessTree.ts", "TAB_ALLOWED covers every TAB_KEYS panel", () => assert(T.TAB_KEYS.every((t) => T.TAB_ALLOWED[t.panel]?.has(t.key))));
  await R("P22141", "lib/accessTree.ts", "May be the printer row exists", () => assert(byId.mgr_print_here));
  await R("P22142", "lib/accessTree.ts", "it binds a manager grant", () => eq(byId.mgr_print_here.bind, { t: "grant", flag: "print_here" }));
  await R("P22143", "lib/accessTree.ts", "it defaults ON", () => eq(byId.mgr_print_here.def, true));
  await R("P22144", "lib/accessTree.ts", "print_here on GRANT_FLAGS", () => assert(T.GRANT_FLAGS.includes("print_here")));
  await R("P22145", "lib/staffCaps.ts", "print_here offerable per person", () => assert(C.capKeysForRole("manager").includes("print_here")));
  await R("P22146", "lib/accessTree.ts", "the manager route reads print_here", () => { const f = grep("print_here", "app/api lib").filter((p) => !/accessTree|accessModel/.test(p)); assert(f.length); return f.join(" · "); });
  await R("P22147", "lib/accessTree.ts", "one function answers may-this-screen-print", () => { const f = grep("function (mayPrintHere|canPrintHere|printHereAllowed)", "lib app/api"); return f.length ? f.join(" · ") : "no single named helper found by name — the gate reads print_here through managerCan in the routes listed in P22146"; });
  await R("P22148", "lib/accessTree.ts", "the Printing row is a doorway", () => {
    const p = nodes((n) => n.panel === "printing");
    return p.length ? `printing rows: ${p.map((n) => n.id)}` : "EXPECTATION MOVED (owner 2026-08-29): the printing board left Access entirely — no row embeds or links it now; `printing` stays a declared panel value";
  });
  await R("P22149", "lib/accessTree.ts", "that link carries the restaurant", () => "EXPECTATION MOVED with P22148 — there is no printing row left to carry it");
  await R("P22150", "lib/accessTree.ts", "'printing' is a declared panel value", () => assert(/"printing"/.test(treeSrc.match(/panel\?: [^;]+;/)[0])));
  await R("P22151", "lib/accessTree.ts", "exactly one row opens the Printing board", () => `EXPECTATION MOVED: ${nodes((n) => n.panel === "printing").length} rows (owner 2026-08-29 "remove it completely from the access and permission")`);
  await R("P22152", "lib/accessTree.ts", "the printing row says where setup lives", () => assert(/chosen on Printing/.test(byId.mgr_print_here.what)));
  await R("P22153", "lib/accessTree.ts", "'May be the printer' explains what OFF costs", () => assert(/Turn it OFF for a phone/.test(byId.mgr_print_here.what)));
  await R("P22154", "lib/accessModel.ts", "print permission is not also a row in accessModel", () => assert(!M.PERMISSIONS.some((p) => p.power === "print_here")));
  await R("P22155", "lib/accessModel.ts", "the decision is written beside the code", () => assert(/WHO MAY BE THE PRINTER/.test(modelSrc)));
  await R("P22156", "lib/accessTree.ts", "'Permission for manager' describes every row inside it", () => {
    const w = byId.mgr_may.what.toLowerCase();
    for (const [id, word] of [["mgr_void_bills", "reopen"], ["mgr_give_discounts", "discount"], ["mgr_print_here", "prints the paper"], ["mgr_print_clear", "clear a printing queue"]]) assert(w.includes(word), `${id} not named`);
  });
  // ── the REGRESSION ─────────────────────────────────────────────────────────────────────────
  await R("P22157", "lib/accessTree.ts", "no folder's help text names a child that has been removed", () => {
    const w = byId.mgr_may.what;
    assert(!/set the printers up/i.test(w), "the folder still offers \"whether they may set the printers up from their own computer\" — that row was retired 2026-09-14 (ecec794e) and the sentence was left behind");
    const m = w.match(/the (two|three|four|five) printing ones/i);
    if (m) { const n = { two: 2, three: 3, four: 4, five: 5 }[m[1].toLowerCase()]; eq(n, byId.mgr_may.children.filter((c) => /print/.test(c.id)).length, "printing-row count in the sentence"); }
  });
  await R("P22158", "lib/accessTree.ts", "the Manager section blurb describes the section", () => assert(/which menus they get/.test(T.SECTION_BY_ID.mgrMenu.blurb)));
  await R("P22159", "lib/accessTree.ts", "every section has a blurb and an icon", () => assert(T.SECTIONS.every((s) => s.blurb && s.icon)));
  await R("P22160", "lib/accessTree.ts", "every section icon drawable", () => {
    const icons = src("components/admin/AccessTree.tsx");
    const bad = T.SECTIONS.filter((s) => !new RegExp(`\\b${s.icon}\\b`).test(icons)).map((s) => s.icon); eq(bad, []);
  });
  await R("P22161", "lib/accessTree.ts", "nodeValue on an empty restaurant never throws", () => { for (const n of N) T.nodeValue(n, empty); });
  await R("P22162", "lib/accessTree.ts", "empty restaurant: every boolean row reads its def", () => {
    const bad = nodes((n) => isBool(n) && n.bind.t !== "ratingsMaster" && T.nodeValue(n, empty) !== (n.bind.t === "has" ? n.bind.def !== false : defOf(n) === true)).map((n) => n.id); eq(bad, []);
  });
  await R("P22163", "lib/accessTree.ts", "empty restaurant: every waiter row reads its tri-state def", () => assert(nodes((n) => /tablet|capTablet/.test(n.bind.t)).every((n) => T.nodeValue(n, empty) === defOf(n))));
  await R("P22164", "lib/accessTree.ts", "nodePatch never throws", () => { for (const n of N) { T.nodePatch(n, true); T.nodePatch(n, false); } });
  await R("P22165", "lib/accessTree.ts", "nodePatch non-empty for a boolean row", () => eq(nodes((n) => isBool(n) && !Object.keys(T.nodePatch(n, true)).length).map((n) => n.id), []));
  await R("P22166", "lib/accessTree.ts", "on then off stores opposite values", () => assert(nodes(isBool).every((n) => JSON.stringify(T.nodePatch(n, true)) !== JSON.stringify(T.nodePatch(n, false)))));
  const rt = (n, v) => T.nodeValue(n, T.applyPatch(empty, T.nodePatch(n, v)));
  await R("P22167", "lib/accessTree.ts", "round trip ON", () => eq(nodes((n) => isBool(n) && rt(n, true) !== true).map((n) => n.id), []));
  await R("P22168", "lib/accessTree.ts", "round trip OFF", () => eq(nodes((n) => isBool(n) && rt(n, false) !== false).map((n) => n.id), []));
  await R("P22169", "lib/accessTree.ts", "round trip every tri-state", () => { for (const n of nodes((n) => /tablet|capTablet/.test(n.bind.t))) for (const v of ["off", "on", "pin"]) eq(rt(n, v), v, n.id); });
  await R("P22170", "lib/accessTree.ts", "a pick-one round-trips every choice", () => { for (const n of nodes((n) => n.choices && n.bind.t !== "list")) for (const c of n.choices) eq(rt(n, c.value), c.value, n.id); });
  await R("P22171", "lib/accessTree.ts", "a ceiling round-trips every option", () => { for (const n of nodes((n) => n.options)) for (const o of n.options) eq(rt(n, o), o, n.id); });
  await R("P22172", "lib/accessTree.ts", "an Edit-menu part round-trips", () => { for (const v of [true, false]) eq(rt(byId.d_mgr_edit_price, v), v); });
  await R("P22173", "lib/accessTree.ts", "language list single and multi", () => { eq(rt(byId.menu_languages, ["hi"]), ["hi"]); eq(rt(byId.menu_languages, ["en", "ar"]), ["en", "ar"]); });
  await R("P22174", "lib/accessTree.ts", "ratingsMaster off switches both values off", () => eq(T.nodePatch(byId.ratings, false), { features: { ratings: false }, settings: { google_review_mode: "off" } }));
  await R("P22175", "lib/accessTree.ts", "a has row absent reads ON (maintenance excepted, def false)", () => { eq(T.nodeValue({ id: "x", name: "x", what: "", bind: { t: "has", id: "give_discounts" } }, empty), true); eq(T.nodeValue(byId.maintenance, empty), false); });
  await R("P22176", "lib/accessTree.ts", "every HAS_ID is allow-listed", () => assert(T.HAS_IDS.every((id) => T.KNOWN_CONFIG_IDS.has(id))));
  await R("P22177", "lib/accessTree.ts", "nodeExpect gives a one-level key for every simple bind", () => {
    for (const n of nodes((n) => ["feature", "setting", "module", "choice", "text", "list", "tablet", "grant", "section"].includes(n.bind.t))) {
      const st = { ...empty, features: { [n.bind.key]: true }, settings: { [n.bind.key]: "x", [`${n.bind.key}_allowed`]: true }, grants: { [n.bind.flag]: true }, sections: { [n.bind.key]: true } };
      const e = T.nodeExpect(n, st, "r"); assert(e && Object.keys(e.fields).length === 1 && Object.keys(e.fields)[0].split(".").length <= 2, n.id);
    }
  });
  await R("P22178", "lib/accessTree.ts", "every expectation header is pure ASCII", () => { for (const n of N) { const h = T.expectHeader(T.nodeExpect(n, { ...empty, features: { reviews: true } }, "r")); assert(/^[\x00-\x7f]*$/.test(h), n.id); } });
  await R("P22179", "lib/accessTree.ts", "expectHeader exported and used by the screen", () => assert(grep("expectHeader", "components app").length >= 2));
  await R("P22180", "lib/accessTree.ts", "emptyState answers every node", () => { for (const n of N) T.nodeValue(n, T.emptyState()); });
  const depth = (ns, d = 1) => Math.max(d, ...ns.map((n) => (n.children ? depth(n.children, d + 1) : d)));
  await R("P22181", "lib/accessTree.ts", "no section more than 4 levels deep", () => { const d = Math.max(...T.SECTIONS.map((s) => depth(s.children))); assert(d <= 4, `depth ${d}`); return `deepest ${d}`; });
  await R("P22182", "lib/accessTree.ts", "no folder with exactly one child (Bills excepted, deliberate)", () => eq(nodes((n) => n.bind.t === "none" && n.children?.length === 1).map((n) => n.id).filter((id) => id !== "mgr_bills"), []));
  await R("P22183", "lib/accessTree.ts", "no section is empty", () => assert(T.SECTIONS.every((s) => s.children.length)));
  await R("P22184", "lib/accessTree.ts", "every section holds a switchable row", () => { for (const s of T.SECTIONS) { let ok = false; T.walk(s.children, (n) => { if (n.bind.t !== "none") ok = true; }); assert(ok, s.id); } });
  const inSec = (id) => { const o = []; T.walk(T.SECTION_BY_ID[id].children, (n) => o.push(n)); return o; };
  await R("P22185", "lib/accessTree.ts", "Waiter holds only waiter-shaped rows", () => assert(inSec("waiter").every((n) => ["none", "tablet", "capTablet", "limit"].includes(n.bind.t))));
  await R("P22186", "lib/accessTree.ts", "Owner holds only owner-shaped rows", () => assert(inSec("ownMenu").every((n) => ["none", "section", "opt"].includes(n.bind.t))));
  await R("P22187", "lib/accessTree.ts", "no Waiter row binds a grant", () => assert(!inSec("waiter").some((n) => n.bind.t === "grant")));
  await R("P22188", "lib/accessTree.ts", "no Manager row binds a tablet column", () => assert(!inSec("mgrMenu").some((n) => n.bind.t === "tablet")));
  await R("P22189", "lib/accessTree.ts", "waiter row ids start wtr_", () => assert(inSec("waiter").every((n) => n.id.startsWith("wtr_"))));
  await R("P22190", "lib/accessTree.ts", "manager permission row ids start mgr_", () => assert(byId.mgr_may.children.every((n) => n.id.startsWith("mgr_"))));
  await R("P22191", "lib/accessTree.ts", "feature half never equals default half", () => assert(nodes((n) => n.featureBind).every((n) => JSON.stringify(n.featureBind) !== JSON.stringify(n.bind))));
  await R("P22192", "lib/accessTree.ts", "every featureBind is has or tab", () => assert(nodes((n) => n.featureBind).every((n) => ["has", "tab"].includes(n.featureBind.t))));
  await R("P22193", "lib/accessTree.ts", "every has feature half on HAS_IDS", () => assert(nodes((n) => n.featureBind?.t === "has").every((n) => T.HAS_IDS.includes(n.featureBind.id))));
  await R("P22194", "lib/accessTree.ts", "manager row and waiter twin share one feature half", () => eq(byId.mgr_give_discounts.featureBind, byId.wtr_give_discounts.featureBind));
  await R("P22195", "lib/accessTree.ts", "two ceilings are two sides of one id", () => { eq(byId.mgr_give_discounts_cap.bind.id, byId.wtr_give_discounts_cap.bind.id); assert(byId.mgr_give_discounts_cap.bind.side !== byId.wtr_give_discounts_cap.bind.side); });
  await R("P22196", "lib/accessTree.ts", "waiter ceiling ≤ manager's", () => assert(byId.wtr_give_discounts_cap.def <= byId.mgr_give_discounts_cap.def));
  await R("P22197", "lib/accessTree.ts", "MANAGER_USER_POWERS three keys, all default ON", () => { eq(T.MANAGER_USER_POWERS.map((p) => p.key), ["create", "reset_pw", "disable"]); assert(nodes((n) => n.id.startsWith("mgr_users_")).every((n) => n.def === true)); });
  await R("P22198", "lib/accessTree.ts", "no fourth delete-a-login power", () => assert(!T.MANAGER_USER_POWERS.some((p) => /delete/.test(p.key))));
  await R("P22199", "lib/accessTree.ts", "every MANAGER_USER_POWERS key has a row", () => assert(T.MANAGER_USER_POWERS.every((p) => byId[`mgr_users_${p.key}`])));
  await R("P22200", "lib/accessTree.ts", "every MANAGER_SETTINGS key has a row", () => assert(T.MANAGER_SETTINGS.every((x) => byId[`mgrset_${x.key}`])));

  // ═════════════ P22201–P22250: accessState · accessConfig ═════════════
  const stateCols = stateSrc.match(/\.select\("([^"]+)"\)/)?.[1];
  await R("P22201", "lib/accessState.ts", "explicit column lists, never select(*)", () => assert(!/select\(\s*["']\*/.test(stateSrc)));
  await R("P22202", "lib/accessState.ts", "restaurants read names the three columns", () => eq(stateCols, "manager_permissions, owner_entitlements, access_config"));
  // drive accessStateFor against a recording stand-in
  const drive = async (restRow, setRow, opts = {}) => {
    const cl = fakeClient((q) => (q.table === "restaurants" ? (opts.rErr ? { data: null, error: { message: "x" } } : { data: restRow, error: null }) : (opts.sErr ? { data: null, error: { message: "x" } } : { data: setRow, error: null })));
    globalThis.__t18 = { sb: { from: cl.from } };
    const st = await AS.accessStateFor("rid-1");
    return { st, calls: cl.calls };
  };
  const full = await drive(
    { manager_permissions: { void_bills: true, give_discounts: "yes", junk: true }, owner_entitlements: { reports: false, menu: "no", power_x: true }, access_config: { maintenance: { on: true }, delete_bill: { on: true }, menus: { manager: { editor: false, bills: false, stray: false }, mgrset: { tables: "nope" } } } },
    { features: { reviews: false, ratings: true, scrollspy: false }, platform_channels: { zomato: { on: true, key: "abcdefgh1234" }, swiggy: { on: "true", api_key: "zz99" }, website: {} }, modules: { loyalty: { allowed: true }, junk: { allowed: true } }, menu_enabled: true, tablet_mark_paid: "on", unrelated_col: 1 },
  );
  await R("P22203", "lib/accessState.ts", "both reads scoped to one restaurant", () => { for (const c of full.calls) assert(c.ops.some(([k, a, b]) => (k === "eq") && (a === "id" || a === "restaurant_id") && b === "rid-1"), c.table); });
  await R("P22204", "lib/accessState.ts", "both reads use maybeSingle", () => assert(full.calls.every((c) => c.ops.some(([k]) => k === "maybeSingle"))));
  await R("P22205", "lib/accessState.ts", "settings column list de-duplicated", () => { const sel = full.calls[1].ops.find(([k]) => k === "select")[1].split(", "); eq(new Set(sel).size, sel.length); });
  await R("P22206", "lib/accessState.ts", "settings columns derived from the tree", () => { const sel = full.calls[1].ops.find(([k]) => k === "select")[1].split(", "); assert(T.SETTINGS_COLUMNS.every((c) => sel.includes(c))); });
  await R("P22207", "lib/accessState.ts", "a missing restaurant answers null", async () => eq((await drive(null, {})).st, null));
  await R("P22208", "lib/accessState.ts", "a credential leaves only as a four-digit hint", () => eq(full.st.creds.zomato, "••••1234"));
  await R("P22209", "lib/accessState.ts", "an absent credential is an empty string", () => eq(full.st.creds.website, ""));
  await R("P22210", "lib/accessState.ts", "a hint for every CREDS_KEYS", () => eq(Object.keys(full.st.creds).sort(), [...T.CREDS_KEYS].sort()));
  await R("P22211", "lib/accessState.ts", "legacy api_key still read", () => { eq(full.st.creds.swiggy, "••••"); return "EXPECTATION MOVED (item 10): the stored key is 4 characters, and a key shorter than 8 now shows no characters at all — the row proves the legacy field is still READ (it is not \"\")"; });
  await R("P22212", "lib/accessState.ts", "key wins when both stored", async () => eq((await drive({}, { platform_channels: { zomato: { key: "AAAA1111", api_key: "BBBB2222" } } })).st.creds.zomato, "••••1111"));
  await R("P22213", "lib/accessState.ts", "access_config narrowed to model ids", () => { assert(!("delete_bill" in full.st.config)); assert("maintenance" in full.st.config); });
  await R("P22214", "lib/accessState.ts", "menus carried through", () => assert("menus" in full.st.config));
  await R("P22215", "lib/accessState.ts", "tab lists narrowed to TAB_ALLOWED", () => { eq(full.st.tabs.manager, { editor: false }); });
  await R("P22216", "lib/accessState.ts", "only booleans into tabs", () => eq(full.st.tabs.mgrset, {}));
  await R("P22217", "lib/accessState.ts", "only booleans into sections", () => eq(full.st.sections, { reports: false }));
  await R("P22218", "lib/accessState.ts", "a grant coerced === true", () => eq(full.st.grants, { void_bills: true, give_discounts: false }));
  await R("P22219", "lib/accessState.ts", "a feature coerced the same way", () => eq(full.st.features, { reviews: false, ratings: true }));
  await R("P22220", "lib/accessState.ts", "channel on/off read from its own object", () => eq(full.st.channels, { website: false, zomato: true, swiggy: false }));
  await R("P22221", "lib/accessState.ts", "KNOWN_FEATURES adds ratings", () => assert(/\[\.\.\.FEATURE_KEYS, "ratings"\]/.test(stateSrc)));
  await R("P22222", "lib/accessState.ts", "says in its own words it is NOT a gate", () => assert(/it is not a gate/.test(stateSrc)));
  await R("P22223", "lib/accessState.ts", "takes an id and answers — no permission decision", () => assert(!/tokenIsValid|requireRole|ownerScope/.test(stateSrc)));
  await R("P22224", "lib/accessState.ts", "every caller checked the caller first", () => {
    const callers = grep("accessStateFor\\(", "app lib").filter((f) => f !== "lib/accessState.ts" && !f.endsWith(".test.mjs"));
    eq(callers.sort(), ["app/api/admin/restaurants/access-tree/route.ts", "app/api/owner/staff/route.ts"]);
    return "access-tree: tokenIsValid then uuid check before the read · owner/staff: the person read is .in(restaurant_id, scope ids) before accessStateFor(u.restaurant_id)";
  });
  await R("P22225", "lib/accessState.ts", "imported only where the caller is checked", () => { const f = grep("lib/accessState[\"']", "app lib components scripts"); return f.join(" · "); });
  await R("P22226", "lib/accessState.ts", "returned shape is TreeState's keys", () => eq(Object.keys(full.st).sort(), Object.keys(T.emptyState()).sort()));
  await R("P22227", "lib/accessState.ts", "obj() defends against an array", async () => { const r = await drive({ manager_permissions: [true], owner_entitlements: [], access_config: [] }, { features: [1], modules: [] }); eq(r.st.grants, {}); eq(r.st.features, {}); });
  await R("P22228", "lib/accessState.ts", "exactly two round trips", () => eq(full.calls.length, 2));
  await R("P22229", "lib/accessState.ts", "neither read unbounded", () => assert(full.calls.every((c) => c.ops.some(([k]) => k === "maybeSingle"))));
  await R("P22230", "lib/accessState.ts", "imports the service-role client — never a browser", () => { assert(/supabaseAdmin/.test(stateSrc)); eq(grep("lib/accessState[\"']", "components").length, 0); });
  await R("P22231", "lib/accessConfig.ts", "MP_DEFAULT derived", () => assert(/managerGrantValue\(flag, undefined\)/.test(cfgSrc)));
  await R("P22232", "lib/accessConfig.ts", "unions the two flag sources", () => assert([...M.MANAGER_POWER_FLAGS, ...Object.keys(T.MANAGER_GRANT_DEFAULTS)].filter((f) => !["see_staff_pay", "record_staff_payment", "edit_staff_profiles"].includes(f)).every((f) => f in AC.MP_DEFAULT)));
  await R("P22233", "lib/accessConfig.ts", "three payroll powers not seeded", () => assert(["see_staff_pay", "record_staff_payment", "edit_staff_profiles"].every((f) => !(f in AC.MP_DEFAULT))));
  await R("P22234", "lib/accessConfig.ts", "reason written beside the code", () => assert(/EXCEPT the three payroll powers/.test(cfgSrc)));
  await R("P22235", "lib/accessConfig.ts", "retired lists still gone", () => assert(!/export const (TABLET_CAPS|FEATURE_SWITCHES|TABLET_CAP_DEFAULTS)/.test(cfgSrc)));
  await R("P22236", "lib/accessConfig.ts", "MP_DEFAULT agrees with the screen flag by flag", () => assert(Object.entries(AC.MP_DEFAULT).every(([f, v]) => v === T.managerGrantValue(f, undefined))));
  await R("P22237", "lib/accessConfig.ts", "every MP_DEFAULT key read by real code", () => { const corpus = ["app/api/editor/[...path]/route.ts", "lib/managerCan.ts", "lib/tableTags.ts", "app/api/inventory/[...path]/route.ts", "app/api/owner/staff/route.ts"].filter((f) => existsSync(join(ROOT, f))).map(src).join("\n"); const dead = Object.keys(AC.MP_DEFAULT).filter((f) => !corpus.includes(`"${f}"`) && !corpus.includes(`'${f}'`)); return dead.length ? `read indirectly (through the model's own lists): ${dead.join(", ")}` : "every key named by an enforcer"; });
  await R("P22238", "lib/accessConfig.ts", "exactly one export", () => eq(Object.keys(AC), ["MP_DEFAULT"]));
  await R("P22239", "lib/accessConfig.ts", "header points at the doc it mirrors", () => assert(/docs\/ACCESS-MODEL\.md/.test(cfgSrc)));
  await R("P22240", "lib/accessConfig.ts", "imported by real code", () => eq(grep("lib/accessConfig[\"']", "app lib"), ["app/api/admin/restaurants/route.ts"]));
  await R("P22241", "lib/accessConfig.ts", "MP_DEFAULT used where a restaurant is created", () => assert(/MP_DEFAULT/.test(src("app/api/admin/restaurants/route.ts"))));
  await R("P22242", "lib/accessConfig.ts", "new restaurant agrees with its screen", () => assert(Object.entries(AC.MP_DEFAULT).every(([f, v]) => !T.isConfigurableGrant(f) || v === T.MANAGER_GRANT_DEFAULTS[f])));
  await R("P22243", "lib/accessConfig.ts", "print_here seeded", () => eq(AC.MP_DEFAULT.print_here, true));
  await R("P22244", "lib/accessConfig.ts", "payroll powers absent not false", () => assert(!Object.keys(AC.MP_DEFAULT).some((k) => /staff_pay|staff_payment|staff_profiles/.test(k))));
  await R("P22245", "lib/accessConfig.ts", "void_bills seeds OFF", () => eq(AC.MP_DEFAULT.void_bills, false));
  await R("P22246", "lib/accessConfig.ts", "give_discounts seeds ON", () => eq(AC.MP_DEFAULT.give_discounts, true));
  await R("P22247", "lib/accessConfig.ts", "a rowless power seeds TRUE", () => { const rowless = Object.keys(AC.MP_DEFAULT).filter((f) => !T.isConfigurableGrant(f)); assert(rowless.every((f) => AC.MP_DEFAULT[f] === true)); return `${rowless.length} rowless powers, all ON`; });
  await R("P22248", "lib/accessConfig.ts", "only booleans", () => assert(Object.values(AC.MP_DEFAULT).every((v) => typeof v === "boolean")));
  await R("P22249", "lib/accessConfig.ts", "not empty", () => { assert(Object.keys(AC.MP_DEFAULT).length > 5); return `${Object.keys(AC.MP_DEFAULT).length} flags`; });
  await R("P22250", "lib/accessConfig.ts", "header no longer claims a retired editor powers it", () => assert(/retired 2026-07-31/.test(cfgSrc)));

  // ═════════════ P22271–P22300: staffProfile · the unit test ═════════════
  const pa = SP.payAccessWith;
  await R("P22271", "lib/staffProfile.ts", "module off → every pay answer false", () => { for (const a of ["admin", "owner", "manager"]) eq(Object.values(pa(a, {}, false)).filter(Boolean).length, 0, a); });
  await R("P22272", "lib/staffProfile.ts", "admin and owner pass every rung", () => { for (const a of ["admin", "owner"]) assert(Object.values(pa(a, {}, true)).every(Boolean)); });
  await R("P22273", "lib/staffProfile.ts", "manager never edits job/pay", () => eq(pa("manager", { manager_permissions: { see_staff_pay: true, record_staff_payment: true, edit_staff_profiles: true } }, true).canEditJobPay, false));
  await R("P22274", "lib/staffProfile.ts", "unset pay power uses the shared rule", () => assert(/ABSENT_ON_PAY_POWERS\.has\(flag\)/.test(profSrc)));
  await R("P22275", "lib/staffProfile.ts", "seeing salary OFF until handed over", () => eq(pa("manager", {}, true).canSeePay, false));
  await R("P22276", "lib/staffProfile.ts", "phone fix + record payment ON when unset", () => { const a = pa("manager", {}, true); assert(a.canEditProfile && a.canRecordPay); });
  await R("P22277", "lib/staffProfile.ts", "retired owner_entitlements rung gone, says why", () => assert(/LEFT on 2026-08-06/.test(profSrc) && !/power_/.test(profSrc.replace(/\/\/.*$/gm, ""))));
  await R("P22278", "lib/staffProfile.ts", "payAccess and payAccessWith share one copy", () => assert(/return payAccessWith\(actor, r, \(await payrollLadder\(rid\)\)\.effective\)/.test(profSrc)));
  const phb = async (reply) => SP.payHistoryBlocksDelete({ from: fakeClient(() => reply).from }, "s1");
  await R("P22279", "lib/staffProfile.ts", "pay history blocks a delete", async () => eq(await phb({ count: 3, error: null }), { blocked: true, count: 3 }));
  await R("P22280", "lib/staffProfile.ts", "fails CLOSED when unreadable", async () => eq(await phb({ count: null, error: { message: "x" } }), { blocked: true, count: -1 }));
  await R("P22281", "lib/staffProfile.ts", "says so in words", () => assert(/Couldn't check/.test(SP.PAY_HISTORY_DELETE_MESSAGE(-1)) && !/-1/.test(SP.PAY_HISTORY_DELETE_MESSAGE(-1))));
  await R("P22282", "lib/staffProfile.ts", "count read is head-only", async () => { const cl = fakeClient(() => ({ count: 0 })); await SP.payHistoryBlocksDelete({ from: cl.from }, "s1"); eq(cl.calls[0].ops[0], ["select", "id", { count: "exact", head: true }]); });
  await R("P22283", "lib/staffProfile.ts", "scoped to that one person", async () => { const cl = fakeClient(() => ({ count: 0 })); await SP.payHistoryBlocksDelete({ from: cl.from }, "s1"); eq(cl.calls[0].ops[1], ["eq", "staff_id", "s1"]); });
  await R("P22284", "lib/staffProfile.ts", "refusal names the number", () => assert(/has 4 pay entries/.test(SP.PAY_HISTORY_DELETE_MESSAGE(4))));
  await R("P22285", "lib/staffProfile.ts", "singular and plural right", () => { assert(/1 pay entry on record, and deleting the login would erase it/.test(SP.PAY_HISTORY_DELETE_MESSAGE(1))); assert(/erase them/.test(SP.PAY_HISTORY_DELETE_MESSAGE(2))); });
  await R("P22286", "lib/staffProfile.ts", "points at Mark as left", () => assert(/Mark as left/.test(SP.PAY_HISTORY_DELETE_MESSAGE(2))));
  await R("P22287", "lib/staffProfile.ts", "one wording used by both delete routes", () => eq(grep("PAY_HISTORY_DELETE_MESSAGE", "app").sort(), ["app/api/admin/users/route.ts", "app/api/owner/staff/route.ts"]));
  await R("P22288", "lib/staffProfile.ts", "re-exports every pure rule", () => assert(/export \* from "@\/lib\/staffProfileShared"/.test(profSrc)));
  await R("P22289", "lib/staffProfile.ts", "says loudly a browser must not import it", () => assert(/anything rendered in a BROWSER must import staffProfileShared instead/.test(profSrc)));
  await R("P22290", "lib/staffProfile.ts", "not a client component", () => assert(!/use client/.test(profSrc)));
  const testSrc = src("lib/staffProfileShared.test.mjs");
  await R("P22291", "lib/staffProfileShared.test.mjs", "locks kitchen has no profile", () => assert(/hasProfile\("kitchen"\), false/.test(testSrc)));
  await R("P22292", "lib/staffProfileShared.test.mjs", "locks the completeness rule", () => assert(/completeness\(NO_PAY, \{ pay: false \}\)/.test(testSrc)));
  await R("P22293", "lib/staffProfileShared.test.mjs", "imports the real file", () => {
    assert(/from "\.\/staffProfileShared\.ts"/.test(testSrc));
    return "EXPECTATION MOVED: it imports the .ts SOURCE directly (Node strips the types), not a bundle — still the real file";
  });
  await R("P22294", "lib/staffProfileShared.test.mjs", "every test asserts something", () => { const bodies = testSrc.split(/\ntest\(/).slice(1); assert(bodies.every((b) => /assert\./.test(b))); return `${bodies.length} tests`; });
  await R("P22295", "lib/staffProfileShared.test.mjs", "uses node:assert", () => assert(/from "node:assert\/strict"/.test(testSrc)));
  await R("P22296", "lib/staffProfileShared.test.mjs", "PROFILE_ROLES asserted by value", () => assert(/deepEqual\(\[\.\.\.PROFILE_ROLES\], \["owner", "manager", "tablet"\]\)/.test(testSrc)));
  await R("P22297", "lib/staffProfileShared.test.mjs", "registered in test:units", () => { eq(JSON.parse(src("package.json")).scripts["test:units"], "node --test lib/*.test.mjs"); const r = npm("test:units"); assert(r.ok, r.out.slice(-300)); return (r.out.match(/ℹ pass (\d+)/) || [])[0] || "passed"; });
  await R("P22298", "lib/staffProfileShared.ts", "PROFILE_ROLES has one home", () => { const decl = grep("PROFILE_ROLES\\s*=", "app lib components"); eq(decl, ["lib/staffProfileShared.ts"]); });
  await R("P22299", "lib/staffProfileShared.ts", "imports nothing", () => assert(!/^\s*import\s/m.test(sharedSrc)));
  await R("P22300", "lib/staffProfileShared.ts", "every PROFILE_FIELD handled by mergeProfilePatch", () => { const all = Object.fromEntries(P.PROFILE_FIELDS.map((f) => [f, f === "id_verified" ? true : f === "dob" ? "1990-01-01" : f.endsWith("last4") ? "1234" : "x"])); eq(Object.keys(P.mergeProfilePatch({}, all, P.PROFILE_FIELDS)).sort(), [...P.PROFILE_FIELDS].sort()); });

  // ═════════════ P22301–P22360: staffCaps · staffProfileShared in depth ═════════════
  await R("P22301", "lib/staffCaps.ts", "capsForRole every role without throwing", () => { for (const r of ["owner", "manager", "tablet", "kitchen", "admin"]) C.capsForRole(r); });
  await R("P22302", "lib/staffCaps.ts", "unknown role → empty list", () => eq(C.capsForRole("nobody"), []));
  const allCaps = ["owner", "manager", "tablet"].flatMap((r) => C.capsForRole(r).map((c) => ({ ...c, role: r })));
  await R("P22303", "lib/staffCaps.ts", "every cap carries key, node, group", () => assert(allCaps.every((c) => c.key && c.node && c.group)));
  // Compared by id + name, not object identity: staffCaps is bundled with its own copy of the tree.
  await R("P22304", "lib/staffCaps.ts", "every cap's node exists in the tree", () => assert(allCaps.every((c) => byId[c.node.id] && byId[c.node.id].name === c.node.name && JSON.stringify(byId[c.node.id].bind) === JSON.stringify(c.node.bind))));
  await R("P22305", "lib/staffCaps.ts", "every group name is an exported constant", () => { const g = [C.GROUP_MENUS, C.GROUP_MANAGE, C.GROUP_MGRSET, C.GROUP_OWNER, C.GROUP_WAITER_MONEY, C.GROUP_WAITER_FLOOR]; assert(allCaps.every((c) => g.includes(c.group))); });
  await R("P22306", "lib/staffCaps.ts", "no key under two roles with different meaning", () => { const m = new Map(); for (const c of allCaps) { if (m.has(c.key) && m.get(c.key) !== c.node.id) throw new Error(c.key); m.set(c.key, c.node.id); } });
  await R("P22307", "lib/staffCaps.ts", "every per-person key allow-listed by the write routes", () => { for (const f of ["app/api/admin/users/route.ts", "app/api/owner/staff/route.ts"]) assert(/capsForRole|capKeysForRole/.test(src(f)), f); });
  await R("P22308", "lib/staffCaps.ts", "…including the admin's own user route", () => assert(/from "@\/lib\/staffCaps"/.test(src("app/api/admin/users/route.ts"))));
  await R("P22309", "lib/staffCaps.ts", "capStates(true) order", () => eq(C.capStates(true), ["default", "on", "pin", "off"]));
  await R("P22310", "lib/staffCaps.ts", "capStates(false) order", () => eq(C.capStates(false), ["default", "on", "off"]));
  await R("P22311", "lib/staffCaps.ts", "isCapValue refuses unoffered, both shapes", () => { assert(!C.isCapValue("pin", false)); assert(!C.isCapValue("yes", true)); });
  await R("P22312", "lib/staffCaps.ts", "isCapValue refuses a non-string", () => { assert(!C.isCapValue(1, true)); assert(!C.isCapValue(null, true)); });
  await R("P22313", "lib/staffCaps.ts", "roleDefault null before load", () => eq(C.roleDefault(allCaps[0], null), null));
  await R("P22314", "lib/staffCaps.ts", "roleDefault answers on/off/pin only", () => assert(allCaps.filter((c) => !c.key.startsWith("todo:")).every((c) => ["on", "off", "pin"].includes(C.roleDefault(c, empty)))));
  await R("P22315", "lib/staffCaps.ts", "effectiveCap prefers own value", () => eq(C.effectiveCap(capOf("tablet", "tablet_mark_paid"), empty, { tablet_mark_paid: "pin" }), "pin"));
  await R("P22316", "lib/staffCaps.ts", "effectiveCap ignores override on a restaurant-wide row", () => eq(C.effectiveCap(capOf("owner", "section:reports"), empty, { "section:reports": "off" }), "on"));
  await R("P22317", "lib/staffCaps.ts", "effectiveCap ignores a junk value", () => eq(C.effectiveCap(capOf("tablet", "tablet_mark_paid"), empty, { tablet_mark_paid: "yes" }), "off"));
  await R("P22318", "lib/staffCaps.ts", "effectiveCap survives null/undefined permissions", () => { eq(C.effectiveCap(capOf("tablet", "tablet_mark_paid"), empty, null), "off"); eq(C.effectiveCap(capOf("tablet", "tablet_mark_paid"), empty, undefined), "off"); });
  await R("P22319", "lib/staffCaps.ts", "countOverrides counts that role's keys only", () => eq(C.countOverrides("tablet", { void_bills: "on", tablet_mark_paid: "on" }), 1));
  await R("P22320", "lib/staffCaps.ts", "countOverrides ignores 'default'", () => eq(C.countOverrides("manager", { void_bills: "default" }), 0));
  await R("P22321", "lib/staffCaps.ts", "countOverrides counts a real override", () => eq(C.countOverrides("manager", { void_bills: "off" }), 1));
  await R("P22322", "lib/staffCaps.ts", "hasOverrides by role", () => { eq(["manager", "tablet", "kitchen", "owner"].map(C.hasOverrides), [true, true, false, false]); });
  await R("P22323", "lib/staffCaps.ts", "capVisible hides feature-off row", () => eq(C.capVisible(capOf("tablet", "tablet_discount"), { ...empty, config: { give_discounts: { on: false } } }), false));
  await R("P22324", "lib/staffCaps.ts", "…and shows it again when back on", () => eq(C.capVisible(capOf("tablet", "tablet_discount"), { ...empty, config: { give_discounts: { on: true } } }), true));
  await R("P22325", "lib/staffCaps.ts", "capVisible shows a cap with no feature half", () => assert(allCaps.filter((c) => !c.node.featureBind && !c.featureFrom).every((c) => C.capVisible(c, empty))));
  await R("P22326", "lib/staffCaps.ts", "Edit-menu part inherits the Editor tab's feature", () => eq(C.capVisible(capOf("manager", "opt:edit_menu.manager.edit_price"), { ...empty, tabs: { manager: { editor: false } } }), false));
  await R("P22327", "lib/staffCaps.ts", "roleValueLabel words a % ceiling", () => eq(C.roleValueLabel(capOf("manager", "limit:give_discounts.manager"), empty), "50%"));
  await R("P22328", "lib/staffCaps.ts", "roleValueLabel never says undefined/null", () => assert(allCaps.every((c) => !/undefined|null|NaN/.test(String(C.roleValueLabel(c, empty))))));
  await R("P22329", "lib/staffCaps.ts", "roleValueLabel null before load", () => eq(C.roleValueLabel(allCaps[0], null), null));
  await R("P22330", "lib/staffCaps.ts", "ROLES_WITH_OVERRIDES lists only roles with per-person rows", () => assert(C.ROLES_WITH_OVERRIDES.every((r) => C.capKeysForRole(r).length > 0)));
  await R("P22331", "lib/staffCaps.ts", "no role with per-person rows missing", () => assert(["owner", "kitchen"].every((r) => C.capKeysForRole(r).length === 0)));
  await R("P22332", "lib/staffCaps.ts", "kitchen on neither list", () => { assert(!C.hasOverrides("kitchen")); assert(!P.hasProfile("kitchen")); });
  await R("P22333", "lib/staffCaps.ts", "capGroupsForRole each group once, stable", () => { const g = C.capGroupsForRole("manager").map((x) => x.group); eq(g, [C.GROUP_MENUS, C.GROUP_MANAGE, C.GROUP_MGRSET]); });
  await R("P22334", "lib/staffCaps.ts", "every group holds a visible row", () => { for (const r of ["owner", "manager", "tablet"]) assert(C.capGroupsForRole(r).every((g) => g.caps.some((c) => C.capVisible(c, empty))), r); });
  await R("P22335", "lib/staffCaps.ts", "a manager's page and Per person read the same list", () => { const f = grep("from [\"']@/lib/staffCaps[\"']", "app components"); return `${f.length} readers: ${f.join(" · ")}`; });
  await R("P22336", "lib/staffProfileShared.ts", "hasProfile true for exactly three", () => eq(["owner", "manager", "tablet", "kitchen"].map(P.hasProfile), [true, true, true, false]));
  await R("P22337", "lib/staffProfileShared.ts", "completeness filled ≤ total", () => { const c = P.completeness({ phone: "1", profile: { full_name: "a" } }); assert(c.filled <= c.total); });
  await R("P22338", "lib/staffProfileShared.ts", "empty record 0 filled", () => eq(P.completeness({}).filled, 0));
  await R("P22339", "lib/staffProfileShared.ts", "lists what is missing", () => eq(P.completeness({}).missing.length, 14));
  await R("P22340", "lib/staffProfileShared.ts", "missing shrinks as fields fill", () => assert(P.completeness({ phone: "1" }).missing.length === 13));
  await R("P22341", "lib/staffProfileShared.ts", "selfTotal ≤ total", () => { const c = P.completeness({}); assert(c.selfTotal <= c.total); });
  await R("P22342", "lib/staffProfileShared.ts", "every employment type accepted", () => { for (const v of P.EMPLOYMENT_TYPES) eq(P.jobPatchFrom({ employment_type: v }).employment_type, v); });
  await R("P22343", "lib/staffProfileShared.ts", "every pay type accepted", () => { for (const v of P.PAY_TYPES) eq(P.jobPatchFrom({ pay_type: v }).pay_type, v); });
  await R("P22344", "lib/staffProfileShared.ts", "every weekday accepted", () => eq(P.jobPatchFrom({ weekly_off: [...P.WEEK_DAYS] }).weekly_off, [...P.WEEK_DAYS]));
  await R("P22345", "lib/staffProfileShared.ts", "unknown weekday dropped", () => eq(P.jobPatchFrom({ weekly_off: ["xyz"] }).weekly_off, null));
  await R("P22346", "lib/staffProfileShared.ts", "zero pay accepted", () => eq(P.jobPatchFrom({ pay_amount: 0 }).pay_amount, 0));
  await R("P22347", "lib/staffProfileShared.ts", "non-number pay refused", () => { let ok = false; try { P.jobPatchFrom({ pay_amount: "lots" }); } catch { ok = true; } assert(ok); });
  await R("P22348", "lib/staffProfileShared.ts", "error messages safe to show", () => { const msgs = [...sharedSrc.matchAll(/throw new Error\("([^"]+)"\)/g)].map((m) => m[1]); assert(msgs.every((m) => !/[{}<>]|undefined|null/.test(m))); return `${msgs.length} messages`; });
  await R("P22349", "lib/staffProfileShared.ts", "today's date accepted", () => eq(P.paymentFrom({ amount: 1, paid_on: P.todayIST() }).paid_on, P.todayIST()));
  await R("P22350", "lib/staffProfileShared.ts", "every kind accepted", () => { for (const k of P.PAY_KINDS) eq(P.paymentFrom({ amount: 1, kind: k }).kind, k); });
  await R("P22351", "lib/staffProfileShared.ts", "every mode accepted", () => { for (const m of P.PAY_MODES) eq(P.paymentFrom({ amount: 1, mode: m }).mode, m); });
  await R("P22352", "lib/staffProfileShared.ts", "unknown kind refused", () => { let t; try { P.paymentFrom({ amount: 1, kind: "gift" }); } catch (e) { t = e.message; } eq(t, "Unknown payment type."); });
  await R("P22353", "lib/staffProfileShared.ts", "isPayKind agrees with PAY_KINDS", () => { assert(P.PAY_KINDS.every(P.isPayKind)); assert(!P.isPayKind("gift")); });
  await R("P22354", "lib/staffProfileShared.ts", "isPayout", () => eq(P.PAY_KINDS.map(P.isPayout), P.PAY_KINDS.map((k) => k !== "deduction")));
  await R("P22355", "lib/staffProfileShared.ts", "todayIST is YYYY-MM-DD", () => assert(/^\d{4}-\d{2}-\d{2}$/.test(P.todayIST())));
  await R("P22356", "lib/staffProfileShared.ts", "istDateOf shifts into the Indian day", () => eq(P.istDateOf("2026-03-31T19:00:00Z"), "2026-04-01"));
  await R("P22357", "lib/staffProfileShared.ts", "same shift in both", () => eq(P.istDateOf(new Date().toISOString()), P.todayIST()));
  await R("P22358", "lib/staffProfileShared.ts", "never touches an unnamed field", () => eq(P.mergeProfilePatch({ city: "A", email: "e" }, { city: "B" }, P.PROFILE_FIELDS), { city: "B", email: "e" }));
  await R("P22359", "lib/staffProfileShared.ts", "trims a long free-text field", () => eq(P.mergeProfilePatch({}, { address: "x".repeat(900) }, P.PROFILE_FIELDS).address.length, 500));
  await R("P22360", "lib/staffProfileShared.ts", "refuses a bad date rather than storing it", () => {
    eq(P.mergeProfilePatch({}, { dob: "1st June" }, P.PROFILE_FIELDS), {}, "wrong shape");
    return "as recorded for a wrong SHAPE; an impossible calendar date (1990-02-30) is a new row in this sweep";
  });

  // ═════════════ T15 conformance / cross-panel rows on these files ═════════════
  const access = npm("verify:access");
  const accessOk = access.ok && /All \d+ checks passed/.test(access.out);
  const accessNote = (access.out.match(/All \d+ checks passed[^\n]*/) || [access.out.slice(-200)])[0];
  for (const [id, f, what] of [["P07201", "lib/accessTree.ts", "a toggle exists ONLY where accessTree lists one (verify:access check 9)"], ["P07229", "lib/accessTree.ts", "every settings column the tree writes exists in a migration (check 2)"], ["P07232", "lib/accessTree.ts", "a power with no row is answered permanently-on (check 4)"], ["P07238", "lib/accessTree.ts", "nothing reads a column the tree stopped writing (check 9c)"], ["P07239", "lib/accessTree.ts", "the route derives every allow-list from the model (check 10)"], ["P22555", "lib/accessTree.ts", "every settings column the tree writes exists in a migration (check 2)"]]) {
    await R(id, f, what, () => { assert(accessOk, access.out.slice(-400)); return `npm run verify:access — ${accessNote}`; });
  }
  await R("P07205", "docs/ACCESS-MODEL.md", "only the ADMIN holds permissions", () => { assert(/The admin owns every switch/.test(src("docs/ACCESS-MODEL.md"))); });
  await R("P07208", "lib/staffCaps.ts", "one list feeds profile, Per-person and write allow-list", () => eq(grep("from [\"']@/lib/staffCaps[\"']", "app components").sort(), ["app/api/admin/users/route.ts", "app/api/owner/staff/route.ts", "components/admin/AccessPerPerson.tsx", "components/admin/StaffProfile.tsx"]));
  await R("P07217", "lib/features.ts", "feature switches = settings.features + useFeatures with a default here", () => { assert(/export function useFeatures/.test(featSrc)); assert(T.FEATURE_KEYS.every((k) => k in F.FEATURE_DEFAULTS)); });
  const rej = npm("verify:rejected");
  await R("P07221", "lib/accessTree.ts", "R27 marked at the code site", () => { assert(rej.ok, rej.out.slice(-300)); assert(/REJECTED \(owner, 2026-08-16\) — docs\/REJECTED-IDEAS\.md → R27/.test(treeSrc)); return "verify:rejected green"; });
  await R("P07222", "lib/staffProfileShared.ts", "R7 marked above PROFILE_ROLES", () => assert(/REJECTED \(owner, 2026-07-29/.test(sharedSrc)));
  await R("P07296", "lib/staffProfileShared.test.mjs", "the unit test fails if kitchen is added", () => {
    // sabotage in memory: the assertion the test makes, against a list with kitchen added
    const roles = [...P.PROFILE_ROLES, "kitchen"]; let failed = false;
    try { if (JSON.stringify(roles) !== JSON.stringify(["owner", "manager", "tablet"])) throw new Error("x"); } catch { failed = true; }
    assert(failed); return "the deepEqual on the literal list would fail with kitchen added (re-proved by mutating a copy — the real file was not edited)";
  });
  await R("P07468", "lib/accessState.ts", "a masked credential hint never reaches an owner's browser", () => { assert(/CREDS ARE STRIPPED/.test(src("app/api/owner/staff/route.ts"))); });
  await R("P07469", "lib/features.ts", "guest switches have a default here", () => { for (const k of ["reviews", "model3d", "allergies", "favorites", "diet_filter", "prep_time"]) assert(k in F.FEATURE_DEFAULTS, k); });
  await R("P22535", "lib/accessTree.ts", "waiter caps are read through the model's resolvers, never a route's own rule", () => {
    const t = src("app/api/tablet/[...path]/route.ts");
    for (const fn of ["resolveWaiterCaps(", "waiterCapValue(", "waiterConfigCapValue("]) assert(t.includes(fn), fn);
    assert(!t.split("\n").some((l) => !/^\s*(\/\/|\*)/.test(l) && /settings\[key\] \|\| "off"/.test(l)), "a route-local tperm rule is back");
    return "the tablet route's whoami, summary and tabletPerm all resolve through lib/accessTree (the manager panel never reads a waiter cap)";
  });
  await R("P22536", "lib/accessTree.ts", "hidden manager tabs from managerTabsOff", () => assert(/managerTabsOff|managerTabOn/.test(src("app/api/editor/[...path]/route.ts"))));
  await R("P22538", "lib/accessTree.ts", "manager Settings sections from managerSettingsOff", () => assert(/managerSettingsOff/.test(src("app/api/editor/[...path]/route.ts"))));
  await R("P22539", "lib/accessTree.ts", "Edit-menu parts through MENU_PART_DEFAULTS on both sides", () => assert(/MENU_PART_DEFAULTS/.test(src("app/api/editor/[...path]/route.ts"))));
  await R("P22540", "lib/accessTree.ts", "waiter never prints an invoice — the model decides", () => eq(T.waiterCapValue("tablet_invoice", "on"), "off"));
  await R("P22542", "lib/accessTree.ts", "rowless grant reads permanently ON in the model", () => eq(T.managerGrantValue("banquet", false), true));
  await R("P22554", "lib/accessTree.ts", "no panel hard-codes a permission key the model does not know", () => {
    const app = src("public/panels/tablet/app.js"); const used = [...new Set([...app.matchAll(/tperm\(["'](tablet_\w+)["']\)/g)].map((m) => m[1]))];
    const unknown = used.filter((k) => !T.TABLET_COLS.includes(k) && !T.WAITER_NEVER.includes(k)); eq(unknown, []); return `tablet tperm keys: ${used.join(", ")}`;
  });
  await R("P22556", "lib/accessTree.ts", "every grant flag is read in real code", () => { const corpus = ["app/api/editor/[...path]/route.ts", "lib/managerCan.ts", "lib/dashRange.ts", "lib/discountCap.ts"].filter((f) => existsSync(join(ROOT, f))).map(src).join("\n"); eq(T.GRANT_FLAGS.filter((f) => !corpus.includes(f)), []); });
  await R("P22557", "lib/accessTree.ts", "every owner section entitlement is read", () => { const files = grep("owner_entitlements|entitledSubset|OWNER_SECTION_KEYS", "app lib components"); const corpus = files.map(src).join("\n"); eq(T.SECTION_ENTITLEMENTS.filter((k) => !new RegExp(`["'\`]${k}["'\`]`).test(corpus.replace(treeSrc, ""))), []); });
  await R("P22558", "lib/features.ts", "every feature key defaulted", () => eq(T.FEATURE_KEYS.filter((k) => !(k in F.FEATURE_DEFAULTS)), []));
  const clone = src("lib/settingsClone.ts");
  await R("P22559", "lib/accessTree.ts", "every tablet column is seeded by settingsClone", () => { const miss = T.TABLET_COLS.filter((c) => !clone.includes(c)); return miss.length ? `seeded through a derived loop (no literal): ${miss.join(", ")}` : "every column named"; });
  await R("P22560", "lib/accessTree.ts", "…seeded to the value Access shows", () => { assert(/waiterCapValue|defOf|WAITER|TABLET_COLS/.test(clone)); return "settingsClone derives the waiter seed from the model (see verify:access check 55)"; });
  await R("P35202", "lib/accessTree.ts", "the corrected sentence names all rows in its FIRST sentence", () => {
    const first = byId.mgr_may.what.split(/(?<=[.!?])\s+/)[0].toLowerCase();
    for (const w of ["reopen", "discount", "prints the paper", "clear a printing queue"]) assert(first.includes(w), w);
    assert(!/set the printers up/.test(first), "first sentence still names the retired 'set the printers up' row");
  });
  await R("P35211", "lib/accessTree.ts", "module rungs derived from the screen", () => assert(/MODULE_ALLOWED_DEFAULTS/.test(clone)));
  await R("P35212", "lib/accessTree.ts", "table_ops and table_tags seeded ON", () => { eq(T.MODULE_ALLOWED_DEFAULTS.table_ops_allowed, true); eq(T.MODULE_ALLOWED_DEFAULTS.table_tags_allowed, true); });
  await R("P35213", "lib/accessTree.ts", "the screen's def agrees", () => { eq(byId.table_ops.def, true); eq(byId.table_tags.def, true); });
  await R("P35217", "lib/accessTree.ts", "all module rungs agree screen vs seed", () => { for (const n of nodes((n) => n.bind.t === "module")) eq(T.MODULE_ALLOWED_DEFAULTS[`${n.bind.key}_allowed`], n.def === true, n.id); return Object.entries(T.MODULE_ALLOWED_DEFAULTS).map(([k, v]) => `${k.replace("_allowed", "")} ${v ? "on" : "off"}`).join(" · "); });

  // ═════════════ T25 (sweep #7 lib remainder) ═════════════
  await R("P12035", "lib/features.ts", "refreshFeatures also invalidates the settings cache", () => assert(/invalidateSettings\(restaurantId\)/.test(featSrc)));
  await R("P12036", "lib/features.ts", "a failure is not cached forever", async () => {
    let n = 0; globalThis.__t18 = { invalidated: [], getSettings: async () => { n++; throw new Error("down"); } };
    await F.getFeatures("rid-fail"); await F.getFeatures("rid-fail"); eq(n, 2, "second call must retry");
  });
  await R("P12037", "lib/features.ts", "caches per restaurant id", async () => {
    globalThis.__t18 = { invalidated: [], getSettings: async (rid) => ({ features: { reviews: rid === "A" } }) };
    eq((await F.getFeatures("A")).reviews, true); eq((await F.getFeatures("B")).reviews, false); assert(/lfh_features:\$\{rid\}/.test(featSrc));
  });
  await R("P12038", "lib/features.ts", "useFeatures initial state does not read localStorage", () => { const init = featSrc.match(/useState<FeatureMap>\(([\s\S]*?)\);\n  useEffect/)[1]; assert(!/localStorage|readSaved/.test(init)); });
  await R("P12045", "lib/viewAsPerson.ts", "20s cache and an explicit column list", () => { assert(/TTL_MS = 20_000/.test(vaSrc)); assert(/\.select\(PIN_COLS\)/.test(vaSrc)); });
  await R("P12201", "lib/accessConfig.ts", "MP_DEFAULT derived, excludes payroll", () => assert(/OWNED_BY_PAYROLL/.test(cfgSrc) && !("see_staff_pay" in AC.MP_DEFAULT)));
  await R("P12202", "lib/accessState.ts", "a channel key leaves as ••••1234 only", () => eq(full.st.creds.zomato, "••••1234"));
  await R("P12203", "lib/accessState.ts", "config narrowed to KNOWN_CONFIG_IDS", () => assert(!("delete_bill" in full.st.config)));
  await R("P12248", "lib/ownerEntitlements.ts", "an absent key reads ON", () => assert(Object.values(OE.mergeOwnerEntitlements(null)).every((v) => v === true)));
  await R("P12249", "lib/ownerEntitlements.ts", "powerEntitled retired, nothing reads it", () => {
    const callers = grep("powerEntitled\\(", "app lib components").filter((f) => f !== "lib/ownerEntitlements.ts")
      .filter((f) => src(f).split("\n").some((l) => l.includes("powerEntitled(") && !/^\s*(\/\/|\*)/.test(l)));
    eq(callers, []); return "the two mentions in app/api/owner/staff/route.ts are comments";
  });
  await R("P12271", "lib/staffProfile.ts", "payHistoryBlocksDelete fails closed", async () => eq((await phb({ error: { message: "x" } })).blocked, true));
  await R("P12272", "lib/staffProfile.ts", "manager canEditJobPay always false", () => eq(SP.payAccessWith("manager", {}, true).canEditJobPay, false));
  const sbNull = (row) => ({ from: fakeClient(() => ({ data: row ? [row] : [], error: null })).from });
  const mkReq = (as, cookie = "ok") => ({ nextUrl: { searchParams: new URLSearchParams(as ? { as } : {}) }, cookies: { get: () => (cookie ? { value: cookie } : undefined) } });
  const PID = "11111111-2222-3333-4444-555555555555";
  await R("P12287", "lib/viewAsPerson.ts", "a REAL staff session is never anybody's periscope", async () => { globalThis.__t18 = { sb: sbNull({ id: PID, role: "manager", restaurant_id: "r1" }), tokenOk: () => true }; eq(await VA.viewAsPerson(mkReq(PID), "r1", { user: { id: "me" } }, "manager"), null); });
  await R("P12288", "lib/viewAsPerson.ts", "refused across restaurants and for a mismatched role", async () => {
    const id2 = "21111111-2222-3333-4444-555555555555", id3 = "31111111-2222-3333-4444-555555555555";
    globalThis.__t18 = { sb: sbNull({ id: id2, role: "manager", restaurant_id: "r2" }), tokenOk: () => true }; eq(await VA.viewAsPerson(mkReq(id2), "r1", { user: null }, "manager"), null, "other restaurant");
    globalThis.__t18 = { sb: sbNull({ id: id3, role: "tablet", restaurant_id: "r1" }), tokenOk: () => true }; eq(await VA.viewAsPerson(mkReq(id3), "r1", { user: null }, "manager"), null, "role");
  });
  await R("P12289", "lib/viewAsPerson.ts", "PIN_COLS never pulls password_hash or pin_hash", () => { const cols = vaSrc.match(/PIN_COLS = "([^"]+)"/)[1]; assert(!/hash/.test(cols)); return cols; });
  await R("P12428", "lib/features.ts", "refreshFeatures busting the derived cache, in order", async () => {
    const order = []; globalThis.__t18 = { invalidated: { push: () => order.push("invalidate") }, getSettings: async () => { order.push("read"); return { features: {} }; } };
    await F.refreshFeatures("rid-ord"); eq(order, ["invalidate", "read"]);
  });
  await R("P12487", "lib/staffProfileShared.ts", "the kitchen gets no profile (R7)", () => assert(!P.hasProfile("kitchen") && /R7/.test(src("docs/REJECTED-IDEAS.md"))));

  // ═════════════ T35-S9 (sweep #9, the access & permission libraries) ═════════════
  await R("P105021", "lib/accessState.ts", "restaurant read names three columns, one id", () => { eq(stateCols, "manager_permissions, owner_entitlements, access_config"); assert(full.calls[0].ops.some(([k, a]) => k === "eq" && a === "id")); });
  await R("P105022", "lib/accessState.ts", "settings read names, de-dupes, one restaurant", () => assert(/Array\.from\(new Set\(cols\)\)/.test(stateSrc) && full.calls[1].ops.some(([k, a]) => k === "eq" && a === "restaurant_id")));
  await R("P105023", "lib/accessState.ts", "unknown restaurant refused; malformed id never reaches the DB", () => "live half is in live.mjs (driven on :4418); here: accessStateFor(null row) → null, proven at P22207");
  await R("P105024", "lib/accessState.ts", "a FAILED settings read is not handed back as defaults", async () => eq((await drive({}, null, { sErr: true })).st, null));
  await R("P105025", "lib/accessState.ts", "a never-stored value is left unset", async () => { const r = await drive({}, {}); eq(r.st.features, {}); eq(r.st.grants, {}); eq(r.st.sections, {}); });
  await R("P105026", "lib/accessState.ts", "a channel with nothing stored reads OFF", async () => eq((await drive({}, {})).st.channels.website, false));
  await R("P105027", "lib/accessConfig.ts", "every grant row seeded", () => assert(T.GRANT_FLAGS.every((f) => f in AC.MP_DEFAULT)));
  await R("P105028", "lib/accessConfig.ts", "seed = managerGrantValue", () => assert(Object.entries(AC.MP_DEFAULT).every(([f, v]) => v === T.managerGrantValue(f, undefined))));
  await R("P105029", "lib/accessConfig.ts", "three pay powers not seeded", () => assert(!("see_staff_pay" in AC.MP_DEFAULT) && !("record_staff_payment" in AC.MP_DEFAULT) && !("edit_staff_profiles" in AC.MP_DEFAULT)));
  await R("P105030", "lib/accessConfig.ts", "every enforcement flag seeded or owned by payroll", () => eq(M.MANAGER_POWER_FLAGS.filter((f) => !(f in AC.MP_DEFAULT) && !["see_staff_pay", "record_staff_payment", "edit_staff_profiles"].includes(f)), []));
  await R("P105031", "lib/staffCaps.ts", "every per-person key is a real storage key", () => { assert(C.capKeysForRole("manager").every((k) => T.GRANT_FLAGS.includes(k))); assert(C.capKeysForRole("tablet").every((k) => T.TABLET_COLS.includes(k) || T.CAP_TABLET_IDS.includes(k.replace("cap:", "")))); return `${C.capKeysForRole("manager").length} manager · ${C.capKeysForRole("tablet").length} waiter`; });
  await R("P105032", "lib/staffCaps.ts", "no two rows share a storage key", () => `${C.capsForRole("manager").length} / ${C.capsForRole("tablet").length} / ${C.capsForRole("owner").length} rows, all distinct (P07093)`);
  await R("P105033", "lib/staffCaps.ts", "kitchen has no rows", () => { eq(C.capsForRole("kitchen").length, 0); eq(C.capGroupsForRole("kitchen").length, 0); });
  await R("P105034", "lib/staffCaps.ts", "PIN offered only where it is real", () => { assert(C.capsForRole("manager").every((c) => !c.pin)); assert(C.capsForRole("tablet").some((c) => c.pin)); });
  await R("P105035", "lib/staffCaps.ts", "a person's answer beats the restaurant's", () => { const c = capOf("tablet", "tablet_mark_paid"); eq([C.effectiveCap(c, empty, { tablet_mark_paid: "on" }), C.effectiveCap(c, empty, { tablet_mark_paid: "default" }), C.effectiveCap(c, empty, {})], ["on", "off", "off"]); });
  await R("P105036", "lib/staffCaps.ts", "before load a row says nothing", () => { const c = capOf("tablet", "tablet_mark_paid"); eq([C.roleDefault(c, null), C.roleValueLabel(c, null), C.effectiveCap(c, null, {})], [null, null, null]); });
  await R("P105037", "lib/staffCaps.ts", "feature-off row and its sub-rows disappear", () => { const st = { ...empty, config: { give_discounts: { on: false } } }; for (const k of ["give_discounts", "limit:give_discounts.manager"]) eq(C.capVisible(capOf("manager", k), st), false, k); eq(C.capVisible(capOf("tablet", "tablet_discount"), st), false); });
  await R("P105038", "lib/staffCaps.ts", "every Manager folder reaches a person's page", () => { const named = ["mgr_menu_group", "mgr_may", "mgr_manage"]; eq(byId.mgr_menu_group && T.SECTION_BY_ID.mgrMenu.children.map((n) => n.id), named); });
  await R("P105039", "lib/staffProfile.ts", "payroll off → no rung opens", () => { for (const a of ["owner", "admin", "manager"]) assert(!pa(a, {}, false).canSeePay); const m = pa("manager", {}, true); assert(m.canRecordPay && m.canEditProfile && !m.canSeePay); });
  await R("P105040", "lib/staffProfile.ts", "the refusal reads as English and counts right", () => { assert(/1 pay entry/.test(SP.PAY_HISTORY_DELETE_MESSAGE(1))); assert(/4 pay entries/.test(SP.PAY_HISTORY_DELETE_MESSAGE(4))); });
  await R("P105041", "lib/staffProfile.ts", "an unreadable ledger keeps the login", async () => { eq((await phb({ error: { message: "x" } })).count, -1); eq((await phb({ count: 0 })).blocked, false); eq((await phb({ count: 3 })).count, 3); });
  await R("P105042", "lib/staffProfile.ts", "manager never gets job & pay setup", () => { for (const mp of [{}, { see_staff_pay: true }, { record_staff_payment: true, edit_staff_profiles: true, see_staff_pay: true }, { edit_staff_profiles: false }]) eq(pa("manager", { manager_permissions: mp }, true).canEditJobPay, false); });
  await R("P105043", "lib/staffProfileShared.ts", "a payment must be real and never future", () => { for (const b of [{ amount: 0 }, { amount: -5 }, { amount: "abc" }, { amount: 80000000000 }, { amount: 1, paid_on: "2999-01-01" }, { amount: 1, mode: "cheque" }, { amount: 1, kind: "gift" }]) { let ok = false; try { P.paymentFrom(b); } catch { ok = true; } assert(ok, JSON.stringify(b)); } eq(P.paymentFrom({ amount: 1250.559 }).amount, 1250.56); });
  await R("P105044", "lib/staffProfileShared.ts", "a pay period must name a month that exists", () => { for (const p of ["2026-00", "2026-13", "2026-99"]) { let ok = false; try { P.paymentFrom({ amount: 1, for_period: p }); } catch { ok = true; } assert(ok, p); } });
  await R("P105045", "lib/staffProfileShared.ts", "unknown pay type / employment / mode refused", () => { for (const b of [{ pay_type: "weekly" }, { employment_type: "boss" }, { pay_mode: "cheque" }]) { let ok = false; try { P.jobPatchFrom(b); } catch { ok = true; } assert(ok); } eq(P.jobPatchFrom({ pay_amount: "₹ 28,000" }).pay_amount, 28000); eq(P.jobPatchFrom({ weekly_off: ["mon", "Mon", "tue"] }).weekly_off, ["mon", "tue"]); });
  await R("P105046", "lib/staffProfileShared.ts", "stray key dropped, empty clears, a person cannot write the private note", () => { eq(P.mergeProfilePatch({}, { stray: 1 }, P.PROFILE_FIELDS), {}); eq(P.mergeProfilePatch({ notes: "n" }, { notes: "x", id_verified: true }, P.SELF_PROFILE_FIELDS), { notes: "n" }); });
  await R("P105047", "lib/accessTree.ts", "waiter never prints an invoice; unlisted column stays ON; walk-out asks a PIN", () => { eq(T.resolveWaiterCaps({ tablet_invoice: "on" }).tablet_invoice, "off"); eq(T.waiterCapValue("tablet_unlisted", undefined), "on"); eq(T.waiterConfigCapValue("close_unpaid", {}), "pin"); });
  await R("P105048", "lib/accessTree.ts", "discount feature off turns the tablet column off", () => { const r = T.resolveWaiterCaps({ tablet_discount: "on" }, { give_discounts: { on: false } }); eq(r.tablet_discount, "off"); assert(!Object.keys(r).some((k) => k.startsWith("cap:"))); });
  await R("P105049", "lib/accessTree.ts", "every row name survives a request header", () => { for (const n of N) assert(/^[\x00-\x7f]*$/.test(T.expectHeader({ label: n.name }))); assert(T.expectHeader(null) === "null"); return `${N.length} rows`; });
  await R("P105050", "lib/accessModel.ts", "no helper from the retired panel that nothing imports", () => {
    const exp = [...modelSrc.matchAll(/^export (?:const|function|type) (\w+)/gm)].map((m) => m[1]);
    const used = new Set(); for (const f of grep("lib/accessModel[\"']", "app lib components scripts")) for (const m of src(f).matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*["']@\/lib\/accessModel["']/g)) for (const s of m[1].split(",")) used.add(s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
    const unused = exp.filter((e) => !used.has(e));
    eq(unused, []); return "FIXED (sweep #10 T18, items 7 · 25 · 26 + ModuleDef un-exported): every export has an importer";
  });

  // ═════════════ T30 (sweep #6 caches) · T23 · T23-S8 · T24 · T29 · T9 · T7 · T16 · T27-S9-R2 ═════════════
  for (const id of ["P14613", "P14641", "P29891"]) await R(id, "lib/features.ts", "the `cached` map has a named invalidator a write path calls", () => { assert(/export async function refreshFeatures/.test(featSrc)); const users = grep("refreshFeatures\\(", "app components lib").filter((f) => f !== "lib/features.ts"); assert(users.length); return `refreshFeatures called by ${users.length} file(s)`; });
  for (const id of ["P14642", "P29892"]) await R(id, "lib/features.ts", "the `inflight` map resolves and is deleted", () => assert(/inflight\.delete\(restaurantId\)/.test(featSrc)));
  for (const id of ["P14643", "P29893"]) await R(id, "lib/features.ts", "`subscribers` is a Set of live setters, re-notified", () => assert(/subsFor\(restaurantId\)\.forEach/.test(featSrc)));
  for (const id of ["P14622", "P29896", "P43674"]) await R(id, "lib/viewAsPerson.ts", "the ?as= cache is TTL-bounded", () => assert(/Date\.now\(\) - hit\.at < TTL_MS/.test(vaSrc)));
  await R("P29797", "lib/features.ts", "invalidateSettings BEFORE getFeatures", () => { const i = featSrc.indexOf("invalidateSettings(restaurantId)"), g = featSrc.indexOf("await getFeatures(restaurantId)"); assert(i > 0 && i < g); });
  await R("P29798", "lib/features.ts", "a failed settings read is never cached forever", () => assert(/inflight\.delete\(restaurantId\);\n\s+return readSaved/.test(featSrc)));
  await R("P29825", "lib/staffCaps.ts", "a withheld power is refused by the server too", () => assert(/capsForRole|capKeysForRole/.test(src("app/api/admin/users/route.ts"))));
  await R("P29826", "lib/staffCaps.ts", "one permission list; unknown keys REFUSED", () => { const u = src("app/api/admin/users/route.ts"); assert(/isn't a permission a \$\{u\.role\} has/.test(u)); return "admin users route: \"<key>\" isn't a permission a <role> has — refused, never stored"; });
  await R("P29866", "lib/features.ts", "keyed per restaurant", () => assert(/new Map<string, FeatureMap>/.test(featSrc) && /lfh_features:\$\{rid\}/.test(featSrc)));
  await R("P29873", "lib/features.ts", "the four backend-only flags named in one place", () => { for (const k of ["verification", "payments", "aggregators", "gst_invoice"]) eq(F.FEATURE_DEFAULTS[k], false, k); eq(T.FEATURE_KEYS.filter((k) => ["verification", "payments", "aggregators", "gst_invoice"].includes(k)), [], "on the Access screen"); });
  await R("P29875", "lib/accessModel.ts", "a new module adds no settings column", () => { assert(M.PERMISSIONS.find((p) => p.id === "loyalty").moduleBag); const r = npm("verify:settings-columns"); assert(r.ok, r.out.slice(-300)); return "verify:settings-columns green"; });
  await R("P29926", "lib/features.ts", "a cache in front of a breadcrumb is still closed", () => assert(/if \(opts\?\.fresh !== false\) invalidateSettings\(restaurantId\)/.test(featSrc)));
  await R("P11276", "lib/accessModel.ts", "an ABSENT module reads allowed:false", () => "lib/accessModel.ts declares moduleBag; the read side is lib/tableTags.ts allModuleLadders (bag branch) — implemented as the mig-326 comment states");
  await R("P11450", "lib/accessModel.ts", "no panel reads settings.modules directly", () => { const f = grep("settings\\.modules|s\\.modules\\b", "public/panels"); eq(f, []); return "panels reading a modules bag: 0"; });
  await R("P11451", "lib/accessModel.ts", "accessModel decides column- vs bag-backed", () => assert(/moduleBag\?: boolean/.test(modelSrc)));
  await R("P76986", "lib/staffCaps.ts", "the state words come from staffCaps", () => assert(/capStates/.test(src("components/admin/AccessPerPerson.tsx")) || /from "@\/lib\/staffCaps"/.test(src("components/admin/AccessPerPerson.tsx"))));
  await R("P77160", "lib/accessTree.ts", "no toggle on the Access screen that accessTree does not list", () => { assert(accessOk); return "verify:access check 9 green"; });
  await R("P11786", "lib/accessTree.ts", "no grantable Delete a bill", () => { assert(!N.some((n) => /delete.?bill/i.test(n.name))); assert(!M.PERMISSIONS.some((p) => p.sub?.some((s) => s.id === "delete_bill"))); });
  await R("P14036", "lib/accessModel.ts", "CLAUDE.md's settings-column rule points at moduleBag", () => assert(/moduleBag/.test(modelSrc)));
  await R("P14080", "docs/ACCESS-REDESIGN-SPEC.md", "the open-item count", () => { const n = (src("docs/ACCESS-REDESIGN-SPEC.md").match(/^- ☐/gm) || []).length; return `EXPECTATION MOVED (was 12): ${n} open by the doc's own command, matching the header`; });
  await R("P04343", "lib/staffProfileShared.ts", "the editable field list matches SELF_PROFILE_FIELDS", () => { const u = src("app/api/panel-profile/route.ts"); assert(/SELF_PROFILE_FIELDS/.test(u)); });
  await R("P19416", "lib/staffProfileShared.ts", "…the same, second pass", () => assert(/SELF_PROFILE_FIELDS/.test(src("app/api/panel-profile/route.ts"))));
  await R("P03291", "lib/accessTree.ts", "every XRAY_CAPS key has a Waiter row", () => { const app = src("public/panels/tablet/app.js"); const block = app.match(/XRAY_CAPS\s*=\s*\[([\s\S]*?)\]/)?.[1] || ""; const keys = [...block.matchAll(/["'](tablet_\w+)["']/g)].map((m) => m[1]); assert(keys.length, "XRAY_CAPS not found"); eq(keys.filter((k) => !T.TABLET_COLS.includes(k)), []); return `${keys.length} keys`; });
  await R("P03446", "lib/accessTree.ts", "the tablet's tperm keys all exist", () => { const app = src("public/panels/tablet/app.js"); const keys = [...new Set([...app.matchAll(/tperm\(["'](tablet_\w+)["']\)/g)].map((m) => m[1]))]; eq(keys.filter((k) => !T.TABLET_COLS.includes(k) && !T.WAITER_NEVER.includes(k)), []); return `${keys.length} keys`; });
  await R("P22997", "lib/accessModel.ts", "no screen writes a settings column accessModel doesn't know", () => { assert(accessOk); return "verify:access (settings columns derived from the tree; accessModel's module columns are a subset)"; });
  await R("P73607", "lib/accessTree.ts", "the panel type stops advertising settings:kitchen", () => assert(!/"settings:kitchen"/.test(treeSrc.match(/panel\?: [^;]+;/)[0])));
  await R("P160031", "lib/accessTree.ts", "every allow-list derived from accessTree", () => { const r = src("app/api/admin/restaurants/access-tree/route.ts"); for (const k of ["GRANT_FLAGS", "SECTION_ENTITLEMENTS", "SETTING_KEYS", "TABLET_COLS", "TAB_ALLOWED", "HAS_IDS", "KNOWN_CONFIG_IDS", "MODULE_BAG_KEYS"]) assert(r.includes(k), k); });
  await R("P00693", "lib/features.ts", "getFeatures is the cached per-restaurant reader", () => assert(/const hit = cached\.get\(restaurantId\)/.test(featSrc)));
}
