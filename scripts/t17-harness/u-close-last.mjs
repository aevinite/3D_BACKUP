// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, req, t, save, quiet, RID_A, randomUUID } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const UA = await import("@/lib/userAuth.ts"); const PA = await import("@/lib/panelAccess.ts");
if (want("lib/userAuth.ts")) { const f = "lib/userAuth.ts";
  const keep = { S: process.env.SESSION_SECRET, A: process.env.ADMIN_PASSWORD, N: process.env.NODE_ENV };
  delete process.env.SESSION_SECRET; delete process.env.ADMIN_PASSWORD; process.env.NODE_ENV = "production";
  const r = await quiet(() => UA.loginUser("anyone", "pw"));
  t(f, "a live site with no secret refuses sign-in with exactly the 'not set up' sentence, marked unavailable", r.v?.ok === false && r.v.error === UA.NOT_SET_UP && r.v.unavailable === true && r.v.reason === "not_configured");
  world({}); { const k2 = { S: process.env.SESSION_SECRET, A: process.env.ADMIN_PASSWORD, N: process.env.NODE_ENV }; delete process.env.SESSION_SECRET; delete process.env.ADMIN_PASSWORD; process.env.NODE_ENV = "production"; await quiet(() => UA.loginUser("anyone", "pw")); Object.assign(process.env, { SESSION_SECRET: k2.S, ADMIN_PASSWORD: k2.A, NODE_ENV: k2.N }); }
  t(f, "…and never even looks the name up", !G.READS.some((x) => x.table === "staff_users"));
  Object.assign(process.env, { SESSION_SECRET: keep.S, ADMIN_PASSWORD: keep.A, NODE_ENV: keep.N });
  const bad = await quiet(() => UA.verifySecret("x", "pbkdf2$100$!!!$abc"));
  t(f, "a damaged stored password is 'no match' with a server-log line saying the account needs a reset", bad.v === false && bad.logs.some((l) => /needs a reset/.test(l)));
  const dups = await Promise.all(Array.from({ length: 50 }, async () => ({ ...(await person({ username: "fifty" })), id: randomUUID() })));
  world({ staff_users: dups }); const w = await quiet(() => UA.loginUser("fifty", "nope"));
  t(f, "a name on 50 accounts logs the 'raise MAX_LOGIN_CANDIDATES' warning", w.logs.some((l) => /matches 50\+ accounts — raise MAX_LOGIN_CANDIDATES/.test(l)));
  const onlyDis = await person({ username: "od", active: false }); world({ staff_users: [onlyDis] });
  const od = await UA.loginUser("od", "wrong");
  t(f, "a name held only by a disabled account, with a wrong password: 'no_such_name' and nothing counted", od.reason === "no_such_name" && !G.RPCS.some((x) => x.name === "lfh_staff_login_failed"));
  const m = await person({}); world({ staff_users: [m] }); G.FAIL["staff_users"] = "throw";
  const rr = await UA.requireRole({ cookies: { get: (n) => (n === "lfh_user" ? { value: sign(m) } : undefined) } }, "manager").catch((e) => e);
  t(f, "requireRole lets a non-database error (a real bug) surface instead of calling it 'busy'", rr instanceof Error && !(rr instanceof UA.AuthDbError));
}
if (want("lib/ownerScope.ts")) { const f = "lib/ownerScope.ts"; const OS = await import("@/lib/ownerScope.ts");
  const o = await person({ role: "owner" }); world({ staff_users: [o], restaurant_owners: [] }); G.FAIL["restaurant_owners"] = "error"; PA.forgetRestaurant("z", [o.id]);
  const a = await quiet(() => OS.ownerScope(req("/api/owner/x", { cookies: { lfh_user: sign(o) } })));
  t(f, "item 28: an owner whose restaurants cannot be read gets 'unavailable', logged as such", a.err instanceof OS.OwnerScopeUnavailable && a.logs.some((l) => /could not read which restaurants this owner has/.test(l)));
  world({ staff_users: [o] }); G.FAIL["staff_users"] = "throw";
  const b = await quiet(() => OS.ownerScopeOr503(req("/api/owner/x", { cookies: { lfh_user: sign(o) } })));
  t(f, "ownerScopeOr503 lets a real bug surface (it does not turn every error into 503)", !!b.err && !b.v);
}
if (want("lib/panelAccess.ts")) { const f = "lib/panelAccess.ts";
  world({ restaurant_owners: [{ user_id: "a", restaurant_id: RID_A }] }); G.FAIL["restaurant_owners"] = "throw";
  t(f, "ownersOf answers an empty list when the read THROWS", (await PA.ownersOf(RID_A)).length === 0);
}
if (want("lib/publicCap.ts")) { const f = "lib/publicCap.ts"; const PC = await import("@/lib/publicCap.ts");
  world({ staff_actions: [{ id: 1, device_id: "d", action: "a", created_at: new Date().toISOString() }] });
  t(f, "recentActionCount counts the rows it got back", (await PC.recentActionCount("d", "a", 60000, 5)) === 1);
}
if (want("app/api/panel-profile/route.ts")) { const f = "app/api/panel-profile/route.ts"; const PP = await import("@/app/api/panel-profile/route.ts");
  const pw = await person({ username: "lpw", pw: "Old-1-pass" }); world({ staff_users: [pw] }); G.FAIL_NTH["staff_users:select"] = { at: 2, mode: "error" };
  const r = await quiet(() => PP.POST(req("/api/panel-profile", { method: "POST", json: { currentPassword: "Old-1-pass", newPassword: "New-2-pass" }, cookies: { lfh_user: sign(pw) } })));
  t(f, "item 27: a failed stored-password read is 503 busy, logged 'stored password read failed', password unchanged", r.v?.status === 503 && r.logs.some((l) => /stored password read failed/.test(l)) && G.FIX.staff_users[0].password_hash === pw.password_hash);
}
save((process.env.T17_SAVE || "") + "/U-close-last.json");
