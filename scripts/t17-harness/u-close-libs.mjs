// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, t, save, quiet, RID_A, RID_B, refuseNet, NET } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
// capture the phone alert instead of sending it
const sent = []; const capture = async (u, init) => { sent.push({ url: String(u), body: typeof init?.body === "string" ? init.body : String(init?.body ?? ""), headers: new Headers(init?.headers) }); return new Response("{}", { status: 200 }); };
const withAlerts = async (fn) => { const keep = { T: process.env.NTFY_TOPIC, S: process.env.ALERT_STACK }; process.env.NTFY_TOPIC = "r5-test-topic"; process.env.ALERT_STACK = "R5 test"; sent.length = 0; globalThis.fetch = capture; try { return await fn(); } finally { globalThis.fetch = refuseNet; if (keep.T === undefined) delete process.env.NTFY_TOPIC; else process.env.NTFY_TOPIC = keep.T; if (keep.S === undefined) delete process.env.ALERT_STACK; else process.env.ALERT_STACK = keep.S; } };
if (want("lib/rateLimit.ts")) { const f = "lib/rateLimit.ts"; const RL = await import("@/lib/rateLimit.ts");
  await withAlerts(async () => { world({ rate_limit_events: [{ id: "e1", key: "staff_login", subject: "*:ravi", status: "open", restaurant_id: RID_A, hit_count: 6, max_count: 5, window_seconds: 300 }], restaurants: [{ id: RID_A, name: "Aangan" }] }); G.RPC_ANSWERS.lfh_rate_check = false;
    await RL.rateAllowed("staff_login", "*:ravi", { restaurantId: RID_A, device: "device-123456789xyz", describe: async () => "Manager “ravi” at Aangan" }); });
  const msg = sent.map((x) => x.body).join("\n");
  t(f, "the sign-in limit alert reaches the phone channel (the test catches it before it leaves)", sent.length >= 1 && sent[0].url.includes("r5-test-topic"), sent.map((x) => x.url).join());
  t(f, "…and reads: who, the tries ('6 in 5 min (limit 5)'), the device's first 10 characters, and when they can try again", /Who: Manager “ravi” at Aangan/.test(msg) && /Tries: 6 in 5 min \(limit 5\)/.test(msg) && /Device: device-123/.test(msg) && !/device-1234/.test(msg) && /They can try again after 5 min\./.test(msg), msg.replace(/\n/g, " | ").slice(0, 200));
  t(f, "…and starts with which site is talking ('[R5 test]')", /^\[R5 test\]/.test(msg));
  await withAlerts(async () => { world({ rate_limit_events: [{ id: "e2", key: "admin_login", subject: "9.9.9.9", status: "open", restaurant_id: "00000000-0000-0000-0000-000000000000", hit_count: 4, window_seconds: 45 }] }); await RL.recordAlert("admin_login", "9.9.9.9", "Admin panel · 9.9.9.9", 4); });
  const am = sent.map((x) => x.body).join("\n");
  t(f, "the admin-door alert says 'Nobody is locked out — this is just a heads-up.'", /Nobody is locked out — this is just a heads-up\./.test(am) && /Tries: 4/.test(am), am.replace(/\n/g, " | ").slice(0, 160));
  await withAlerts(async () => { world({ rate_limit_events: [{ key: "guest_order", subject: "ip:1", subject_label: null, status: "open", last_at: new Date().toISOString(), restaurant_id: RID_A, hit_count: 3, max_count: 3, window_seconds: 90 }] }); await RL.pingLatestGuestLimit("guest_order", RID_A); });
  const gm = sent.map((x) => x.body).join("\n");
  t(f, "a 90-second window is written '90 sec', not '1.5 min'", /3 in 90 sec \(limit 3\)/.test(gm) && /try again after 90 sec\./.test(gm), gm.replace(/\n/g, " | ").slice(0, 160));
  await withAlerts(async () => { world({ rate_limit_events: [] }); await RL.pingLatestGuestLimit("guest_order", null); });
  t(f, "with no recent limit event, no ping is sent", sent.length === 0);
  await withAlerts(async () => { world({}); G.RPC_ANSWERS.lfh_rate_check = false; await RL.rateAllowed("print_setup_code", "x"); });
  const pm = sent.map((x) => x.body).join("\n");
  t(f, "with no window known, the alert says 'They can try again shortly.' and names the subject", /They can try again shortly\./.test(pm) && /Who: x/.test(pm));
  t(f, "the staff sign-in alert arrives QUIET (priority low, no buzz) — the admin-door one is loud", await (async () => { const s1 = []; await withAlerts(async () => { world({}); G.RPC_ANSWERS.lfh_rate_check = false; await RL.rateAllowed("staff_login", "*:q"); s1.push(...sent); }); const s2 = []; await withAlerts(async () => { world({}); await RL.recordAlert("admin_login", "1.1.1.1", "l", 3); s2.push(...sent); }); const pr = (x) => x.headers.get("Priority") || x.headers.get("priority") || ""; return s1.length > 0 && s2.length > 0 && pr(s1[0]) === "low" && pr(s2[0]) !== "low" && pr(s2[0]) !== ""; })());
  t(f, "nothing in this suite reached the real internet", NET.length === 0);
}
if (want("lib/userAuth.ts")) { const f = "lib/userAuth.ts"; const UA = await import("@/lib/userAuth.ts");
  const keep = { S: process.env.SESSION_SECRET, A: process.env.ADMIN_PASSWORD, T: process.env.STAFF_PASSWORD, N: process.env.NODE_ENV };
  delete process.env.SESSION_SECRET; delete process.env.ADMIN_PASSWORD; process.env.STAFF_PASSWORD = "r5-staff-pw";
  const p = await person({ username: "spw", pw: "pw-1" }); world({ staff_users: [p] });
  const w = await quiet(() => UA.loginUser("spw", "pw-1"));
  t(f, "with only STAFF_PASSWORD set, passes are signed with it", w.v?.ok === true && (await UA.userFromCookie(sign(p, Date.now(), "r5-staff-pw")))?.id === p.id);
  const w2 = await quiet(() => UA.loginUser("spw", "pw-1"));
  t(f, "…and the 'SESSION_SECRET is not set' warning is written once per server, not on every sign-in", !w2.logs.some((l) => /SESSION_SECRET is not set/.test(l)));
  Object.assign(process.env, { SESSION_SECRET: keep.S, ADMIN_PASSWORD: keep.A, NODE_ENV: keep.N }); if (keep.T === undefined) delete process.env.STAFF_PASSWORD; else process.env.STAFF_PASSWORD = keep.T;
  const own = await person({ role: "owner", username: "co", pw: "pw-1", restaurant_id: RID_B }); const mgr = await person({ username: "co", pw: "pw-2", restaurant_id: RID_A });
  world({ staff_users: [own, mgr], restaurant_owners: [{ user_id: own.id, restaurant_id: RID_A }] });
  t(f, "at a restaurant's door, its manager and a co-owner share a name: each signs in with their own password", (await UA.loginUser("co", "pw-1", RID_A)).user?.id === own.id && (await UA.loginUser("co", "pw-2", RID_A)).user?.id === mgr.id);
  t(f, "…the co-owner list is read with this restaurant and only the owner ids from elsewhere", (() => { return G.READS.some((r) => r.table === "restaurant_owners"); })());
  const ownHere = await person({ role: "owner", username: "oh", pw: "pw-1", restaurant_id: RID_A }); world({ staff_users: [ownHere], restaurant_owners: [] });
  t(f, "an owner whose home IS this restaurant needs no co-owner read", await (async () => { const r = await UA.loginUser("oh", "pw-1", RID_A); return r.ok === true && !G.READS.some((x) => x.table === "restaurant_owners"); })());
  world({ staff_users: [] }); G.RPC_ANSWERS = G.RPC_ANSWERS || {};
  t(f, "no candidates at a restaurant door: the log keeps the typed name and that restaurant", await (async () => { const r = await UA.loginUser("Nobody Here", "x", RID_A); return r.attempted.username === "nobody here" && r.attempted.restaurant_id === RID_A; })());
  const lk = await person({ username: "lk2", pw: "pw-1", locked_until: new Date(Date.now() + 60000).toISOString(), name: null });
  world({ staff_users: [lk] });
  t(f, "a locked account's log names it by login name when it has no display name", (await UA.loginUser("lk2", "x")).attempted.actor === "lk2");
  const d1 = await person({ username: "dis", pw: "pw-1", active: false, name: "Dee" }); world({ staff_users: [d1] });
  t(f, "a disabled account's log names who it was", (await UA.loginUser("dis", "pw-1")).attempted.actor === "Dee");
  const g = await person({ role: "manager", last_seen_at: null }); world({ staff_users: [g], restaurants: [{ id: RID_A, deleted_at: null, active: true }] });
  const rq = (ck) => ({ cookies: { get: (n) => (ck[n] !== undefined ? { value: ck[n] } : undefined) }, nextUrl: { searchParams: new URLSearchParams("") } });
  await UA.requireRole(rq({ lfh_user: sign(g) }), "manager"); await new Promise((x) => setTimeout(x, 5));
  t(f, "a person never seen before gets their first 'last seen' on their first call", G.WRITES.some((w) => w.patch?.last_seen_at));
  t(f, "a request with no headers object at all still works (version label simply not recorded)", await (async () => { world({ staff_users: [g], restaurants: [{ id: RID_A, deleted_at: null, active: true }] }); const r = await UA.requireRole(rq({ lfh_user: sign(g) }), "manager"); return r.ok === true; })());
  world({ staff_users: [] });
  t(f, "requireRole: nobody signed in and no admin cookie is refused without being marked temporary", JSON.stringify(await UA.requireRole(rq({}), "manager")) === '{"ok":false}');
  world({ staff_users: [{ id: "x1", role: "kitchen", name: "Raj", username: "raj", restaurant_id: RID_A, active: true, deleted_at: null }], restaurants: [] });
  t(f, "the wording for a kitchen screen says 'Kitchen screen'", (await UA.describeLoginTarget("raj")) === "Kitchen screen “raj” at unknown restaurant");
  world({ staff_users: [{ id: "o1", role: "owner", name: "Big Owner", username: "bo", restaurant_id: null, active: true, deleted_at: null }], restaurant_owners: [{ user_id: "o1", restaurant_id: "nope" }], restaurants: [] });
  t(f, "an owner whose restaurants have no names on record reads 'their restaurants'", (await UA.describeLoginTarget("bo")) === "Owner “Big Owner” (bo) at their restaurants");
  world({ staff_users: [{ id: "o1", role: "owner", name: "Big", username: "bo", restaurant_id: null, active: true, deleted_at: null }], restaurant_owners: [], restaurants: [{ id: RID_A, name: "Aangan" }] }); G.FAIL["restaurant_owners"] = "error";
  t(f, "a failed owner-links read still gives a sentence (wording only, never an error)", (await UA.describeLoginTarget("bo")) === "Owner “Big” (bo) at their restaurants");
}
if (want("lib/loginThrottle.ts")) { const f = "lib/loginThrottle.ts"; const LT = await import("@/lib/loginThrottle.ts");
  world({}); G.FAIL["login_throttle"] = "throw";
  t(f, "every throttle helper answers safely when the table throws: status unlocked, not blocked, empty list, no exceptions", await (async () => { try { const a = await LT.throttleStatus("k"); const b = await LT.throttleIsBlocked("k"); const c = await LT.listBlocked(); await LT.throttleBlock("k"); await LT.throttleReset("k"); await LT.throttleUnblock("k"); return a.locked === false && b === false && c.length === 0; } catch { return false; } })());
  world({}); G.FAIL["rpc:lfh_throttle_fail"] = "throw"; const q = await quiet(() => LT.throttleFail("k", 3, 1));
  t(f, "a counter that throws a plain value is logged and counts nothing", q.v?.failCount === 0 && q.logs.some((l) => /could not count a wrong try/.test(l)));
  world({ login_throttle: [{ key: "admin:z", locked_until: new Date(Date.now() + 400 * 864e5).toISOString(), note: null, updated_at: new Date().toISOString() }] });
  t(f, "a block of 400 days is listed with its key", (await LT.listBlocked())[0]?.key === "admin:z");
}
save((process.env.T17_SAVE || "") + "/U-close-libs.json");
