// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, req, t, save, quiet, RID_A, RID_B, RID_C, ADMIN_PW, sha, randomUUID, R, go, root } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const PA = await import("@/lib/panelAccess.ts"); const OS = await import("@/lib/ownerScope.ts"); const PG = await import("@/lib/panelGate.ts");
const adminTok = await sha(ADMIN_PW);
if (want("lib/panelAccess.ts")) { const f = "lib/panelAccess.ts";
  for (const [label, row, del, sus] of [["live", { id: RID_A, deleted_at: null, active: true }, false, false], ["suspended", { id: RID_A, deleted_at: null, active: false }, false, true], ["binned", { id: RID_A, deleted_at: "2026-10-01T00:00:00Z", active: false }, true, false], ["binned but marked active", { id: RID_A, deleted_at: "2026-10-01T00:00:00Z", active: true }, true, false], ["with no active value at all", { id: RID_A, deleted_at: null }, false, false]]) {
    world({ restaurants: [row] }); PA.forgetRestaurant(RID_A);
    t(f, `a ${label} restaurant: in the bin = ${del}, switched off = ${sus}`, (await PA.isRestaurantDeleted(RID_A)) === del && (await PA.isRestaurantSuspended(RID_A)) === sus);
  }
  world({}); PA.forgetRestaurant(RID_B);
  t(f, "a restaurant with no row is neither binned nor switched off (and an empty id reads nothing)", (await PA.isRestaurantSuspended(RID_B)) === false && (await PA.isRestaurantSuspended("")) === false);
  world({ restaurants: [{ id: RID_A, active: false }] }); G.FAIL["restaurants"] = "error"; PA.forgetRestaurant(RID_A);
  await PA.isRestaurantSuspended(RID_A); G.FAIL = {};
  t(f, "a FAILED read is not remembered: the very next check reads again and sees the truth", (await PA.isRestaurantSuspended(RID_A)) === true);
  world({ restaurants: [{ id: RID_A, active: true }] }); PA.forgetRestaurant(RID_A); await PA.isRestaurantSuspended(RID_A);
  G.FIX.restaurants[0].active = false;
  t(f, "a suspension reaches a cached restaurant within the 30-second window, at once after forgetRestaurant", (await PA.isRestaurantSuspended(RID_A)) === false && (PA.forgetRestaurant(RID_A), await PA.isRestaurantSuspended(RID_A)) === true);
  const ow = randomUUID();
  world({ restaurant_owners: [{ user_id: ow, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: null, active: false }] }); PA.forgetRestaurant("z", [ow]);
  t(f, "an owner's estate KEEPS a suspended restaurant (only the bin removes it)", (await PA.enabledOwnedRestaurantIds(ow, false)).join() === RID_A);
  world({ restaurant_owners: [{ user_id: ow, restaurant_id: RID_A }, { user_id: ow, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: null }] });
  t(f, "a duplicated ownership link is passed through as stored (two links, one restaurant twice)", (await PA.enabledOwnedRestaurantIds(ow, false)).length === 2);
  world({ restaurant_owners: [{ user_id: ow, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: null }] }); await PA.enabledOwnedRestaurantIds(ow, false); G.FAIL["restaurants"] = "error";
  t(f, "a failed restaurant read with an earlier answer in memory uses that answer", (await PA.enabledOwnedRestaurantIds(ow, false)).join() === RID_A);
  t(f, "PANEL_TTL is 30 seconds: an answer from 29s ago is reused (checked by reading the rule)", /const PANEL_TTL_MS = 30_000;/.test((await import("node:fs")).readFileSync(root + "/lib/panelAccess.ts", "utf8")));
}
if (want("lib/ownerScope.ts")) { const f = "lib/ownerScope.ts";
  const o = await person({ role: "owner", username: "osx" });
  world({ staff_users: [o], restaurant_owners: [{ user_id: o.id, restaurant_id: RID_A }, { user_id: o.id, restaurant_id: RID_B }], restaurants: [{ id: RID_A, deleted_at: null }, { id: RID_B, deleted_at: "2026-10-01T00:00:00Z" }] }); PA.forgetRestaurant("z", [o.id]);
  const s = await OS.ownerScope(req("/api/owner/x", { cookies: { lfh_user: sign(o) } }));
  t(f, "an owner's scope leaves out their binned restaurant", JSON.stringify(s.ids) === JSON.stringify([RID_A]));
  const s2 = await OS.ownerScope(req(`/api/owner/x?rid=${RID_B}&scope=all&as=${randomUUID()}`, { cookies: { lfh_user: sign(o), lfh_staff_auth: "wrong" } }));
  t(f, "?rid / ?scope / ?as with a WRONG admin cookie change nothing for a real owner", s2 && s2.all === false && JSON.stringify(s2.ids) === JSON.stringify([RID_A]) && !s2.admin);
  const s3 = await OS.ownerScope(req(`/api/owner/x?rid=${RID_C}`, { cookies: { lfh_user: sign(o), lfh_staff_auth: adminTok } }));
  t(f, "an admin-pinned tab (admin cookie + ?rid) is the ADMIN's view even with an owner signed in on the same browser", s3 && s3.admin === true);
  const s4 = await OS.ownerScope(req(`/api/owner/x`, { cookies: { lfh_user: sign(o), lfh_staff_auth: adminTok } }));
  t(f, "…without a pin, the signed-in owner wins over a stray admin cookie", s4 && !s4.admin && s4.ownerId === o.id);
  world({}); const sc = await OS.ownerScope(req(`/api/owner/x?scope=${RID_A}`, { cookies: { lfh_staff_auth: adminTok } }));
  t(f, "the admin's ?scope=<restaurant id> works like ?rid=", sc && JSON.stringify(sc.ids) === JSON.stringify([RID_A]) && sc.admin === true);
  const d = await quiet(() => OS.dbFail("w", { message: "x", code: "57014" }));
  t(f, "dbFail: the timeout reply is marked NOT temporary (retrying the same period would time out again)", (await d.v.json()).transient === false);
  const d2 = await quiet(() => OS.dbFail("w", new Error("canceling statement due to Statement Timeout")));
  t(f, "dbFail: a timeout recognised by its words (any case) is a 504 too", d2.v.status === 504);
  t(f, "dbFail: a 'not found' style status can be chosen by the caller", (await quiet(() => OS.dbFail("w", "x", { status: 404 }))).v.status === 404);
  t(f, "isRestaurantId accepts capital hex too (ids are case-insensitive)", OS.isRestaurantId(RID_A.toUpperCase()));
  t(f, "the partial-read labels are re-exported for the owner routes", typeof OS.partialLabel === "function" && typeof OS.partialNote === "function");
}
if (want("lib/panelGate.ts")) { const f = "lib/panelGate.ts";
  const restOf = (o) => [{ id: RID_A, slug: o.slug, name: "Aangan", deleted_at: o.deleted ?? null, active: o.active ?? true }];
  for (const role of ["manager", "kitchen", "tablet"]) {
    const u = await person({ role });
    world({ staff_users: [u], restaurants: restOf({ slug: "x", active: false }) }); PA.forgetRestaurant(RID_A); R.cookies = { lfh_user: sign(u) };
    t(f, `item 30: the plain /${role} sends a suspended restaurant's ${role} to the sign-in card WITH the reason`, (await go(() => PG.requirePanel(role, `/${role}`))).redirect === "/login?why=off");
    world({ staff_users: [u], restaurants: restOf({ slug: "x", deleted: "2026-10-01T00:00:00Z", active: false }) }); PA.forgetRestaurant(RID_A);
    t(f, `item 33: the plain /${role} sends a binned restaurant's ${role} to the card saying it is gone (no loop)`, (await go(() => PG.requirePanel(role, `/${role}`))).redirect === "/login?why=gone");
  }
  PA.forgetRestaurant(RID_A);
  const u = await person({ role: "manager" });
  world({ staff_users: [u], restaurants: restOf({ slug: "x", active: false }) }); PA.forgetRestaurant(RID_A); R.cookies = { lfh_user: sign(u), lfh_staff_auth: adminTok, aevidine_admin_rid: RID_A };
  t(f, "item 30: the admin with act-as still enters a suspended restaurant's panel (even holding a staff pass)", !(await go(() => PG.requirePanel("manager", "/manager"))).redirect);
  world({ staff_users: [u], restaurants: restOf({ slug: "x", active: false }) }); PA.forgetRestaurant(RID_A); R.cookies = { lfh_user: sign(u) };
  t(f, "item 30: a manager opening the KITCHEN panel of a suspended restaurant gets the plain sign-in (wrong panel comes first)", (await go(() => PG.requirePanel("kitchen", "/kitchen"))).redirect === "/login?next=%2Fkitchen");
  PA.forgetRestaurant(RID_A);
  world({ staff_users: [u], restaurants: restOf({ slug: "r5-at-1", active: false }) }); R.cookies = { lfh_user: sign(u) };
  t(f, "item 30: a suspended restaurant's own address sends its manager to its sign-in WITH the reason", (await go(() => PG.requirePanelAt("manager", "r5-at-1"))).redirect === "/r/r5-at-1/login?why=off");
  const other = await person({ role: "manager", restaurant_id: RID_B });
  world({ staff_users: [other], restaurants: restOf({ slug: "r5-at-2", active: false }) }); R.cookies = { lfh_user: sign(other) };
  t(f, "…another restaurant's manager at that address gets the ordinary sign-in (no reason given about a restaurant that is not theirs)", (await go(() => PG.requirePanelAt("manager", "r5-at-2"))).redirect === "/r/r5-at-2/login?next=%2Fr%2Fr5-at-2%2Fmanager");
  world({ staff_users: [u], restaurants: restOf({ slug: "r5-at-3", active: false }) }); R.cookies = { lfh_staff_auth: adminTok };
  t(f, "…the admin enters it", (await go(() => PG.requirePanelAt("manager", "r5-at-3"))).v?.admin === true);
  // panelDoor
  const d = async (who) => PG.panelDoor(who);
  world({ restaurants: [{ id: RID_A, deleted_at: null, active: true }] }); PA.forgetRestaurant(RID_A);
  t(f, "panelDoor: staff of a live restaurant may enter", (await d(u)).ok === true);
  world({ restaurants: [{ id: RID_A, deleted_at: null, active: false }] }); PA.forgetRestaurant(RID_A);
  t(f, "panelDoor: staff of a suspended restaurant are refused with the 'switched off' sentence", JSON.stringify(await d(u)) === JSON.stringify({ ok: false, why: "off", message: PG.DOOR_OFF }));
  world({ restaurants: [{ id: RID_A, deleted_at: "2026-10-01T00:00:00Z", active: false }] }); PA.forgetRestaurant(RID_A);
  t(f, "panelDoor: staff of a binned restaurant are refused with 'no longer available' (bin wins over suspension)", (await d(u)).why === "gone" && (await d(u)).message === PG.DOOR_GONE);
  PA.forgetRestaurant(RID_A);
  const o = await person({ role: "owner" });
  world({ restaurant_owners: [{ user_id: o.id, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: null, active: false }] }); PA.forgetRestaurant("z", [o.id]);
  t(f, "panelDoor: an owner of a suspended restaurant may enter", (await d(o)).ok === true);
  world({ restaurant_owners: [{ user_id: o.id, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: "2026-10-01T00:00:00Z" }] }); PA.forgetRestaurant("z", [o.id]);
  t(f, "panelDoor: an owner whose every restaurant is binned is refused with the owner sentence", (await d(o)).why === "gone" && (await d(o)).message === PG.DOOR_NO_OWNED);
  const o2 = await person({ role: "owner" });
  world({ restaurant_owners: [] }); G.FAIL["restaurant_owners"] = "error"; PA.forgetRestaurant("z", [o2.id]);
  t(f, "panelDoor: when an owner's restaurants cannot be read, the owner is let through (their panel then says 'try again')", (await d(o2)).ok === true);
  t(f, "the three sentences are plain, end with a full stop, and name who can help", [PG.DOOR_GONE, PG.DOOR_OFF, PG.DOOR_NO_OWNED].every((x) => /\.$/.test(x) && /admin|Aevidine/.test(x)));
}
save((process.env.T17_SAVE || "") + "/U-access.json");
