// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, sign, req, t, save, quiet, RID_A, RID_B, ADMIN_PW, sha, randomUUID } from "./r5lib.mjs";
import { rng, ascii } from "./fz.mjs";
const f = "lib/userAuth.ts"; const UA = await import("@/lib/userAuth.ts"); const PA = await import("@/lib/panelAccess.ts");
const r = rng(31);
// passes
const u = await person({ username: "pass1", pw: "pw-pass-1" }); world({ staff_users: [u] });
const lg = await UA.loginUser("pass1", "pw-pass-1"); const c = lg.cookie;
let bad = 0; const ch = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";
for (let i = 0; i < c.length; i++) { const repl = ch[(ch.indexOf(c[i]) + 1) % ch.length]; const forged = c.slice(0, i) + repl + c.slice(i + 1); if ((await UA.userFromCookie(forged)) !== null) bad++; }
t(f, `every one of a real pass's ${c.length} characters, changed one at a time, makes it refused`, bad === 0, `${bad} still accepted`);
bad = 0; for (let i = 0; i < 1500; i++) if ((await UA.userFromCookie(ascii(r, 120))) !== null) bad++;
t(f, "1,500 random pass values: none is accepted", bad === 0);
const [id, iat] = c.split(".");
t(f, "a pass is made of the account id, the time it was made, and a 43-character signature", id === u.id && Math.abs(Number(iat) - Date.now()) < 5000 && c.split(".")[2].length === 43);
world({ staff_users: [u] });
t(f, "a pass exactly 7 days old minus a second still works", (await UA.userFromCookie(sign(u, Date.now() - 7 * 864e5 + 1000)))?.id === u.id);
t(f, "a pass made in the FUTURE is not refused for its age (the signature still has to match)", (await UA.userFromCookie(sign(u, Date.now() + 60000)))?.id === u.id);
t(f, "a pass whose id is in CAPITAL letters is refused (the database has it in lower case)", (await UA.userFromCookie(sign({ ...u, id: u.id.toUpperCase() }))) === null);
t(f, "two passes for the same person made at different times are both accepted (each device has its own)", await (async () => { const a = sign(u, Date.now() - 5000), b = sign(u); return (await UA.userFromCookie(a))?.id === u.id && (await UA.userFromCookie(b))?.id === u.id; })());
// role table
const roles = ["owner", "manager", "kitchen", "tablet"]; const want = { owner: "owner,manager,kitchen,tablet", manager: "manager,kitchen,tablet", kitchen: "kitchen", tablet: "tablet" };
for (const have of roles) t(f, `a ${have} may use exactly: ${want[have]}`, roles.filter((n) => UA.roleSatisfies(have, n)).join() === want[have]);
t(f, "a role the app does not know may use nothing (except an identical name)", !UA.roleSatisfies("waiter", "tablet") && UA.roleSatisfies("waiter", "waiter"));
// requireRole: items 30 + deleted + owner
const rq = (ck, q = "", hd = {}) => ({ cookies: { get: (n) => (ck[n] !== undefined ? { value: ck[n] } : undefined) }, nextUrl: { searchParams: new URLSearchParams(q) }, headers: { get: (n) => hd[n] ?? null } });
const m = await person({ role: "manager" });
for (const [label, rest, expect] of [["live", { id: RID_A, deleted_at: null, active: true }, true], ["SUSPENDED", { id: RID_A, deleted_at: null, active: false }, false], ["binned", { id: RID_A, deleted_at: new Date().toISOString(), active: false }, false], ["missing row", null, true]]) {
  world({ staff_users: [m], restaurants: rest ? [rest] : [] }); PA.forgetRestaurant(RID_A);
  t(f, `item 30: a manager of a ${label} restaurant ${expect ? "is let in" : "is refused"} on every panel call`, (await UA.requireRole(rq({ lfh_user: sign(m) }), "manager")).ok === expect);
}
PA.forgetRestaurant(RID_A);
for (const role of ["kitchen", "tablet"]) { const k = await person({ role }); world({ staff_users: [k], restaurants: [{ id: RID_A, deleted_at: null, active: false }] }); PA.forgetRestaurant(RID_A);
  t(f, `item 30: the ${role} screen of a suspended restaurant is refused too`, (await UA.requireRole(rq({ lfh_user: sign(k) }), role)).ok === false); }
