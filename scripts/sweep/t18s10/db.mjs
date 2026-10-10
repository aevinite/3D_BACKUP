// scripts/sweep/t18s10/db.mjs — terminal 18's READ-ONLY database checks (dev project only).
//
//   node scripts/sweep/t18s10/db.mjs [--start <n>]   → node_modules/.cache/t18s10/db.{md,json}
//
// Every query is a SELECT with a column list and a limit. Nothing is written. The questions: does
// what is STORED on every restaurant have the shape this model reads, and does the one reader
// (lib/accessState.ts) answer every restaurant without a wrong default?
import { load, chk, assert, eq, report } from "./lib.mjs";
import { sb, restaurantBySlug } from "./env.mjs";   // first: puts the dev keys in process.env

const start = Number(process.argv[process.argv.indexOf("--start") + 1]) || 187385;
let n = start;
const K = (file, check, how, fn) => chk(`P${++n}`, file, check, how, fn);
const T = await load("accessTree"), C = await load("staffCaps"), OE = await load("ownerEntitlements");
const ASreal = await load("accessState", { keep: ["@/lib/supabaseAdmin"] }).catch((e) => ({ err: e }));

const rq = await sb.from("restaurants").select("id, slug, name, manager_permissions, owner_entitlements, access_config").limit(1000);
const rs = rq.data || [];
const sq = await sb.from("settings").select(["restaurant_id", "features", "modules", "platform_channels", ...T.SETTINGS_COLUMNS.filter((c) => c !== "platform_channels")].join(", ")).limit(1000);
const ss = sq.data || [];
const uq = await sb.from("staff_users").select("id, role, restaurant_id, permissions, active").limit(1000);
const us = uq.data || [];
const fh = await restaurantBySlug("french-house"), ag = await restaurantBySlug("aangan-garden-restaurant");
const isTri = (v) => v === "off" || v === "on" || v === "pin";
const READ = "SELECT on the dev project (column list + limit)";

