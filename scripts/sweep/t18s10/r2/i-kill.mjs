// Block I — written from the MUTATION run (round 2, seed 1): one check per surviving break that was a
// real gap rather than a change with no effect.
//   · golden.json pins every row's settings, default and children, every person-page row and the wiring
//     list — these are the owner's recorded decisions, so changing one must be a deliberate edit of the
//     snapshot WITH a reason, never a silent flip. (golden.json is never rewritten by this suite.)
//   · the rest are exact boundaries and the null inputs that, under a break, would crash.
import { chk, assert, eq, throws, db, calls } from "./core.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "@/lib/accessTree";
import * as C from "@/lib/staffCaps";
import * as M from "@/lib/accessModel";
import * as P from "@/lib/staffProfileShared";
import * as SP from "@/lib/staffProfile";
import * as F from "@/lib/features";
import * as OE from "@/lib/ownerEntitlements";
import * as VA from "@/lib/viewAsPerson";

const G = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "golden.json"), "utf8"));
const K = (f, c, h, fn) => chk(f, c, h, fn);
const gold = "compare with scripts/sweep/t18s10/r2/golden.json (the recorded decision)";
const node = "node: the real export";
const shape = (n) => ({ id: n.id, bind: n.bind, featureBind: n.featureBind ?? null, def: n.def ?? null, leftToBuild: !!n.leftToBuild, fresh: !!n.fresh, pin: !!n.pin, confirm: !!n.confirm, options: n.options ?? null, unit: n.unit ?? null, choices: n.choices?.map((c) => c.value) ?? null, panel: n.panel ?? null, preview: n.preview ?? null, singleOrMany: !!n.singleOrMany, children: n.children?.map((c) => c.id) ?? [] });

await K("lib/accessTree.ts", "the five sections — ids, names, icons and their top-level rows — are as recorded", gold, () => eq(T.SECTIONS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, children: s.children.map((c) => c.id) })), G.sections));
await K("lib/accessTree.ts", "the Access screen has exactly the recorded rows, in the recorded order", gold, () => eq(T.ALL_NODES.map((n) => n.id), G.nodes.map((n) => n.id)));
const live = Object.fromEntries(T.ALL_NODES.map((n) => [n.id, shape(n)]));
for (const g of G.nodes) {
  await K("lib/accessTree.ts", `row "${g.id}": storage, default, flags, options and children are the recorded decision`, gold, () => eq(live[g.id], g, g.id));
}
for (const r of ["manager", "tablet", "owner"]) {
  await K("lib/staffCaps.ts", `a ${r === "tablet" ? "waiter" : r}'s page: every row's key, group, per-person, PIN, kind and inherited feature are as recorded`, gold, () => eq(C.capsForRole(r).map((c) => ({ key: c.key, node: c.node.id, group: c.group, perPerson: c.perPerson, pin: c.pin, kind: c.kind ?? null, featureFrom: c.featureFrom?.id ?? null })), G.caps[r]));
}
await K("lib/accessModel.ts", "the wiring list (24 entries) is as recorded", gold, () => eq(M.PERMISSIONS, G.permissions));
await K("lib/features.ts", "every guest feature default is as recorded", gold, () => eq(F.FEATURE_DEFAULTS, G.featureDefaults));
await K("lib/accessTree.ts", "the Users powers, the manager settings sections, the languages and currencies are as recorded", gold, () => { eq(T.MANAGER_USER_POWERS.map((p) => p.key), G.managerUserPowers); eq(T.MANAGER_SETTINGS.map((x) => x.key), G.managerSettings); eq(T.MENU_LANGUAGES.map((c) => c.value), G.languages); eq(T.MENU_CURRENCIES.map((c) => c.value), G.currencies); });