const own = await person({ role: "owner" });
world({ staff_users: [own], restaurant_owners: [{ user_id: own.id, restaurant_id: RID_A }], restaurants: [{ id: RID_A, deleted_at: null, active: false }] }); PA.forgetRestaurant(RID_A, [own.id]);
t(f, "item 30: an OWNER of a suspended restaurant still gets into the owner panel (owners keep seeing their numbers)", (await UA.requireRole(rq({ lfh_user: sign(own) }), "owner")).ok === true);
world({ staff_users: [m], restaurants: [{ id: RID_A, deleted_at: null, active: false }] }); PA.forgetRestaurant(RID_A);
t(f, "item 30: the admin still enters a suspended restaurant's panels", (await UA.requireRole(rq({ lfh_staff_auth: await sha(ADMIN_PW) }, "rid=" + RID_A), "manager")).ok === true);
world({ staff_users: [m], restaurants: [{ id: RID_A, deleted_at: null, active: false }] }); PA.forgetRestaurant(RID_A);
await UA.requireRole(rq({ lfh_user: sign(m) }), "manager"); const reads1 = G.READS.filter((x) => x.table === "restaurants").length;
await UA.requireRole(rq({ lfh_user: sign(m) }), "manager");
t(f, "item 30: the bin check and the suspension check share ONE cached read (no extra trip per call)", reads1 === 1 && G.READS.filter((x) => x.table === "restaurants").length === 1, `${reads1}`);
PA.forgetRestaurant(RID_A);
world({ staff_users: [m], restaurants: [{ id: RID_A, active: false }] }); G.FAIL["restaurants"] = "error";
t(f, "item 30: when the suspension cannot be read, staff are let in (a blip never locks every restaurant out)", (await UA.requireRole(rq({ lfh_user: sign(m) }), "manager")).ok === true);
PA.forgetRestaurant(RID_A);
// service-worker version label
for (const [v, keep] of [["v1", true], ["v9999", true], ["v10000", false], ["V12", false], ["v", false], ["v1.2", false]]) {
  const mm = await person({ role: "manager", sw_version: "v0" }); world({ staff_users: [mm], restaurants: [{ id: RID_A, deleted_at: null, active: true }] }); PA.forgetRestaurant(RID_A);
  await UA.requireRole(rq({ lfh_user: sign(mm) }, "", { "x-lfh-sw": v }), "manager"); await new Promise((x) => setTimeout(x, 5));
  t(f, `the device's app version label “${v}” is ${keep ? "recorded" : "ignored"}`, G.WRITES.some((w) => w.patch?.sw_version === v) === keep);
}
// loginUser specifics
const mixA = await person({ username: "dup", pw: "pw-one", restaurant_id: RID_A }); const mixB = await person({ username: "dup", pw: "pw-two", restaurant_id: RID_B, active: false });
world({ staff_users: [mixA, mixB] });
t(f, "a live account and a disabled one share a name: the disabled one's password gets 'disabled', not a sign-in", (await UA.loginUser("dup", "pw-two")).reason === "disabled");
t(f, "…the live one's password signs in", (await UA.loginUser("dup", "pw-one")).user?.id === mixA.id);
world({ staff_users: [mixA, mixB] }); await UA.loginUser("dup", "nope");
t(f, "…a wrong password counts against the LIVE account only", G.FIX.staff_users.find((x) => x.id === mixA.id).failed_count === 1 && !G.FIX.staff_users.find((x) => x.id === mixB.id).failed_count);
const lockedA = await person({ username: "lk", pw: "p1", locked_until: new Date(Date.now() + 60000).toISOString() }); const freeB = await person({ username: "lk", pw: "p2", restaurant_id: RID_B });
world({ staff_users: [lockedA, freeB] });
t(f, "on the plain door, a lock on ONE same-named account refuses both (no dodging a lock with a shared name)", (await UA.loginUser("lk", "p2")).reason === "locked");
t(f, "…at the OTHER restaurant's own door, its person signs in normally", (await UA.loginUser("lk", "p2", RID_B)).ok === true);
t(f, "a password of exactly 200 characters is tried; 201 is refused as oversize", await (async () => { const p200 = "p".repeat(200); const big = await person({ username: "big", pw: p200 }); world({ staff_users: [big] }); const a = await UA.loginUser("big", p200); const b = await UA.loginUser("big", p200 + "x"); return a.ok === true && b.reason === "too_long"; })());
t(f, "a name of exactly 100 characters is looked up; 101 is refused", await (async () => { world({ staff_users: [] }); await UA.loginUser("n".repeat(100), "x"); const a = G.READS.length; world({ staff_users: [] }); await UA.loginUser("n".repeat(101), "x"); return a === 1 && G.READS.length === 0; })());
t(f, "a name typed with capitals and double spaces finds the account", await (async () => { const sp = await person({ username: "asha devi", pw: "pw-x" }); world({ staff_users: [sp] }); return (await UA.loginUser("  ASHA   Devi ", "pw-x")).ok === true; })());
t(f, "the wrong-name answer carries the restaurant the door was for (for the admin's log)", await (async () => { world({ staff_users: [] }); const x = await UA.loginUser("ghost", "x", RID_B); return x.attempted.restaurant_id === RID_B && x.attempted.username === "ghost"; })());
t(f, "NOT_SET_UP names Aevidine and says what is missing, in one sentence", /tell Aevidine/.test(UA.NOT_SET_UP) && /secret is missing/.test(UA.NOT_SET_UP));
t(f, "USER_COOKIE is lfh_user", UA.USER_COOKIE === "lfh_user");
// verifySecret
const hs = await UA.hashSecret("abc");
const [p0, it, salt, dig] = hs.split("$");
t(f, "a stored value with a changed round count no longer matches", (await UA.verifySecret("abc", `${p0}$120001$${salt}$${dig}`)) === false);
t(f, "a stored value with a changed salt no longer matches", (await UA.verifySecret("abc", `${p0}$${it}$${(salt[0] === "A" ? "B" : "A") + salt.slice(1)}$${dig}`)) === false);
t(f, "an old plain SHA-256 stored in CAPITALS does not match (exact compare)", (await UA.verifySecret("legacy", (await sha("legacy")).toUpperCase())) === false);
t(f, "hashSecret handles an empty password (and it then only matches empty)", await (async () => { const e = await UA.hashSecret(""); return (await UA.verifySecret("", e)) === true && (await UA.verifySecret(" ", e)) === false; })());
// describeLoginTarget
world({ staff_users: [{ id: "a", role: "tablet", name: "Raj", username: "raj", restaurant_id: RID_A, active: true, deleted_at: null }, { id: "b", role: "tablet", name: "Raj", username: "raj", restaurant_id: RID_B, active: true, deleted_at: null }], restaurants: [{ id: RID_A, name: "Aangan" }, { id: RID_B, name: "FH" }] });
t(f, "item 34: two accounts on one name read '+1 more account USES this name' (proper English)", (await UA.describeLoginTarget("raj")) === "Waiter tablet “raj” at Aangan (+1 more account uses this name)", await UA.describeLoginTarget("raj"));
world({ staff_users: [{ id: "o", role: "owner", name: null, username: "own", restaurant_id: null, active: true, deleted_at: null }], restaurant_owners: [{ user_id: "o", restaurant_id: RID_A }, { user_id: "o", restaurant_id: RID_B }], restaurants: [{ id: RID_A, name: "Aangan" }, { id: RID_B, name: "FH" }] });
t(f, "an owner of exactly two restaurants is shown with both names and no '+N more'", (await UA.describeLoginTarget("own")) === "Owner “own” at Aangan + FH");
save((process.env.T17_SAVE || "") + "/U-userauth.json");