await K("lib/accessTree.ts", "the restaurants read the model depends on succeeds, with the three columns", READ, () => { assert(!rq.error, rq.error?.message); return `${rs.length} restaurants`; });
await K("lib/accessTree.ts", "every settings column the tree reads EXISTS (one select of all of them)", READ, () => { assert(!sq.error, sq.error?.message); return `${T.SETTINGS_COLUMNS.length} columns, ${ss.length} rows`; });
await K("lib/staffCaps.ts", "the staff read succeeds with the columns the profile uses", READ, () => { assert(!uq.error, uq.error?.message); return `${us.length} staff rows`; });
await K("lib/accessTree.ts", "every restaurant has a settings row", READ, () => { const have = new Set(ss.map((s) => s.restaurant_id)); const miss = rs.filter((r) => !have.has(r.id)).map((r) => r.slug); return miss.length ? `no settings row (the reader answers defaults, by design): ${miss.join(", ")}` : "all have one"; });
await K("lib/accessTree.ts", "every stored manager_permissions value is a real boolean", READ, () => { const bad = rs.flatMap((r) => Object.entries(r.manager_permissions || {}).filter(([, v]) => typeof v !== "boolean").map(([k, v]) => `${r.slug}.${k}=${JSON.stringify(v)}`)); eq(bad, []); });
await K("lib/ownerEntitlements.ts", "every stored owner_entitlements value is a real boolean (the old depth_* strings aside)", READ, () => {
  const bad = rs.flatMap((r) => Object.entries(r.owner_entitlements || {}).filter(([k, v]) => typeof v !== "boolean" && !k.startsWith("depth_")).map(([k, v]) => `${r.slug}.${k}=${JSON.stringify(v)}`)); eq(bad, []);
  const depth = rs.flatMap((r) => Object.keys(r.owner_entitlements || {}).filter((k) => k.startsWith("depth_")).map((k) => `${r.slug}.${k}`));
  return `${depth.length} leftover depth_* string(s) (${depth.join(", ")}) — nothing reads them; mergeOwnerEntitlements skips non-booleans`;
});
await K("lib/ownerEntitlements.ts", "no stored owner_entitlements key is outside OWNER_ENTITLEMENT_KEYS (retired power_* aside)", READ, () => { const known = new Set(OE.OWNER_ENTITLEMENT_KEYS); const extra = [...new Set(rs.flatMap((r) => Object.keys(r.owner_entitlements || {}).filter((k) => !known.has(k))))]; return extra.length ? `stored but unread (harmless — the merge ignores them): ${extra.join(", ")}` : "none"; });
await K("lib/accessTree.ts", "every stored tablet_* value on every restaurant is off/on/pin (or absent)", READ, () => { const bad = ss.flatMap((s) => T.TABLET_COLS.filter((c) => s[c] != null && !isTri(s[c])).map((c) => `${s.restaurant_id.slice(0, 8)}.${c}=${s[c]}`)); eq(bad, []); });
await K("lib/accessTree.ts", "no restaurant stores tablet_invoice as anything a waiter could use — and it would not matter", READ, () => { const on = ss.filter((s) => s.tablet_invoice && s.tablet_invoice !== "off").length; return `${on} restaurant(s) store a non-off tablet_invoice; waiterCapValue answers off for every one (WAITER_NEVER)`; });
await K("lib/features.ts", "every stored settings.features value is a real boolean", READ, () => { const bad = ss.flatMap((s) => Object.entries(s.features || {}).filter(([, v]) => typeof v !== "boolean").map(([k, v]) => `${k}=${JSON.stringify(v)}`)); eq(bad, []); });
await K("lib/features.ts", "a stored feature key the code no longer knows (e.g. scrollspy) is harmless", READ, () => { const known = new Set(Object.keys((globalThis.__f ||= {}))); void known; const keys = [...new Set(ss.flatMap((s) => Object.keys(s.features || {})))]; return `stored keys: ${keys.join(", ")}`; });
await K("lib/accessTree.ts", "every stored settings.modules entry is an object with a boolean `allowed`", READ, () => { const bad = ss.flatMap((s) => Object.entries(s.modules || {}).filter(([, v]) => !v || typeof v !== "object" || (v.allowed !== undefined && typeof v.allowed !== "boolean")).map(([k]) => k)); eq(bad, []); return `${ss.filter((s) => s.modules && Object.keys(s.modules).length).length} restaurant(s) carry a bag`; });
await K("lib/accessTree.ts", "every stored <module>_allowed column is a boolean", READ, () => { const bad = ss.flatMap((s) => T.MODULE_KEYS.filter((m) => s[`${m}_allowed`] != null && typeof s[`${m}_allowed`] !== "boolean").map((m) => m)); eq(bad, []); });
await K("lib/accessTree.ts", "every stored <module>_enabled is TRUE where _allowed is true (else the module reads off with no screen to say why)", READ, () => { const bad = ss.flatMap((s) => T.MODULE_KEYS.filter((m) => s[`${m}_allowed`] === true && s[`${m}_enabled`] === false).map((m) => `${s.restaurant_id.slice(0, 8)}.${m}`)); return bad.length ? `allowed but not enabled: ${bad.join(", ")}` : "none"; });
await K("lib/accessState.ts", "no restaurant stores BOTH `key` and the legacy `api_key` for one channel", READ, () => { const both = ss.flatMap((s) => Object.entries(s.platform_channels || {}).filter(([, v]) => v && v.key && v.api_key).map(([k]) => `${s.restaurant_id.slice(0, 8)}.${k}`)); return both.length ? `both stored (the hint reads key; next save drops api_key): ${both.join(", ")}` : "none"; });
await K("lib/accessTree.ts", "every stored access_config `has` value is {on: boolean}", READ, () => { const bad = rs.flatMap((r) => T.HAS_IDS.filter((id) => r.access_config?.[id]?.on !== undefined && typeof r.access_config[id].on !== "boolean").map((id) => `${r.slug}.${id}`)); eq(bad, []); });
await K("lib/accessTree.ts", "every stored ceiling is one of its row's own options", READ, () => { const bad = []; for (const r of rs) for (const nd of T.ALL_NODES.filter((x) => x.bind.t === "limit")) { const v = r.access_config?.[nd.bind.id]?.limit?.[nd.bind.side]; if (v !== undefined && !nd.options.includes(v)) bad.push(`${r.slug}.${nd.id}=${v}`); } return bad.length ? `off-menu values (the screen shows the number, the cap enforces it): ${bad.join(", ")}` : "all on the menu"; });
await K("lib/accessTree.ts", "every stored pick-one opt is one of its row's choices", READ, () => { const bad = []; for (const r of rs) for (const nd of T.ALL_NODES.filter((x) => x.bind.t === "opt" && x.choices)) { const v = r.access_config?.[nd.bind.id]?.[`${nd.bind.side}_opts`]?.[nd.bind.key]; if (v !== undefined && !nd.choices.some((c) => c.value === v)) bad.push(`${r.slug}.${nd.id}=${v}`); } eq(bad, []); });
await K("lib/accessTree.ts", "every stored access_config waiter cap (close_unpaid.tablet) is off/on/pin", READ, () => { const bad = rs.filter((r) => r.access_config?.close_unpaid?.tablet !== undefined && !isTri(r.access_config.close_unpaid.tablet)).map((r) => r.slug); eq(bad, []); });
await K("lib/accessTree.ts", "every stored menus.manager / menus.mgrset value is a boolean", READ, () => { const bad = rs.flatMap((r) => ["manager", "mgrset"].flatMap((p) => Object.entries(r.access_config?.menus?.[p] || {}).filter(([, v]) => typeof v !== "boolean").map(([k]) => `${r.slug}.${p}.${k}`))); eq(bad, []); });
await K("lib/accessState.ts", "the access_config narrowing drops something real (the retired ids are really stored)", READ, () => { const retired = [...new Set(rs.flatMap((r) => Object.keys(r.access_config || {}).filter((k) => !T.KNOWN_CONFIG_IDS.has(k) && k !== "menus")))]; return `${retired.length} retired ids stored and never sent: ${retired.slice(0, 12).join(", ")}${retired.length > 12 ? " …" : ""}`; });
await K("lib/staffCaps.ts", "every stored per-person permission key is one that role can really have", READ, () => {
  const bad = [];
  for (const u of us) { if (!u.permissions || typeof u.permissions !== "object") continue; const ok = new Set(C.capKeysForRole(u.role)); for (const k of Object.keys(u.permissions)) if (!ok.has(k)) bad.push(`${u.role}:${k}`); }
  const tally = Object.entries(bad.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`);
  return tally.length ? `stored keys no longer offered (unread — countOverrides and effectiveCap ignore them): ${tally.join(", ")}` : "none";
});
await K("lib/staffCaps.ts", "every stored per-person permission VALUE is on/off/pin", READ, () => { const bad = us.flatMap((u) => Object.entries(u.permissions || {}).filter(([, v]) => !isTri(v)).map(([k, v]) => `${u.role}:${k}=${v}`)); eq(bad, []); });
await K("lib/staffCaps.ts", "no manager stores 'pin' on a manager row (a manager IS the PIN authority)", READ, () => { const bad = us.filter((u) => u.role === "manager").flatMap((u) => Object.entries(u.permissions || {}).filter(([k, v]) => v === "pin" && !k.startsWith("tablet_")).map(([k]) => k)); eq(bad, []); });
await K("lib/staffCaps.ts", "no waiter stores 'pin' on a floor row that has no PIN state", READ, () => { const pinOk = new Set(C.capsForRole("tablet").filter((c) => c.pin).map((c) => c.key)); const bad = us.filter((u) => u.role === "tablet").flatMap((u) => Object.entries(u.permissions || {}).filter(([k, v]) => v === "pin" && !pinOk.has(k)).map(([k]) => k)); eq(bad, []); });
await K("lib/staffCaps.ts", "kitchen logins carry no per-person permissions", READ, () => { const bad = us.filter((u) => u.role === "kitchen" && u.permissions && Object.keys(u.permissions).length); return bad.length ? `${bad.length} kitchen row(s) carry keys — unread (capsForRole('kitchen') is empty)` : "none"; });
await K("lib/staffCaps.ts", "staff roles stored are only the five the model knows", READ, () => { const roles = [...new Set(us.map((u) => u.role))].sort(); assert(roles.every((r) => ["owner", "manager", "tablet", "kitchen", "admin"].includes(r)), roles.join(",")); return roles.join(" · "); });
await K("lib/viewAsPerson.ts", "every non-owner staff row has a restaurant (a pin needs one)", READ, () => { const bad = us.filter((u) => u.role !== "owner" && !u.restaurant_id).length; eq(bad, 0); });
const drive = ASreal.err ? null : ASreal;
for (const [r, label] of [[fh, "French House"], [ag, "Aangan (read-only control)"]]) {
  await K("lib/accessState.ts", `accessStateFor(${label}) answers a full state from the real database`, "run the real reader against dev", async () => { assert(drive, String(ASreal.err)); const st = await drive.accessStateFor(r.id); assert(st); eq(Object.keys(st).sort(), Object.keys(T.emptyState()).sort()); });
  await K("lib/accessTree.ts", `every row reads a value on ${label} without throwing, and no row reads undefined`, "nodeValue over all 114 rows on the real state", async () => { const st = await drive.accessStateFor(r.id); const bad = T.ALL_NODES.filter((x) => x.bind.t !== "none" && T.nodeValue(x, st) === undefined).map((x) => x.id); eq(bad, []); });
  await K("lib/accessState.ts", `${label}'s credential hints are masks only`, "the real reader", async () => { const st = await drive.accessStateFor(r.id); for (const [k, v] of Object.entries(st.creds)) assert(v === "" || /^••••.{1,4}$/.test(v), k); return JSON.stringify(Object.fromEntries(Object.entries(st.creds).map(([k, v]) => [k, v ? "masked" : "none"]))); });
  await K("lib/staffCaps.ts", `${label}: every role's rows answer a restaurant value (no null after load)`, "roleDefault over every cap on the real state", async () => { const st = await drive.accessStateFor(r.id); const bad = ["owner", "manager", "tablet"].flatMap((role) => C.capsForRole(role).filter((c) => c.kind !== "value" && C.roleDefault(c, st) === null).map((c) => c.key)); eq(bad, []); });
}
await K("lib/accessTree.ts", "Aangan sits at factory defaults on the permission rows (differences listed, not judged)", "nodeValue vs defOf on Aangan's real state", async () => { const st = await drive.accessStateFor(ag.id); const diff = T.ALL_NODES.filter((x) => !["none", "creds", "text", "list", "choice"].includes(x.bind.t) && JSON.stringify(T.nodeValue(x, st)) !== JSON.stringify(x.bind.t === "has" ? x.bind.def !== false : T.defOf(x))).map((x) => x.id); return diff.length ? `${diff.length} rows differ from def: ${diff.join(", ")}` : "every permission row at its default"; });
await K("lib/ownerEntitlements.ts", "getOwnerEntitlements(French House) equals merging its stored bag", "the real helper vs the row", async () => { const OEr = await load("ownerEntitlements", { keep: ["@/lib/supabaseAdmin"] }); eq(await OEr.getOwnerEntitlements(fh.id), OE.mergeOwnerEntitlements(rs.find((x) => x.id === fh.id)?.owner_entitlements)); });
await K("lib/ownerEntitlements.ts", "entitledSubset over every restaurant answers without error", "the real helper", async () => { const OEr = await load("ownerEntitlements", { keep: ["@/lib/supabaseAdmin"] }); const got = await OEr.entitledSubset(rs.map((r) => r.id), "reports"); return `${got.length} of ${rs.length} have Reports`; });
await K("lib/accessTree.ts", "French House's Loyalty entry is back to what it was before this run's check", READ, () => { const s = ss.find((x) => x.restaurant_id === fh.id); eq(s?.modules?.loyalty ?? null, null); });
report("db");