// ── exact boundaries and nulls the mutants slipped past ──────────────────────────────────────────
const E = T.emptyState;
await K("lib/accessTree.ts", "a stored 'off' on a row whose default is ON reads 'off' (isTriState accepts 'off')", node, () => { eq(T.waiterCapValue("tablet_take_orders", "off"), "off"); eq(T.waiterConfigCapValue("close_unpaid", { close_unpaid: { tablet: "off" } }), "off"); });
await K("lib/accessTree.ts", "menus.mgrset: null and menus.manager: null answer [] (no crash)", node, () => { eq(T.managerSettingsOff({ menus: { mgrset: null } }), []); eq(T.managerTabsOff({ menus: { manager: null } }), []); });
await K("lib/accessTree.ts", "menus stored as a STRING answers [] for both", node, () => { eq(T.managerSettingsOff({ menus: { mgrset: "x" } }), []); eq(T.managerTabsOff({ menus: { manager: "x" } }), []); });
await K("lib/staffCaps.ts", "a waiter's own 'on' over a restaurant OFF answers 'on' (mark paid)", node, () => eq(C.effectiveCap(C.capsForRole("tablet").find((c) => c.key === "tablet_mark_paid"), E(), { tablet_mark_paid: "on" }), "on"));
await K("lib/staffCaps.ts", "a waiter's own 'off' over a restaurant ON answers 'off' (take orders)", node, () => eq(C.effectiveCap(C.capsForRole("tablet").find((c) => c.key === "tablet_take_orders"), E(), { tablet_take_orders: "off" }), "off"));
await K("lib/staffCaps.ts", "countOverrides counts each of on / off / pin on its own", node, () => { for (const v of ["on", "off", "pin"]) eq(C.countOverrides("tablet", { tablet_mark_paid: v }), 1, v); eq(C.countOverrides("tablet", { tablet_mark_paid: "maybe" }), 0); });
await K("lib/staffCaps.ts", "roleValueLabel of a value that is '' answers '' (not '—'); undefined answers '—'", node, () => { const fake = () => ({ key: "k", node: { id: "k", name: "k", what: "k.", bind: { t: "text", key: "google_review_url" } } }); eq(C.roleValueLabel(fake(), { ...E(), settings: { google_review_url: "" } }), ""); eq(C.roleValueLabel({ key: "k", node: { id: "k", name: "k", what: "k.", bind: { t: "none" } } }, E()), "—"); });
await K("lib/staffProfileShared.ts", "1 January 1900 is a real day; 31 December 1899 is not", node, () => { eq(P.jobPatchFrom({ joined_on: "1900-01-01" }).joined_on, "1900-01-01"); throws(() => P.jobPatchFrom({ joined_on: "1899-12-31" }), /isn't a real date/); });
await K("lib/staffProfileShared.ts", "a pay amount of exactly 0 is accepted (an unpaid trial)", node, () => eq(P.jobPatchFrom({ pay_amount: 0 }).pay_amount, 0));
await K("lib/staffProfileShared.ts", "a pay amount of exactly 99,999,999 is accepted; one paisa more is refused", node, () => { eq(P.jobPatchFrom({ pay_amount: 99999999 }).pay_amount, 99999999); throws(() => P.jobPatchFrom({ pay_amount: 99999999.01 }), /too large/); });
await K("lib/staffProfileShared.ts", "a payment of exactly 99,999,999 is accepted; one paisa more is refused", node, () => { eq(P.paymentFrom({ amount: 99999999 }).amount, 99999999); throws(() => P.paymentFrom({ amount: 99999999.01 }), /too large/); });
await K("lib/staffProfileShared.ts", "pay periods January (01) and December (12) are accepted", node, () => { eq(P.paymentFrom({ amount: 1, for_period: "2026-01" }).for_period, "2026-01-01"); eq(P.paymentFrom({ amount: 1, for_period: "2026-12" }).for_period, "2026-12-01"); });
await K("lib/staffProfileShared.ts", "a weekday is read from its first THREE letters ('Monday' alone → mon)", node, () => { eq(P.jobPatchFrom({ weekly_off: ["Monday"] }).weekly_off, ["mon"]); eq(P.jobPatchFrom({ weekly_off: ["Thursday", "Saturday"] }).weekly_off, ["thu", "sat"]); });
await K("lib/staffProfileShared.ts", "a payment with kind '' or mode '' is refused (an empty word is not the default)", node, () => { throws(() => P.paymentFrom({ amount: 1, kind: "" }), /Unknown payment type/); throws(() => P.paymentFrom({ amount: 1, mode: "" }), /Unknown payment mode/); });
await K("lib/staffProfileShared.ts", "a pay period sent as the number 0 is refused, not treated as no period", node, () => throws(() => P.paymentFrom({ amount: 1, for_period: 0 }), /valid month/));
await K("lib/staffProfileShared.ts", "an ID tail sent as the number 0 is stored as '0'", node, () => eq(P.mergeProfilePatch({}, { id_last4: 0 }, P.PROFILE_FIELDS).id_last4, "0"));
await K("lib/staffProfileShared.ts", "a birth date sent as the number 0 keeps the stored one (not text that is a date)", node, () => eq(P.mergeProfilePatch({ dob: "1990-01-01" }, { dob: 0 }, P.PROFILE_FIELDS).dob, "1990-01-01"));
await K("lib/staffProfileShared.ts", "completeness: an ID TYPE with no last 4 is still missing 'ID on file'; pay type with no amount still missing 'pay setup'", node, () => { assert(P.completeness({ profile: { id_type: "PAN" } }).missing.includes("ID on file")); assert(P.completeness({ profile: { id_last4: "1234" } }).missing.includes("ID on file")); assert(P.completeness({ pay_type: "daily" }).missing.includes("pay setup")); assert(P.completeness({ pay_amount: 5 }).missing.includes("pay setup")); });
await K("lib/staffProfile.ts", "PAY_HISTORY_DELETE_MESSAGE(0) is the ordinary sentence, not 'couldn't check'", node, () => { assert(!/Couldn't check/.test(SP.PAY_HISTORY_DELETE_MESSAGE(0))); assert(/0 pay entries/.test(SP.PAY_HISTORY_DELETE_MESSAGE(0))); });
await K("lib/ownerEntitlements.ts", "logViewSubset: owner_opts stored as null keeps the restaurant (no crash)", "drive", async () => { db(() => ({ data: [{ id: "a", access_config: { view_logs: { owner_opts: null } } }], error: null })); eq(await OE.logViewSubset(["a"], "activity"), ["a"]); });
await K("lib/features.ts", "a saved value that is a JSON STRING is ignored, not spread into the switches", "drive", async () => { const r = `rid-str-${Date.now()}`; const m = new Map([[`lfh_features:${r}`, JSON.stringify("abc")]]); Object.defineProperty(globalThis, "localStorage", { value: { getItem: (k) => m.get(k) ?? null, setItem() {} }, configurable: true, writable: true }); globalThis.__t18.getSettings = async () => { throw new Error("x"); }; globalThis.__t18.invalidated = []; const f = await F.getFeatures(r); assert(!("0" in f), "a character of the string became a switch"); eq(f.reviews, true); });
await K("lib/viewAsPerson.ts", "the 20-second cache holds at 19,999 ms and re-reads at exactly 20,000 ms", "drive with a moved clock", async () => {
  const id = "a1b2c3d4-0000-4000-8000-0000000fffff";
  const req = { nextUrl: { searchParams: new URLSearchParams({ as: id }) }, cookies: { get: () => ({ value: "t" }) } };
  globalThis.__t18.tokenOk = () => true; db(() => ({ data: [{ id, role: "manager", restaurant_id: "r1" }], error: null }));
  const now = Date.now, t0 = now(); Date.now = () => t0;
  try {
    await VA.viewAsPerson(req, "r1", { user: null }, "manager");
    Date.now = () => t0 + 19_999; db(() => ({ data: [], error: null })); await VA.viewAsPerson(req, "r1", { user: null }, "manager"); eq(calls().length, 0, "19,999 ms must still be cached");
    Date.now = () => t0 + 20_000; db(() => ({ data: [], error: null })); await VA.viewAsPerson(req, "r1", { user: null }, "manager"); eq(calls().length, 1, "20,000 ms must read again");
  } finally { Date.now = now; }
});

// ── pass 2 (seed 2): the five real gaps among the 46 survivors ──────────────────────────────────
const B = T.NODE_BY_ID;
await K("lib/accessTree.ts", "a row anywhere in a section reads 'off' when one of its switch ancestors is off — every row, not just the first subtree", inv2(), () => {
  let n = 0;
  for (const x of T.ALL_NODES) {
    const path = []; let hit = null;
    const rec = (nodes, up) => { for (const k of nodes) { if (k.id === x.id) { hit = up; return; } if (k.children) rec(k.children, [...up, k]); if (hit) return; } };
    for (const s of T.SECTIONS) { rec(s.children, []); if (hit) break; }
    const sw = (hit || []).filter((a) => a.bind.t !== "none");
    for (const a of sw) { n++; eq(T.ancestorsOn(x.id, (m) => m.id !== a.id), false, `${x.id} under ${a.id}`); }
    eq(T.ancestorsOn(x.id, () => true), true, x.id); void path;
  }
  return `${n} (row, ancestor) pairs`;
});
await K("lib/accessTree.ts", "a waiter action stored in access_config is OFF when its Feature half is off (item 8's arm, driven by a stand-in pairing)", node, () => {
  const key = "cap:close_unpaid"; assert(!(key in T.WAITER_FEATURE_OF), "a real pairing exists now — test the real one instead");
  T.WAITER_FEATURE_OF[key] = "zz_feature";
  try {
    eq(T.waiterConfigCapValue("close_unpaid", { zz_feature: { on: false }, close_unpaid: { tablet: "on" } }), "off");
    eq(T.waiterConfigCapValue("close_unpaid", { zz_feature: { on: true }, close_unpaid: { tablet: "on" } }), "on");
    eq(T.waiterConfigCapValue("close_unpaid", { close_unpaid: { tablet: "pin" } }), "pin");
  } finally { delete T.WAITER_FEATURE_OF[key]; }
});
await K("lib/accessTree.ts", "a text or key box sent the number 0 saves \"0\"; sent null saves \"\"", node, () => {
  eq(T.nodePatch(B.google_review_url, 0), { settings: { google_review_url: "0" } });
  eq(T.nodePatch(B.google_review_url, null), { settings: { google_review_url: "" } });
  eq(T.nodePatch(B.ch_zomato_key, 0), { creds: { [B.ch_zomato_key.bind.key]: "0" } });
  eq(T.nodePatch(B.ch_zomato_key, undefined), { creds: { [B.ch_zomato_key.bind.key]: "" } });
});
await K("lib/staffProfileShared.ts", "an allowance amount sent as false is refused, not read as ₹0", node, () => throws(() => P.jobPatchFrom({ pay_extras: [{ label: "x", amount: false }] }), /must be a number/));
await K("lib/staffProfileShared.ts", "clearing a birth date removes the field — no empty slot left behind", node, () => { const r = P.mergeProfilePatch({ dob: "1990-01-01", notes: "n" }, { dob: "" }, P.PROFILE_FIELDS); assert(!("dob" in r), "dob key still present"); eq(r.notes, "n"); });
await K("lib/staffProfileShared.ts", "a payment of 0, -5 or 0.004 is refused with the one 'greater than zero' sentence", node, () => { for (const a of [0, -5, 0.004, "0"]) throws(() => P.paymentFrom({ amount: a }), /greater than zero/); eq(P.paymentFrom({ amount: 0.005 }).amount, 0.01, "half a paisa rounds UP to one paisa and is kept"); });
await K("lib/accessTree.ts", "only has · opt · limit · capTablet rows carry a config id, and every limit id is also an action's id (keeps KNOWN_CONFIG_IDS' four lists overlapping, L1229–1232)", inv2(), () => {
  eq([...new Set(T.ALL_NODES.filter((n) => n.bind.id).map((n) => n.bind.t))].sort(), ["capTablet", "has", "limit", "opt"]);
  for (const n of T.ALL_NODES.filter((n) => n.bind.t === "limit")) assert(T.KNOWN_CONFIG_IDS.has(n.bind.id) && T.ALL_NODES.some((m) => m !== n && m.bind.t !== "limit" && (m.bind.id === n.bind.id || m.featureBind?.id === n.bind.id)), n.id);
});
function inv2() { return "invariant over every row of the real tree"; }
await K("lib/accessModel.ts", "every permission that carries a module also carries its Access-screen label (keeps MODULE_DEFS' `|| p.name` arm, L144, dead)", inv2(), () => eq(M.PERMISSIONS.filter((p) => p.module && !p.moduleLabel).map((p) => p.id), []));
