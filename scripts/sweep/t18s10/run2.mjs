// scripts/sweep/t18s10/run2.mjs — P187101–P187380 (called by run.mjs with its context).
import { assert, eq, fakeClient } from "./lib.mjs";

export async function run(x) {
  const { T, M, C, P, SP, AC, AS, OE, VA, F, N, empty, grep, code, src, treeSrc, featSrc, vaSrc, ownerStaff, adminUsers, clone, K, read, node, setN } = x;
  const BOOL = new Set(["feature", "setting", "module", "moduleBag", "channel", "grant", "section", "tab", "has", "ratingsMaster"]);
  const secOf = (id) => T.SECTIONS.find((s) => { let f = false; T.walk(s.children, (q) => { if (q.id === id) f = true; }); return f; })?.id;
  const allCapsKeys = new Set(["owner", "manager", "tablet"].flatMap((r) => C.capsForRole(r).map((c) => c.node.id)));
  const rt = (n, v, start = empty) => T.nodeValue(n, T.applyPatch(start, T.nodePatch(n, v)));

  // ═════════════ P187101–P187214 · ONE ROW PER SWITCH ON THE ACCESS SCREEN ═════════════
  setN(187100);
  for (const n of N) {
    const kind = n.bind.t;
    await K("lib/accessTree.ts", `row "${n.name}" (${n.id}, ${kind}): stores, reads back, seeds and travels right`, "node: nodePatch → applyPatch → nodeValue from empty and from the stored shape; seed vs def; expectHeader; staffCaps reach", () => {
      const said = [];
      if (kind !== "none" && !(n.what || "").trim()) throw new Error("a switch with no help text");
      if (BOOL.has(kind)) {
        for (const v of [true, false]) { eq(rt(n, v), v, `from empty set ${v}`); eq(rt(n, v, T.applyPatch(empty, T.nodePatch(n, !v))), v, `from stored set ${v}`); }
        said.push("both values read back");
      } else if (kind === "tablet" || kind === "capTablet") { for (const v of ["off", "on", "pin"]) eq(rt(n, v), v); said.push("off/on/pin read back"); }
      else if (kind === "choice" || (kind === "opt" && n.choices)) { for (const c of n.choices) eq(rt(n, c.value), c.value); said.push(`${n.choices.length} choices read back`); }
      else if (kind === "opt") { for (const v of [true, false]) eq(rt(n, v), v); said.push("both values read back"); }
      else if (kind === "limit") { for (const o of n.options) eq(rt(n, o), o); said.push(`${n.options.length} options read back`); }
      else if (kind === "list") { eq(rt(n, [n.choices[0].value]), [n.choices[0].value]); said.push("a single pick reads back"); }
      else if (kind === "text") { eq(rt(n, "https://example.test/r"), "https://example.test/r"); said.push("text reads back"); }
      else if (kind === "creds") { eq(T.nodeValue(n, T.applyPatch(empty, { creds: {} })), ""); eq(T.nodeExpect(n, empty, "r"), null); said.push("write-only: no value, no expectation"); }
      else if (kind === "none") { eq(T.nodePatch(n, true), {}); eq(T.nodeValue(n, empty), null); said.push("stores nothing"); }
      // the new-restaurant seed agrees with the row (only where the seed is explicit — see lib/settingsClone)
      if (kind === "module") { eq(T.MODULE_ALLOWED_DEFAULTS[`${n.bind.key}_allowed`], n.def === true, "seed"); said.push("seed = def"); }
      if (kind === "channel") { eq(T.CHANNEL_DEFAULTS[n.bind.key].on, n.def === true, "seed"); said.push("seed = def"); }
      if (kind === "grant") { eq(AC.MP_DEFAULT[n.bind.flag], n.def === true, "seed"); said.push("seed = def"); }
      if (kind === "tablet") { const m = clone.match(new RegExp(`base\\.${n.bind.key} = "(\\w+)"`)); assert(m, "no explicit seed"); eq(m[1], n.def, "seed"); said.push("seed = def"); }
      if (kind === "feature") { eq(F.FEATURE_DEFAULTS[n.bind.key], n.def, "lib/features.ts default"); said.push("guest default = def"); }
      if (["price_tax_mode", "item_tax_modes", "mrp_tax_treatment"].includes(n.id)) { const k = n.bind.key; const m = clone.match(new RegExp(`base\\.${k} = ("?[\\w]+"?)`)); eq(JSON.parse(m[1]), n.def, "seed"); said.push("seed = def"); }
      // the expectation header is sendable
      const st = T.applyPatch(empty, T.nodePatch(n, BOOL.has(kind) ? true : n.def ?? null));
      assert(/^[\x00-\x7f]*$/.test(T.expectHeader(T.nodeExpect(n, st, "r"))), "non-ASCII expectation");
      // a row in a role's section reaches that role's profile
      const sec = secOf(n.id);
      if (["mgrMenu", "waiter", "ownMenu"].includes(sec) && ["grant", "opt", "limit", "tablet", "capTablet", "tab", "section"].includes(kind)) { assert(allCapsKeys.has(n.id), "missing from the person's page"); said.push("on the person's page"); }
      assert(T.ancestorsOn(n.id, () => true), "ancestorsOn lost it");
      return said.join(" · ");
    });
  }

  // ═════════════ P187215–P187300 · staffCaps · staffProfile · staffProfileShared ═════════════
  setN(187214);
  const cap = (r, k) => C.capsForRole(r).find((c) => c.key === k);
  await K("lib/staffCaps.ts", "a manager's 8 per-person rows are exactly the 8 grant rows of the Manager section", node, () => eq(C.capKeysForRole("manager").sort(), N.filter((n) => n.bind.t === "grant").map((n) => n.bind.flag).sort()));
  await K("lib/staffCaps.ts", "a waiter's 9 per-person rows are exactly the Waiter section's 8 columns + the walk-out", node, () => eq(C.capKeysForRole("tablet").sort(), [...T.TABLET_COLS, "cap:close_unpaid"].sort()));
  await K("lib/staffCaps.ts", "an owner has 0 per-person rows (all read-only)", node, () => eq(C.capKeysForRole("owner"), []));
  await K("lib/staffCaps.ts", "a manager's page lists every row Access → Manager has (grant/opt/limit/tab)", node, () => { const want = []; T.walk(T.SECTION_BY_ID.mgrMenu.children, (n) => { if (["grant", "opt", "limit", "tab"].includes(n.bind.t)) want.push(n.id); }); eq(C.capsForRole("manager").map((c) => c.node.id).sort(), want.sort()); });
  await K("lib/staffCaps.ts", "an owner's page lists every row Access → Owner has", node, () => { const want = []; T.walk(T.SECTION_BY_ID.ownMenu.children, (n) => { if (["section", "opt"].includes(n.bind.t)) want.push(n.id); }); eq(C.capsForRole("owner").map((c) => c.node.id).sort(), want.sort()); });
  await K("lib/staffCaps.ts", "a waiter's page lists every row Access → Waiter has", node, () => { const want = []; T.walk(T.SECTION_BY_ID.waiter.children, (n) => { if (n.bind.t !== "none") want.push(n.id); }); eq(C.capsForRole("tablet").map((c) => c.node.id).sort(), want.sort()); });
  await K("lib/staffCaps.ts", "the walk-out row offers the PIN state; the floor rows do not", node, () => { assert(cap("tablet", "cap:close_unpaid").pin); assert(!cap("tablet", "tablet_take_orders").pin); });
  await K("lib/staffCaps.ts", "the three waiter money rows all offer the PIN state", node, () => assert(["tablet_mark_paid", "tablet_discount", "cap:close_unpaid"].every((k) => cap("tablet", k).pin)));
  await K("lib/staffCaps.ts", "no manager row offers the PIN state (a manager IS the PIN authority)", node, () => assert(C.capsForRole("manager").every((c) => !c.pin)));
  await K("lib/staffCaps.ts", "the walk-out's restaurant answer is 'pin' on an empty restaurant", node, () => eq(C.roleDefault(cap("tablet", "cap:close_unpaid"), empty), "pin"));
  await K("lib/staffCaps.ts", "the walk-out follows access_config.close_unpaid.tablet when stored", node, () => eq(C.roleDefault(cap("tablet", "cap:close_unpaid"), { ...empty, config: { close_unpaid: { tablet: "off" } } }), "off"));
  await K("lib/staffCaps.ts", "a waiter's discount row inherits the restaurant's discount Feature half", node, () => eq(cap("tablet", "tablet_discount").node.featureBind?.id, "give_discounts"));
  await K("lib/staffCaps.ts", "the waiter's discount ceiling is a VALUE row, read-only", node, () => { const c = cap("tablet", "limit:give_discounts.waiter"); eq([c.kind, c.perPerson], ["value", false]); });
  await K("lib/staffCaps.ts", "the waiter ceiling vanishes with the discount feature", node, () => eq(C.capVisible(cap("tablet", "limit:give_discounts.waiter"), { ...empty, config: { give_discounts: { on: false } } }), false));
  await K("lib/staffCaps.ts", "the reopen window vanishes with the reopen feature", node, () => eq(C.capVisible(cap("manager", "limit:void_bills.minutes"), { ...empty, config: { void_bills: { on: false } } }), false));
  await K("lib/staffCaps.ts", "the log views vanish with the Audit tab's Feature half", node, () => eq(C.capVisible(cap("manager", "opt:view_logs.manager.activity"), { ...empty, tabs: { manager: { log: false } } }), false));
  await K("lib/staffCaps.ts", "the dashboard reach never vanishes (no Feature half above it)", node, () => eq(C.capVisible(cap("manager", "opt:view_dashboard.manager.range"), { ...empty, tabs: { manager: { editor: false, ratings: false, log: false } } }), true));
  await K("lib/staffCaps.ts", "the bills reach never vanishes (the Bills tab is fixed)", node, () => eq(C.capVisible(cap("manager", "opt:view_bills.manager.range"), { ...empty, config: { void_bills: { on: false }, give_discounts: { on: false } } }), true));
  await K("lib/staffCaps.ts", "the mgrset rows show 'on' by default and follow menus.mgrset", node, () => { eq(C.roleDefault(cap("manager", "mgrset:users"), empty), "on"); eq(C.roleDefault(cap("manager", "mgrset:users"), { ...empty, tabs: { mgrset: { users: false } } }), "off"); });
  await K("lib/staffCaps.ts", "a manager's own value beats the restaurant's for every per-person row", node, () => { for (const c of C.capsForRole("manager").filter((c) => c.perPerson)) { eq(C.effectiveCap(c, empty, { [c.key]: "off" }), "off", c.key); eq(C.effectiveCap(c, empty, { [c.key]: "on" }), "on", c.key); } });
  await K("lib/staffCaps.ts", "a waiter's own value beats the restaurant's for every per-person row", node, () => { for (const c of C.capsForRole("tablet").filter((c) => c.perPerson)) for (const v of c.pin ? ["on", "off", "pin"] : ["on", "off"]) eq(C.effectiveCap(c, empty, { [c.key]: v }), v, c.key); });
  await K("lib/staffCaps.ts", "a stored 'pin' on a manager row is shown as the restaurant's answer? (effectiveCap)", node, () => { const c = cap("manager", "void_bills"); const v = C.effectiveCap(c, empty, { void_bills: "pin" }); return `answers "${v}" — the write routes refuse "pin" for a manager row, so it cannot be stored through the product`; });
  await K("lib/staffCaps.ts", "countOverrides counts 'pin' on a waiter row", node, () => eq(C.countOverrides("tablet", { tablet_mark_paid: "pin" }), 1));
  await K("lib/staffCaps.ts", "countOverrides ignores a junk value on a real key", node, () => eq(C.countOverrides("tablet", { tablet_mark_paid: "maybe" }), 0));
  await K("lib/staffCaps.ts", "countOverrides survives a null / array permissions value", node, () => { eq(C.countOverrides("tablet", null), 0); eq(C.countOverrides("tablet", []), 0); });
  await K("lib/staffCaps.ts", "countOverrides for a kitchen person is always 0", node, () => eq(C.countOverrides("kitchen", { tablet_mark_paid: "on" }), 0));
  await K("lib/staffCaps.ts", "an owner-row override never counts (owner rows are read-only)", node, () => eq(C.countOverrides("owner", { "section:reports": "off" }), 0));
  await K("lib/staffCaps.ts", "roleValueLabel of the reopen window reads '5 min'", node, () => eq(C.roleValueLabel(cap("manager", "limit:void_bills.minutes"), empty), "5 min"));
  await K("lib/staffCaps.ts", "roleValueLabel of the bills reach reads 'Today only'", node, () => eq(C.roleValueLabel(cap("manager", "opt:view_bills.manager.range"), empty), "Today only"));
  await K("lib/staffCaps.ts", "roleValueLabel of a stored value off the menu shows the raw value, never 'undefined'", node, () => eq(C.roleValueLabel(cap("manager", "opt:view_bills.manager.range"), { ...empty, config: { view_bills: { manager_opts: { range: "last99" } } } }), "last99"));
  await K("lib/staffCaps.ts", "roleValueLabel of an Edit-menu part reads On / Off", node, () => { eq(C.roleValueLabel(cap("manager", "opt:edit_menu.manager.edit_price"), empty), "On"); eq(C.roleValueLabel(cap("manager", "opt:edit_menu.manager.edit_3d"), empty), "Off"); });
  await K("lib/staffCaps.ts", "capGroupsForRole keeps the Access screen's group order for a waiter", node, () => eq(C.capGroupsForRole("tablet").map((g) => g.group), [C.GROUP_WAITER_MONEY, C.GROUP_WAITER_FLOOR]));
  await K("lib/staffCaps.ts", "capGroupsForRole('owner') is one group", node, () => eq(C.capGroupsForRole("owner").map((g) => g.group), [C.GROUP_OWNER]));
  await K("lib/staffCaps.ts", "no 'todo:' placeholder row reaches any person's page today", node, () => assert(!["owner", "manager", "tablet"].some((r) => C.capsForRole(r).some((c) => c.key.startsWith("todo:")))));
  await K("lib/staffCaps.ts", "capsForRole is deterministic (two calls, same keys in the same order)", node, () => eq(C.capsForRole("manager").map((c) => c.key), C.capsForRole("manager").map((c) => c.key)));
  await K("lib/staffCaps.ts", "capsForRole('admin') is empty — the admin has no person page of permissions", node, () => eq(C.capsForRole("admin"), []));
  await K("lib/staffCaps.ts", "isCapValue('default') is allowed in the states list", node, () => assert(C.isCapValue("default", false) && C.isCapValue("default", true)));
  await K("lib/staffCaps.ts", "both write routes refuse 'default' as a stored value (it means delete)", "read both set_permissions handlers", () => { for (const f of [adminUsers, ownerStaff]) assert(/v === "default"\) \{ delete merged\[k\]/.test(f)); });
  await K("lib/staffCaps.ts", "both write routes refuse a key the role does not have, in words", read, () => { for (const f of [adminUsers, ownerStaff]) assert(/isn't a permission a \$\{u\.role\} has/.test(f)); });
  await K("lib/staffCaps.ts", "both write routes allow-list from capsForRole(u.role) — the person's role, not the caller's", read, () => { for (const f of [adminUsers, ownerStaff]) assert(/capsForRole\(u\.role\)/.test(f)); });
  await K("lib/staffCaps.ts", "both write routes keep only perPerson rows writable", read, () => { assert(/c\.key === k && c\.perPerson/.test(adminUsers)); assert(/capsForRole\(u\.role\)\.filter\(\(c\) => c\.perPerson\)/.test(ownerStaff)); });
  await K("lib/staffCaps.ts", "a manager editing a junior may only REDUCE (off/default), never grant", "read the owner route's least-privilege branch", () => { assert(!/may NOT GRANT \(on\/pin\)/.test(ownerStaff)); assert(/if \(s\.actor !== "admin"\) return bad\("Permissions are set by Aevidine/.test(ownerStaff)); return "EXPECTATION MOVED (item 16): nobody but the admin changes a permission, so there is no reduce-only branch left to keep honest"; });
  await K("lib/staffCaps.ts", "AccessPerPerson and StaffProfile both import the one list", "grep the two components", () => { for (const f of ["components/admin/AccessPerPerson.tsx", "components/admin/StaffProfile.tsx"]) assert(/from "@\/lib\/staffCaps"/.test(src(f)), f); });
  // staffProfileShared edge inputs
  const mp = (patch, cur = {}) => P.mergeProfilePatch(cur, patch, P.PROFILE_FIELDS);
  await K("lib/staffProfileShared.ts", "a text field given an OBJECT is not stored as '[object Object]'", node, () => { const o = mp({ full_name: { a: 1 } }); assert(o.full_name !== "[object Object]", `stored "${o.full_name}"`); });
  await K("lib/staffProfileShared.ts", "a text field given an ARRAY is not stored as 'a,b'", node, () => { const o = mp({ city: ["Surat", "Pune"] }); assert(o.city !== "Surat,Pune", `stored "${o.city}"`); });
  await K("lib/staffProfileShared.ts", "a text field given a number is stored as its digits", node, () => eq(mp({ pincode: 380015 }).pincode, "380015"));
  await K("lib/staffProfileShared.ts", "a whitespace-only field clears it", node, () => eq(mp({ city: "   " }, { city: "X" }), {}));
  await K("lib/staffProfileShared.ts", "a field is trimmed before it is stored", node, () => eq(mp({ city: "  Surat  " }).city, "Surat"));
  await K("lib/staffProfileShared.ts", "a name keeps Devanagari and Gujarati as typed", node, () => { eq(mp({ full_name: "रमेश पटेल" }).full_name, "रमेश पटेल"); eq(mp({ full_name: "રમેશ" }).full_name, "રમેશ"); });
  await K("lib/staffProfileShared.ts", "a 200-character cap on a short field, 500 on address and notes", node, () => { eq(mp({ email: "e".repeat(300) }).email.length, 200); eq(mp({ notes: "n".repeat(900) }).notes.length, 500); });
  await K("lib/staffProfileShared.ts", "a last-4 field with letters keeps only the digits", node, () => eq(mp({ id_last4: "AB12CD34" }).id_last4, "1234"));
  await K("lib/staffProfileShared.ts", "a last-4 field with no digits at all clears it", node, () => eq(mp({ id_last4: "ABCD" }, { id_last4: "1111" }), {}));
  await K("lib/staffProfileShared.ts", "id_verified false clears the flag (no stored false)", node, () => eq(mp({ id_verified: false }, { id_verified: true }), {}));
  await K("lib/staffProfileShared.ts", "a person editing themselves cannot touch id_type / id_last4 / id_verified / notes", node, () => eq(P.mergeProfilePatch({}, { id_type: "PAN", id_last4: "1234", id_verified: true, notes: "x" }, P.SELF_PROFILE_FIELDS), {}));
  await K("lib/staffProfileShared.ts", "a patch with __proto__ cannot reach the stored object's prototype", node, () => { const o = P.mergeProfilePatch({}, JSON.parse('{"__proto__":{"x":1},"city":"A"}'), P.PROFILE_FIELDS); eq(Object.getPrototypeOf(o), Object.prototype); eq(o.x, undefined); });
  await K("lib/staffProfileShared.ts", "mergeProfilePatch never mutates the current object", node, () => { const cur = { city: "A" }; P.mergeProfilePatch(cur, { city: "B" }, P.PROFILE_FIELDS); eq(cur, { city: "A" }); });
  await K("lib/staffProfileShared.ts", "a real birth date is kept; an impossible one (30 Feb) is not stored (item 3)", node, () => { eq(mp({ dob: "1990-06-01" }).dob, "1990-06-01"); eq(mp({ dob: "1990-02-30" }), {}); });
  await K("lib/staffProfileShared.ts", "an impossible joining date is refused in words (item 3)", node, () => { let t = ""; try { P.jobPatchFrom({ joined_on: "2026-02-30" }); } catch (e) { t = e.message; } assert(/joining date isn't a real date/.test(t), t || "accepted"); });
  await K("lib/staffProfileShared.ts", "an impossible payment date is refused, not made today (item 3)", node, () => { let t = ""; try { P.paymentFrom({ amount: 10, paid_on: "2026-09-31" }); } catch (e) { t = e.message; } assert(/payment date isn't a real date/.test(t), t || "accepted"); });
  await K("lib/staffProfileShared.ts", "an empty payment date still means today", node, () => eq(P.paymentFrom({ amount: 10, paid_on: "" }).paid_on, P.todayIST()));
  await K("lib/staffProfileShared.ts", "Mark-as-left's own clear (left_on '') still clears", node, () => eq(P.jobPatchFrom({ left_on: "" }).left_on, null));
  await K("lib/staffProfileShared.ts", "a pay amount with ₹, commas and spaces is read as a number", node, () => eq(P.jobPatchFrom({ pay_amount: "₹ 1,23,456.50" }).pay_amount, 123456.5));
  await K("lib/staffProfileShared.ts", "a pay amount of exactly 99,999,999 is accepted (the ceiling is inclusive)", node, () => eq(P.jobPatchFrom({ pay_amount: 99999999 }).pay_amount, 99999999));
  await K("lib/staffProfileShared.ts", "Infinity and NaN pay amounts are refused", node, () => { for (const v of ["Infinity", "NaN"]) { let ok = false; try { P.jobPatchFrom({ pay_amount: v }); } catch { ok = true; } assert(ok, v); } });
  await K("lib/staffProfileShared.ts", "an empty pay amount clears it (null), not 0", node, () => eq(P.jobPatchFrom({ pay_amount: "" }).pay_amount, null));
  await K("lib/staffProfileShared.ts", "a pay_extras entry with a junk kind becomes an allowance", node, () => eq(P.jobPatchFrom({ pay_extras: [{ label: "x", kind: "bonus??", amount: 5 }] }).pay_extras[0].kind, "allowance"));
  await K("lib/staffProfileShared.ts", "a pay_extras entry with no label is labelled 'Extra'", node, () => eq(P.jobPatchFrom({ pay_extras: [{ amount: 5 }] }).pay_extras[0].label, "Extra"));
  await K("lib/staffProfileShared.ts", "a negative pay_extras amount is refused", node, () => { let ok = false; try { P.jobPatchFrom({ pay_extras: [{ amount: -1 }] }); } catch { ok = true; } assert(ok); });
  await K("lib/staffProfileShared.ts", "pay_extras given a non-array stores an empty list", node, () => eq(P.jobPatchFrom({ pay_extras: "nope" }).pay_extras, []));
  await K("lib/staffProfileShared.ts", "weekly_off given a string stores null, not letters", node, () => eq(P.jobPatchFrom({ weekly_off: "mon" }).weekly_off, null));
  await K("lib/staffProfileShared.ts", "an empty job patch is an empty object (nothing written)", node, () => eq(P.jobPatchFrom({}), {}));
  await K("lib/staffProfileShared.ts", "jobPatchFrom ignores keys it does not know (no free column write)", node, () => eq(P.jobPatchFrom({ role: "owner", pay_type: "daily" }), { pay_type: "daily" }));
  await K("lib/staffProfileShared.ts", "a payment of 0.004 rounds to 0 and is still refused? (amount must be > 0 BEFORE rounding)", node, () => { let msg = ""; try { P.paymentFrom({ amount: 0.004 }); } catch (e) { msg = e.message; } eq(msg, "Enter an amount greater than zero."); return "FIXED (item 13): refused after rounding"; });
  await K("lib/staffProfileShared.ts", "a payment note is trimmed to 200 characters", node, () => eq(P.paymentFrom({ amount: 1, note: "n".repeat(500) }).note.length, 200));
  await K("lib/staffProfileShared.ts", "a payment with no kind is a salary, with no mode is cash", node, () => { const r = P.paymentFrom({ amount: 1 }); eq([r.kind, r.mode], ["salary", "cash"]); });
  await K("lib/staffProfileShared.ts", "a payment dated yesterday (back-dated) is accepted", node, () => { const y = new Date(Date.now() + 5.5 * 3600e3 - 864e5).toISOString().slice(0, 10); eq(P.paymentFrom({ amount: 1, paid_on: y }).paid_on, y); });
  await K("lib/staffProfileShared.ts", "a pay period typed as '2026-04' and '2026-04-30' both land on the 1st", node, () => { eq(P.paymentFrom({ amount: 1, for_period: "2026-04" }).for_period, "2026-04-01"); eq(P.paymentFrom({ amount: 1, for_period: "2026-04-30" }).for_period, "2026-04-01"); });
  await K("lib/staffProfileShared.ts", "istDateOf on garbage answers today rather than throwing", node, () => eq(P.istDateOf("not a date"), P.todayIST()));
  await K("lib/staffProfileShared.ts", "istDateOf at the IST midnight edge: 18:29:59Z is still the same day", node, () => eq(P.istDateOf("2026-10-08T18:29:59Z"), "2026-10-08"));
  await K("lib/staffProfileShared.ts", "completeness: a whitespace-only field does not count as filled", node, () => eq(P.completeness({ phone: "   " }).filled, 0));
  await K("lib/staffProfileShared.ts", "completeness: ID on file needs BOTH type and last 4", node, () => { eq(P.completeness({ profile: { id_type: "PAN" } }).missing.includes("ID on file"), true); eq(P.completeness({ profile: { id_type: "PAN", id_last4: "1234" } }).missing.includes("ID on file"), false); });
  await K("lib/staffProfileShared.ts", "completeness: pay setup needs both type and amount (0 counts as an amount)", node, () => eq(P.completeness({ pay_type: "daily", pay_amount: 0 }).missing.includes("pay setup"), false));
  await K("lib/staffProfileShared.ts", "the self count is 8 of the 14 (a waiter is never asked for their own salary)", node, () => eq(P.completeness({}).selfTotal, 8));
  await K("lib/staffProfile.ts", "payAccessWith for an unknown actor kind falls to the manager rules, not admin", node, () => eq(SP.payAccessWith("waiter", {}, true).canEditJobPay, false));
  await K("lib/staffProfile.ts", "a stored string 'true' grant is not honoured (booleans only)", node, () => eq(SP.payAccessWith("manager", { manager_permissions: { see_staff_pay: "true" } }, true).canSeePay, false));
  await K("lib/staffProfile.ts", "a stored false on a low-risk power is honoured", node, () => eq(SP.payAccessWith("manager", { manager_permissions: { record_staff_payment: false } }, true).canRecordPay, false));
  await K("lib/staffProfile.ts", "payAccess reads the payroll module for THAT restaurant id", "drive payAccess with a stand-in ladder", async () => { const seen = []; globalThis.__t18 = { payroll: (rid) => { seen.push(rid); return true; } }; await SP.payAccess("owner", {}, "rid-x"); eq(seen, ["rid-x"]); });
  await K("lib/staffProfile.ts", "PAY_HISTORY_DELETE_MESSAGE(0) is never shown (a 0 count is not blocked)", "drive payHistoryBlocksDelete with count 0", async () => eq((await SP.payHistoryBlocksDelete({ from: fakeClient(() => ({ count: 0 })).from }, "s")).blocked, false));
  await K("lib/staffProfile.ts", "a count that comes back null with no error reads as 0, not blocked", "drive", async () => eq(await SP.payHistoryBlocksDelete({ from: fakeClient(() => ({ count: null, error: null })).from }, "s"), { blocked: false, count: 0 }));

  // ═════════════ P187301–P187340 · ownerEntitlements · accessConfig · accessState · viewAsPerson ═════════════
  setN(187300);
  await K("lib/ownerEntitlements.ts", "OWNER_SECTION_KEYS equals the Access screen's owner section keys", node, () => eq([...OE.OWNER_SECTION_KEYS].sort(), [...T.SECTION_ENTITLEMENTS].sort()));
  await K("lib/ownerEntitlements.ts", "a stored false wins; a stored 'false' string does not", node, () => { const m = OE.mergeOwnerEntitlements({ reports: false, menu: "false" }); eq([m.reports, m.menu], [false, true]); });
  await K("lib/ownerEntitlements.ts", "an unknown key in the stored bag never appears in the answer", node, () => assert(!("bogus" in OE.mergeOwnerEntitlements({ bogus: false }))));
  await K("lib/ownerEntitlements.ts", "an array stored where the bag belongs reads all ON", node, () => assert(Object.values(OE.mergeOwnerEntitlements([false])).every(Boolean)));
  await K("lib/ownerEntitlements.ts", "getOwnerEntitlements('') reads nothing and answers all ON", "drive with a counting stand-in", async () => { const cl = fakeClient(() => ({ data: null })); globalThis.__t18 = { sb: { from: cl.from } }; const r = await OE.getOwnerEntitlements(""); eq(cl.calls.length, 0); assert(Object.values(r).every(Boolean)); });
  await K("lib/ownerEntitlements.ts", "getOwnerEntitlements reads ONE column of ONE row", "drive", async () => { const cl = fakeClient(() => ({ data: { owner_entitlements: { reports: false } } })); globalThis.__t18 = { sb: { from: cl.from } }; const r = await OE.getOwnerEntitlements("rid-1"); eq(cl.calls[0].ops.slice(0, 2), [["select", "owner_entitlements"], ["eq", "id", "rid-1"]]); eq(r.reports, false); });
  await K("lib/ownerEntitlements.ts", "a FAILED getOwnerEntitlements read answers all ON (fails open)", "drive with an erroring stand-in", async () => {
    const cl = fakeClient(() => ({ data: null, error: { message: "timeout" } })); globalThis.__t18 = { sb: { from: cl.from } }; const r = await OE.getOwnerEntitlements("rid-1");
    return `all ON: ${Object.values(r).every(Boolean)} — a blip shows the owner every page for one load; the API behind each page still checks entitledSubset (improvement listed, not a fault: the gate is the API)`;
  });
  await K("lib/ownerEntitlements.ts", "entitledSubset([]) reads nothing", "drive", async () => { const cl = fakeClient(() => ({ data: [] })); globalThis.__t18 = { sb: { from: cl.from } }; eq(await OE.entitledSubset([], "reports"), []); eq(cl.calls.length, 0); });
  await K("lib/ownerEntitlements.ts", "entitledSubset drops a restaurant whose key is false, keeps one where it is absent", "drive", async () => { globalThis.__t18 = { sb: { from: fakeClient(() => ({ data: [{ id: "a", owner_entitlements: { reports: false } }, { id: "b", owner_entitlements: {} }] })).from } }; eq(await OE.entitledSubset(["a", "b"], "reports"), ["b"]); });
  await K("lib/ownerEntitlements.ts", "entitledSubset reads with a column list and a limit", "drive", async () => { const cl = fakeClient(() => ({ data: [] })); globalThis.__t18 = { sb: { from: cl.from } }; await OE.entitledSubset(["a"], "reports"); const ops = cl.calls[0].ops.map((o) => o[0]); assert(ops.includes("select") && ops.includes("in") && ops.includes("limit")); eq(cl.calls[0].ops[0][1], "id, owner_entitlements"); });
  await K("lib/ownerEntitlements.ts", "logViewSubset keeps a restaurant with no view_logs opts (absent = ON)", "drive", async () => { globalThis.__t18 = { sb: { from: fakeClient(() => ({ data: [{ id: "a", access_config: {} }, { id: "b", access_config: { view_logs: { owner_opts: { activity: false } } } }] })).from } }; eq(await OE.logViewSubset(["a", "b"], "activity"), ["a"]); });
  await K("lib/ownerEntitlements.ts", "logViewSubset: switching 'removals' off does not hide 'activity'", "drive", async () => { globalThis.__t18 = { sb: { from: fakeClient(() => ({ data: [{ id: "a", access_config: { view_logs: { owner_opts: { removals: false } } } }] })).from } }; eq(await OE.logViewSubset(["a"], "activity"), ["a"]); });
  await K("lib/ownerEntitlements.ts", "the union shows a section if ANY owned restaurant has it", "drive", async () => { globalThis.__t18 = { sb: { from: fakeClient(() => ({ data: [{ owner_entitlements: { reports: false } }, { owner_entitlements: {} }] })).from } }; eq((await OE.getOwnerEntitlementsUnion(["a", "b"])).reports, true); });
  await K("lib/ownerEntitlements.ts", "the union hides it when EVERY owned restaurant has it off", "drive", async () => { globalThis.__t18 = { sb: { from: fakeClient(() => ({ data: [{ owner_entitlements: { reports: false } }, { owner_entitlements: { reports: false } }] })).from } }; eq((await OE.getOwnerEntitlementsUnion(["a", "b"])).reports, false); });
  await K("lib/ownerEntitlements.ts", "powerEntitled still answers its documented shape (kept only for the record)", node, () => { assert(!("powerEntitled" in OE)); eq(OE.powerEntitlementKey("x"), "power_x"); return "EXPECTATION MOVED (item 26): removed — nothing called it; the key's shape survives in powerEntitlementKey"; });
  await K("lib/ownerEntitlements.ts", "it is server-only: no client component imports it", "grep 'use client' files", () => { const f = grep("lib/ownerEntitlements[\"']", "app components").filter((p) => /^["']use client["']/m.test(src(p))); eq(f, []); });
  await K("lib/accessConfig.ts", "MP_DEFAULT has no key the Access tree and the power list both lack", node, () => assert(Object.keys(AC.MP_DEFAULT).every((k) => M.MANAGER_POWER_FLAGS.includes(k) || k in T.MANAGER_GRANT_DEFAULTS)));
  await K("lib/accessConfig.ts", "MP_DEFAULT is a plain object a JSONB column accepts", node, () => eq(JSON.parse(JSON.stringify(AC.MP_DEFAULT)), AC.MP_DEFAULT));
  await K("lib/accessConfig.ts", "view_logs (absent-ON in enforcement) is seeded ON, matching what canViewLogs reads", node, () => eq(AC.MP_DEFAULT.view_logs, true));
  await K("lib/accessConfig.ts", "edit_menu and view_dashboard seeded ON (the owner's baseline)", node, () => eq([AC.MP_DEFAULT.edit_menu, AC.MP_DEFAULT.view_dashboard], [true, true]));
  const drive = async (rest, set, opts = {}) => { const cl = fakeClient((q) => (q.table === "restaurants" ? (opts.rErr ? { data: null, error: { m: 1 } } : { data: rest, error: null }) : (opts.sErr ? { data: null, error: { m: 1 } } : { data: set, error: null }))); globalThis.__t18 = { sb: { from: cl.from } }; return { st: await AS.accessStateFor("rid"), calls: cl.calls }; };
  await K("lib/accessState.ts", "a FAILED restaurants read answers null and never reads settings", "drive", async () => { const r = await drive(null, {}, { rErr: true }); eq(r.st, null); eq(r.calls.length, 1); });
  await K("lib/accessState.ts", "a restaurant with NO settings row still answers a state (not null)", "drive with settings data:null, no error", async () => { const r = await drive({}, null); assert(r.st && typeof r.st === "object"); eq(r.st.channels, { website: false, zomato: false, swiggy: false }); });
  await K("lib/accessState.ts", "a key shorter than 4 characters is masked how?", "drive with a 3-character key", async () => { const r = await drive({}, { platform_channels: { zomato: { key: "abc" } } }); return `"${r.st.creds.zomato}" — a key this short is shown whole behind the dots (no real channel key is this short; improvement listed)`; });
  await K("lib/accessState.ts", "a key that is not a string is never echoed", "drive with a number key", async () => eq((await drive({}, { platform_channels: { zomato: { key: 12345678 } } })).st.creds.zomato, ""));
  await K("lib/accessState.ts", "the settings select never includes an api_key / password column", "drive", async () => { const r = await drive({}, {}); const sel = r.calls[1].ops.find((o) => o[0] === "select")[1]; assert(!/key|password|hash|secret/.test(sel.replace("platform_channels", ""))); });
  await K("lib/accessState.ts", "a menus tab stored as a string is dropped (booleans only)", "drive", async () => eq((await drive({ access_config: { menus: { manager: { editor: "false" } } } }, {})).st.tabs.manager, {}));
  await K("lib/accessState.ts", "every tab panel the model knows gets an object, even with nothing stored", "drive", async () => eq(Object.keys((await drive({}, {})).st.tabs).sort(), Object.keys(T.TAB_ALLOWED).sort()));
  await K("lib/accessState.ts", "a settings column not in the tree never reaches the browser", "drive with an unrelated column", async () => assert(!("unrelated" in (await drive({}, { unrelated: 1 })).st.settings)));
  const PID = "51111111-2222-3333-4444-555555555555";
  const rq = (as, cookie = "c") => ({ nextUrl: { searchParams: new URLSearchParams(as ? { as } : {}) }, cookies: { get: () => (cookie ? { value: cookie } : undefined) } });
  const va = async (row, req, rid = "r1", role = "manager", g = { user: null }) => { const cl = fakeClient(() => ({ data: row ? [row] : [], error: null })); globalThis.__t18 = { sb: { from: cl.from }, tokenOk: (t) => !!t }; return { u: await VA.viewAsPerson(req, rid, g, role), calls: cl.calls }; };
  await K("lib/viewAsPerson.ts", "a matching active person on the same restaurant IS returned", "drive", async () => eq((await va({ id: PID, role: "manager", restaurant_id: "r1" }, rq(PID))).u?.id, PID));
  await K("lib/viewAsPerson.ts", "no ?as= at all reads nothing and answers null", "drive", async () => { const r = await va({ id: PID }, rq(null)); eq([r.u, r.calls.length], [null, 0]); });
  await K("lib/viewAsPerson.ts", "no admin cookie answers null", "drive", async () => eq((await va({ id: PID, role: "manager", restaurant_id: "r1" }, rq(PID, null))).u, null));
  await K("lib/viewAsPerson.ts", "the person read filters active = true", "drive", async () => { const r = await va(null, rq("61111111-2222-3333-4444-555555555555")); assert(r.calls[0].ops.some((o) => o[0] === "eq" && o[1] === "active" && o[2] === true)); });
  await K("lib/viewAsPerson.ts", "the person read is one row by primary key", "drive", async () => { const r = await va(null, rq("71111111-2222-3333-4444-555555555555")); assert(r.calls[0].ops.some((o) => o[0] === "eq" && o[1] === "id")); assert(r.calls[0].ops.some((o) => o[0] === "limit" && o[1] === 1)); });
  await K("lib/viewAsPerson.ts", "a person with no restaurant is never shown on any restaurant", "drive", async () => eq((await va({ id: "81111111-2222-3333-4444-555555555555", role: "manager", restaurant_id: null }, rq("81111111-2222-3333-4444-555555555555"))).u, null));
  await K("lib/viewAsPerson.ts", "personLabel prefers the name, then the login, else null", node, () => { eq(VA.personLabel({ name: "Asha", username: "a1" }), "Asha"); eq(VA.personLabel({ name: "", username: "a1" }), "a1"); eq(VA.personLabel(null), null); });
  await K("lib/viewAsPerson.ts", "isPersonId accepts upper-case hex and refuses a 35-character id", node, () => { assert(VA.isPersonId("ABCDEF12-2222-3333-4444-555555555555")); assert(!VA.isPersonId("ABCDEF12-2222-3333-4444-55555555555")); });
  await K("lib/viewAsPerson.ts", "the pin changes only what is SHOWN — the header says writes stay the admin's", read, () => assert(/It does NOT change who is WRITING/.test(vaSrc)));

  // ═════════════ P187341–P187380 · conformance to the project rules for this area ═════════════
  setN(187340);
  await K("lib/accessTree.ts", "rule: a toggle exists only where the owner listed one — no row without a bind or a reason", node, () => eq(N.filter((n) => n.bind.t === "none" && !n.children?.length && !n.leftToBuild && !n.panel).length, 0));
  await K("lib/accessTree.ts", "rule: the admin holds every permission — the only writer of access_config/owner_entitlements/manager_permissions is an admin route", "grep app/api for writes of those columns", () => {
    const writers = grep("(access_config|owner_entitlements|manager_permissions)[\"']?\\s*:", "app/api").filter((f) => /\.update\(|\.upsert\(|\.insert\(/.test(src(f)));
    const nonAdmin = writers.filter((f) => !f.startsWith("app/api/admin/"));
    return nonAdmin.length ? `non-admin files naming those keys in an object literal (read to confirm none write): ${nonAdmin.join(" · ")}` : "only /api/admin/* writes them";
  });
  await K("lib/accessTree.ts", "rule: hiding is never the only guard — every manager tab key is enforced by tabGate on the server", "grep the editor route", () => { const e = src("app/api/editor/[...path]/route.ts"); assert(/async function tabGate|function tabGate/.test(e)); assert(/managerTabOn\(|managerTabsOff\(/.test(e)); });
  await K("lib/accessTree.ts", "rule: hiding is never the only guard — every waiter cap is enforced by tabletPerm", "grep the tablet route", () => assert(/async function tabletPerm|function tabletPerm/.test(src("app/api/tablet/[...path]/route.ts"))));
  await K("lib/accessTree.ts", "rule: REJECTED R27 — no grantable delete-a-bill, the marker present", read, () => assert(/REJECTED \(owner, 2026-08-16\) — docs\/REJECTED-IDEAS\.md → R27/.test(treeSrc)));
  await K("lib/staffProfileShared.ts", "rule: REJECTED R7 — kitchen has no profile, marker present", read, () => assert(/R7/.test(src("lib/staffProfileShared.ts"))));
  await K("lib/features.ts", "rule: the four backend-only flags have no row on the Access screen", node, () => eq(T.FEATURE_KEYS.filter((k) => ["verification", "payments", "aggregators", "gst_invoice"].includes(k)), []));
  await K("lib/features.ts", "rule: …and no panel or component renders a control for them", "grep components and panels for a toggle bound to them", () => { const hits = grep("features\\.(verification|payments|aggregators|gst_invoice)", "components public/panels app"); return hits.length ? `read-only uses: ${hits.join(" · ")}` : "no file reads them in a UI"; });
  await K("lib/accessModel.ts", "rule (mig 326): a new module adds NO settings column — the newest module is bag-backed", node, () => assert(M.PERMISSIONS.find((q) => q.id === "loyalty").moduleBag));
  await K("lib/accessTree.ts", "rule: every new staff-facing switch defaults OFF unless the owner said otherwise (Extra features all OFF)", node, () => eq(T.SECTION_BY_ID.extra.children.map((n) => n.def), [false, false, false, false, false]));
  await K("lib/accessTree.ts", "rule (no silent overwrites): every switch that can carry an expectation does", node, () => { const silent = N.filter((n) => ["feature", "setting", "module", "moduleBag", "grant", "section", "choice", "text", "list", "tablet"].includes(n.bind.t)).filter((n) => !T.nodeExpect(n, T.applyPatch(empty, T.nodePatch(n, n.def ?? true)), "r")); eq(silent.map((n) => n.id), []); });
  await K("lib/accessTree.ts", "rule (no silent overwrites): the rows that cannot are the documented two-level ones", node, () => { const none = N.filter((n) => !["none", "creds"].includes(n.bind.t) && !T.nodeExpect(n, T.applyPatch(empty, T.nodePatch(n, n.def ?? true)), "r")).map((n) => n.bind.t); assert(none.every((t) => ["tab", "has", "capTablet", "opt", "limit", "channel", "ratingsMaster"].includes(t)), [...new Set(none)].join(",")); return `uncovered kinds: ${[...new Set(none)].join(", ")} (channel/ratingsMaster too — see Part 4)`; });
  await K("lib/accessTree.ts", "rule (egress): the access-tree route reads one restaurant's state via accessStateFor, scoped", read, () => assert(/accessStateFor\(rid\)/.test(src("app/api/admin/restaurants/access-tree/route.ts"))));
  await K("lib/accessTree.ts", "rule: every admin route this model feeds checks tokenIsValid before any DB call", "read the access-tree route's GET and POST", () => { const r = src("app/api/admin/restaurants/access-tree/route.ts"); const g = r.indexOf("export async function GET"), p = r.indexOf("export async function POST"); for (const at of [g, p]) { const body = r.slice(at, at + 400); assert(/if \(!\(await gate\(req\)\)\) return/.test(body), body.slice(0, 120)); } });
  await K("lib/staffCaps.ts", "rule: the admin users route checks the admin token first in every verb", read, () => { assert(/async function admin\(req: NextRequest\)[\s\S]{0,200}tokenIsValid/.test(adminUsers)); const v = [...adminUsers.matchAll(/export async function (GET|POST|PATCH|DELETE)\(req: NextRequest\) \{\n\s*if \(!\(await admin\(req\)\)\) return bad\("unauthorized", 401\);/g)].map((m) => m[1]); eq(v.sort(), ["DELETE", "GET", "PATCH", "POST"]); });
  await K("lib/staffCaps.ts", "rule: the owner staff route resolves the caller through scope() before every verb", read, () => { const verbs = [...ownerStaff.matchAll(/(?:export async function (GET)|async function (postImpl|patchImpl|deleteImpl))\(req: NextRequest\)[^{]*\{\n\s*const s = await scope\(req\); if \(!s\.ok\) return s\.resp;/g)].map((m) => m[1] || m[2]); eq(verbs.sort(), ["GET", "deleteImpl", "patchImpl", "postImpl"]); return "GET + the three withIdempotency bodies"; });
  await K("lib/accessState.ts", "rule: the owner staff route reads a person only inside the caller's restaurants", read, () => assert(/\.eq\("id", id\)\.in\("restaurant_id", ids\)/.test(ownerStaff)));
  await K("lib/viewAsPerson.ts", "rule: every caller refuses an empty restaurant before asking for a pin", "read the four callers", () => { assert(/if \(!rid\) return err/.test(src("app/api/tablet/[...path]/route.ts"))); assert(/if \(!rid\) return err/.test(src("app/api/kitchen/[...path]/route.ts"))); assert(/rid instanceof NextResponse/.test(src("app/api/editor/[...path]/route.ts"))); });
  await K("lib/features.ts", "rule (offline): the feature map falls back to the last-known saved switches", read, () => assert(/readSaved\(restaurantId\) \|\| \(\{ \.\.\.FEATURE_DEFAULTS \}/.test(featSrc)));
  await K("lib/features.ts", "rule (offline): a phone that refuses storage still gets switches (every storage touch is in try)", read, () => { const c = code(featSrc); for (const m of c.matchAll(/localStorage\.\w+/g)) { const before = c.slice(Math.max(0, m.index - 160), m.index); assert(/try \{/.test(before) || /typeof localStorage/.test(before), m[0]); } });
  await K("lib/staffProfileShared.ts", "rule (browser bundle): the shared file imports nothing", read, () => assert(!/^\s*import\s/m.test(src("lib/staffProfileShared.ts"))));
  await K("lib/staffProfile.ts", "rule (browser bundle): no client component imports the server profile file", "grep 'use client' importers", () => eq(grep("lib/staffProfile[\"']", "app components").filter((p) => /^["']use client["']/m.test(src(p))), []));
  await K("lib/accessState.ts", "rule (browser bundle): no client component imports accessState", "grep", () => eq(grep("lib/accessState[\"']", "components app").filter((p) => /^["']use client["']/m.test(src(p))), []));
  await K("lib/viewAsPerson.ts", "rule (browser bundle): no client component imports viewAsPerson", "grep", () => eq(grep("lib/viewAsPerson[\"']", "components app").filter((p) => /^["']use client["']/m.test(src(p))), []));
  await K("lib/accessTree.ts", "rule: accessTree imports nothing, so the client Access screen can bundle it", read, () => assert(!/^\s*import\s/m.test(treeSrc)));
  await K("lib/staffCaps.ts", "rule: staffCaps imports only the tree (safe in a browser)", read, () => eq([...src("lib/staffCaps.ts").matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]), ["@/lib/accessTree"]));
  await K("lib/accessModel.ts", "rule: accessModel imports nothing", read, () => assert(!/^\s*import\s/m.test(src("lib/accessModel.ts"))));
  await K("lib/accessTree.ts", "rule: kitchen has no row anywhere on the Access screen", node, () => assert(!N.some((n) => /kitchen/i.test(n.id) && n.bind.t !== "none")));
  await K("lib/accessTree.ts", "rule: Aangan stays at factory defaults — no code path in this area writes Aangan by name", "grep my files for aangan", () => eq(grep("aangan", "lib/accessTree.ts lib/accessModel.ts lib/accessState.ts lib/staffCaps.ts lib/features.ts lib/ownerEntitlements.ts"), []));
  await K("lib/accessTree.ts", "rule: no secret can ride in a row's words (no key-shaped strings in any help text)", node, () => assert(!N.some((n) => /(sbp_|eyJ[a-zA-Z0-9]{20}|sk_live|[0-9a-f]{40})/.test(n.what || ""))));
  await K("lib/accessTree.ts", "rule: credentials are write-only — nodeValue of a creds row is only ever the mask", node, () => { for (const n of N.filter((n) => n.bind.t === "creds")) eq(T.nodeValue(n, { ...empty, creds: { [n.bind.key]: "••••9999" } }), "••••9999"); });
  await K("lib/accessTree.ts", "rule: the Access screen's credential save never merges the key into page state", "read components/admin/AccessTree.tsx setCreds", () => assert(/Deliberately NOT `save\(\)`/.test(src("components/admin/AccessTree.tsx"))));
  await K("docs/ACCESS-MODEL.md", "rule: CLAUDE.md points at docs/ACCESS-MODEL.md as the spec", read, () => assert(/Spec: `docs\/ACCESS-MODEL\.md`/.test(src("CLAUDE.md"))));
  await K("docs/STAFF-PROFILE.md", "rule: CLAUDE.md points at docs/STAFF-PROFILE.md before adding anything about a person", read, () => assert(/docs\/STAFF-PROFILE\.md/.test(src("CLAUDE.md"))));
  await K("lib/staffProfileShared.ts", "rule: CLAUDE.md names PROFILE_ROLES in lib/staffProfileShared.ts", read, () => assert(/staffProfileShared\.ts` → `PROFILE_ROLES`/.test(src("CLAUDE.md"))));
  await K("lib/accessTree.ts", "rule: verify:access is registered and runs this file", read, () => assert(/lib\/accessTree\.ts/.test(JSON.parse(src("package.json")).scripts["verify:access"])));
  await K("lib/staffProfileShared.test.mjs", "rule: test:units globs lib/*.test.mjs, so the profile test runs", read, () => assert(/lib\/\*\.test\.mjs/.test(JSON.parse(src("package.json")).scripts["test:units"])));
  await K("lib/accessTree.ts", "rule (one way, not two): no second hand-typed list of manager tab keys anywhere", "grep for a literal [\"editor\",\"ratings\",\"log\"]", () => eq(grep("\\[\\s*\"editor\",\\s*\"ratings\",\\s*\"log\"", "app lib public/panels").filter((f) => f !== "lib/accessTree.ts"), []));
  await K("lib/accessTree.ts", "rule (one way, not two): no second WAITER_NEVER list", "grep for a literal tablet_invoice never-list", () => eq(grep("NEVER\\s*=\\s*\\[\\s*\"tablet_invoice\"", "app lib public/panels").filter((f) => f !== "lib/accessTree.ts"), []));
  await K("lib/staffProfileShared.ts", "rule (one way, not two): PROFILE_FIELDS declared once", "grep", () => eq(grep("PROFILE_FIELDS\\s*=\\s*\\[", "app lib components"), ["lib/staffProfileShared.ts"]));
}
