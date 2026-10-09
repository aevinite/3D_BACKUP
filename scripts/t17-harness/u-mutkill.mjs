// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
// Round 5 · checks written because a deliberate break SURVIVED the first mutation pass (the number = the survivor).
import { G, world, person, sign, req, t, save, quiet, RID_A, ADMIN_PW, sha, randomUUID, refuseNet, rootFile } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const body = async (res) => { try { return await res.clone().json(); } catch { return null; } };
const logs = (a) => (G.FIX.staff_actions || []).filter((r) => !a || r.action === a);
const ck = (res, name) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith(name + "=")) || "";
const sent = []; const capture = async (u, init) => { sent.push(String(init?.body ?? "")); return new Response("{}", { status: 200 }); };
const withAlerts = async (fn) => { const k = process.env.NTFY_TOPIC; process.env.NTFY_TOPIC = "r5-topic"; sent.length = 0; globalThis.fetch = capture; try { return await fn(); } finally { globalThis.fetch = refuseNet; if (k === undefined) delete process.env.NTFY_TOPIC; else process.env.NTFY_TOPIC = k; } };
if (want("lib/staffAuth.ts")) { const f = "lib/staffAuth.ts"; const SA = await import("@/lib/staffAuth.ts"); const k = { ...process.env };
  delete process.env.ADMIN_PASSWORD; delete process.env.STAFF_PASSWORD; delete process.env.EDITOR_PASSWORD;
  t(f, "#1: with no admin password of any kind, adminPassword is the EMPTY TEXT (not missing) — every caller can measure it", SA.adminPassword() === "" && typeof SA.adminPassword() === "string");
  process.env.ADMIN_PASSWORD = k.ADMIN_PASSWORD; }
if (want("lib/panelSettings.ts")) { const f = "lib/panelSettings.ts"; const S = await import("@/lib/panelSettings.ts");
  t(f, "#3: a settings row of null is passed straight back (never a crash)", (() => { try { return S.panelSafeSettings(null) === null; } catch { return false; } })()); }
if (want("lib/sentryPrivacy.ts")) { const f = "lib/sentryPrivacy.ts"; const SP = await import("@/lib/sentryPrivacy.ts");
  const e = { data: null, contexts: { trace: { data: { cookie: "c" } } }, spans: [{ data: { token: "t" } }] }; SP.scrubSentryEvent(e);
  t(f, "#4: a report whose extra data is null still has its trace and span secrets blanked (cleaning does not stop early)", e.contexts.trace.data.cookie === SP.REDACTED && e.spans[0].data.token === SP.REDACTED); }
if (want("lib/revealGate.ts")) { const f = "lib/revealGate.ts"; const RG = await import("@/lib/revealGate.ts"); const kr = process.env.REVEAL_PASSWORD;
  delete process.env.REVEAL_PASSWORD;
  t(f, "#8: the RIGHT uncover password opens (and only the right one)", (await RG.revealPasswordMatches(ADMIN_PW)) === true && (await RG.revealPasswordMatches(ADMIN_PW + "x")) === false);
  const ka = process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD;
  t(f, "#10: with no password at all, the uncover door says it is NOT set up", RG.revealConfigured() === false);
  process.env.ADMIN_PASSWORD = ka; if (kr !== undefined) process.env.REVEAL_PASSWORD = kr; }
if (want("lib/rateLimit.ts")) { const f = "lib/rateLimit.ts"; const RL = await import("@/lib/rateLimit.ts");
  t(f, "#21: subjectFor trims the name, so ' Ravi ' and 'ravi' are one person", RL.subjectFor(" Ravi ") === "ravi");
  world({}); t(f, "#22: a blank subject is ALLOWED (never counted, never refused)", (await RL.rateAllowed("staff_login", "")) === true);
  await withAlerts(async () => { world({}); G.RPC_ANSWERS.lfh_rate_check = false; await RL.rateAllowed("staff_login", "*:sub", { label: "the label" }); });
  t(f, "#23: a refusal with a label and no wording helper names the LABEL in the alert", /Who: the label/.test(sent.join("\n")), sent.join(" | ").slice(0, 120));
  world({}); G.FAIL["rpc:lfh_rate_check"] = "throw";
  t(f, "#25: a limiter that THROWS lets the person through", (await RL.rateAllowed("staff_login", "x")) === true);
  await withAlerts(async () => { world({ rate_limit_events: [{ id: "e", key: "staff_login", subject: "*:w", status: "open", restaurant_id: "00000000-0000-0000-0000-000000000000", hit_count: 6, max_count: 5, window_seconds: null }] }); G.RPC_ANSWERS.lfh_rate_check = false; await RL.rateAllowed("staff_login", "*:w"); });
  t(f, "#26: an alert for a limit with no known window says '6 (limit 5)' and 'try again shortly' — never 'undefined sec'", /Tries: 6 \(limit 5\)/.test(sent.join("\n")) && !/undefined/.test(sent.join("\n")) && /try again shortly/.test(sent.join("\n")), sent.join(" | ").slice(0, 160)); }
if (want("lib/managerPin.ts")) { const f = "lib/managerPin.ts"; const MP = await import("@/lib/managerPin.ts"); const UA = await import("@/lib/userAuth.ts"); const h = await UA.hashSecret("8642");
  world({ staff_users: [{ id: "m1", name: "Asha D", username: "asha", role: "manager", restaurant_id: RID_A, active: true, pin_hash: h }], login_throttle: [] });
  const one = await MP.verifyManagerPin("8642", RID_A);
  t(f, "#29: a PIN only ONE manager has is not reported as shared", one.sharedPin === false);
  t(f, "#31: the manager is credited by their DISPLAY name", one.managerName === "Asha D");
  t(f, "#32: spaces around a PIN are ignored", (await MP.verifyManagerPin("  8642 ", RID_A)).ok === true);
  for (let i = 0; i < 5; i++) await MP.verifyManagerPin("0000", RID_A, "pin:x:d");
  const row = G.FIX.login_throttle.find((x) => x.key === "pin:x:d"); const left = new Date(row.locked_until) - Date.now();
  t(f, "#30: the PIN lock lasts exactly one minute", left > 58000 && left <= 60000, `${left}ms`); }
if (want("lib/userAuth.ts")) { const f = "lib/userAuth.ts"; const UA = await import("@/lib/userAuth.ts"); const PA = await import("@/lib/panelAccess.ts");
  const ks = process.env.SESSION_SECRET; delete process.env.SESSION_SECRET;
  const fresh = await import(rootFile("lib/userAuth.ts") + "?warn=" + Date.now());
  const u0 = await person({ username: "w0", pw: "pw-1" }); world({ staff_users: [u0] });
  const w = await quiet(() => fresh.loginUser("w0", "pw-1")); process.env.SESSION_SECRET = ks;
  t(f, "#34: with no SESSION_SECRET, the server warns that changing the admin password signs everyone out", w.logs.some((l) => /SESSION_SECRET is not set/.test(l) && /sign out every staff device/.test(l)));
  const rq = (c, hd = {}) => ({ cookies: { get: (n) => (n === "lfh_user" ? { value: c } : undefined) }, nextUrl: { searchParams: new URLSearchParams("") }, headers: { get: (n) => hd[n] ?? null } });
  const m = await person({ role: "manager", sw_version: "v5", last_seen_at: new Date().toISOString() });
  world({ staff_users: [m], restaurants: [{ id: RID_A, deleted_at: null, active: true }] }); PA.forgetRestaurant(RID_A);
  await UA.requireRole(rq(sign(m)), "manager"); await new Promise((x) => setTimeout(x, 5));
  t(f, "#35: a call with NO app-version header never writes (or clears) the stored version", !G.WRITES.some((x) => x.table === "staff_users"));
  const old = await person({ role: "manager", last_seen_at: new Date(Date.now() - 50000).toISOString() });
  world({ staff_users: [old], restaurants: [{ id: RID_A, deleted_at: null, active: true }] }); PA.forgetRestaurant(RID_A);
  await UA.requireRole(rq(sign(old)), "manager"); await new Promise((x) => setTimeout(x, 5));
  t(f, "#38: a 'last seen' 50 seconds old is refreshed", G.WRITES.some((x) => x.table === "staff_users" && x.patch?.last_seen_at));
  const e = await person({ username: "ep" }); world({ staff_users: [e] });
  const ep = await UA.loginUser("ep", "");
  t(f, "#40: a name with an EMPTY password is refused as 'empty' — never looked up, never counted as a wrong try", ep.reason === "empty" && G.READS.length === 0 && !G.RPCS.length); }
if (want("lib/ownerScope.ts")) { const f = "lib/ownerScope.ts"; const OS = await import("@/lib/ownerScope.ts"); const adminTok = await sha(ADMIN_PW);
  world({ restaurants: [{ id: RID_A, owner_user_id: null }], restaurant_owners: [] }); G.FAIL["restaurant_owners"] = "error";
  const a = await quiet(() => OS.ownerScope(req("/api/owner/x?rid=" + RID_A, { cookies: { lfh_staff_auth: adminTok } })));
  t(f, "#48: the 'could not read who owns' log line carries the database's own message", a.logs.some((l) => /could not read who owns the acting restaurant: stub: restaurant_owners failed/.test(l)), a.logs.join(" | ").slice(0, 160));
  const p = randomUUID(), q = randomUUID();
  world({ restaurants: [{ id: RID_A, owner_user_id: p }], restaurant_owners: [{ user_id: q, restaurant_id: RID_A }] });
  t(f, "#49: a recorded primary who is no longer an owner THERE is skipped for a real current owner", (await OS.ownerScope(req("/api/owner/x?rid=" + RID_A, { cookies: { lfh_staff_auth: adminTok } })))?.ownerId === q);
  t(f, "#52: the incomplete-list reply is a 503 (retryable), not a 504", OS.incompleteListResponse().status === 503); }
if (want("lib/panelGate.ts")) { const f = "lib/panelGate.ts"; const PG = await import("@/lib/panelGate.ts");
  t(f, "#53: panelIframeSrc drops an ?as= that is not a 36-character id", PG.panelIframeSrc("/p/", RID_A, { as: "x&rid=y" }) === `/p/?rid=${RID_A}`); }
if (want("app/api/panel-login/route.ts")) { const f = "app/api/panel-login/route.ts"; const PL = await import("@/app/api/panel-login/route.ts");
  const m = await person({ username: "bt", pw: "pw-1" }); world({ staff_users: [m] });
  const r = await PL.POST(req("/api/panel-login", { method: "POST", json: { username: "bt", password: "pw-1", trap: "bot" } }));
  t(f, "#55: a filled bot trap is refused EVEN WITH THE RIGHT PASSWORD when the human check is off", r.status === 401 && !ck(r, "lfh_user"));
  world({ staff_users: [] }); await PL.POST(req("/api/panel-login", { method: "POST", json: { username: "Ghost Name", password: "x" } }));
  t(f, "#54: a failed sign-in for an unknown name records the typed name as who tried", logs("login_failed")[0]?.actor === "ghost name", logs("login_failed")[0]?.actor); }
if (want("app/api/panel-profile/route.ts")) { const f = "app/api/panel-profile/route.ts"; const PP = await import("@/app/api/panel-profile/route.ts");
  process.env.CREDENTIAL_VAULT_KEY = "r5-vault-key-0123456789abcdef";
  const POST = (u, json) => PP.POST(req("/api/panel-profile", { method: "POST", json, cookies: { lfh_user: sign(u) } }));
  const GET = (u) => PP.GET(req("/api/panel-profile", { cookies: { lfh_user: sign(u) } }));
  const ON = [{ restaurant_id: RID_A, payroll_allowed: true }];
  const p = await person({ role: "tablet", name: "Pia Rao", username: "pia", profile: {} });
  world({ staff_users: [p], settings: ON }); await POST(p, { profile: { city: "x" } });
  t(f, "#56: a details save is logged under the person's DISPLAY name", logs("profile_update")[0]?.actor === "Pia Rao");
  world({ staff_users: [p], settings: [] }); t(f, "#57: staff profiles off answers exactly 403", (await POST(p, { profile: { city: "x" } })).status === 403);
  world({ staff_users: [p], settings: ON }); t(f, "#59: a profile that is a list answers exactly 400", (await POST(p, { profile: [1] })).status === 400);
  const nr = await person({ role: "tablet", restaurant_id: null }); world({ staff_users: [nr], settings: ON });
  t(f, "#66: an account with no restaurant saving a profile answers exactly 400", (await POST(nr, { profile: { city: "x" } })).status === 400);
  const pm = await person({ role: "manager", in_payroll: true, profile: { full_name: "A", city: "B", address: "C" } });
  world({ staff_users: [pm], settings: ON, staff_payments: [] }); G.RPC_ANSWERS.lfh_staff_pay_summary = [{ staff_id: pm.id, paid: 100, advance_outstanding: 250, last_paid_on: "2026-10-05" }];
  const g = await body(await GET(pm));
  t(f, "#58 + #64: the month summary shows the real last-paid date and the real advance still owed", g.paySummary.lastPaidOn === "2026-10-05" && g.paySummary.advanceOutstanding === 250);
  t(f, "#67: 'how complete' counts what is actually saved (3 details here, not 0)", g.completeness.filled >= 3, JSON.stringify(g.completeness));
  const np = await person({ role: "manager", in_payroll: false, can_see_own_pay: null }); world({ staff_users: [np], settings: ON });
  t(f, "#63: someone NOT on the pay list is told they cannot see pay (canSeeOwnPay false)", (await body(await GET(np))).canSeeOwnPay === false);
  const mp = await person({ role: "manager", can_self_set_pin: true }); world({ staff_users: [mp] });
  t(f, "#60: a PIN with spaces around it is saved as its digits", (await POST(mp, { pin: " 1357 " })).status === 200);
  const rn = await person({ role: "tablet", name: "Old Display", username: "olduser", phone: "1", profile_confirmed: true }); world({ staff_users: [rn] });
  await POST(rn, { name: "Old Display" });
  t(f, "#61: re-saving the same display name (whose login name differs) is not logged as a change of name", logs("profile_update").length === 0);
  const pw = await person({ role: "tablet", name: "Pw Person", username: "pwp", pw: "Old-1-pass" }); world({ staff_users: [pw] });
  await POST(pw, { currentPassword: "Old-1-pass", newPassword: "New-2-pass" });
  t(f, "#62 + #68: the password-change line names the person by DISPLAY name, as actor and in its words", logs("password_change")[0]?.actor === "Pw Person" && logs("password_change")[0]?.detail === "Pw Person changed their own password");
  world({ staff_users: [p] }); G.FAIL["staff_users:update"] = "error";
  t(f, "#65: a failed details write answers exactly 500", (await quiet(() => POST(p, { phone: "1" }))).v?.status === 500); }
if (want("app/api/staff-login/route.ts")) { const f = "app/api/staff-login/route.ts"; const SL = await import("@/app/api/staff-login/route.ts");
  const keep = process.env.ADMIN_PASSWORD; process.env.ADMIN_PASSWORD = "a".repeat(200); world({ login_throttle: [] });
  const r = await SL.POST(req("/api/staff-login", { method: "POST", form: { password: "a".repeat(200) }, headers: { accept: "application/json", "x-forwarded-for": "7.2.2.2" } }));
  process.env.ADMIN_PASSWORD = keep;
  t(f, "#69: an admin password of exactly 200 characters is accepted (201 is the first refused)", (await body(r)).ok === true); }
if (want("app/r/[restaurant]/owner/route.ts")) { const f = "app/r/[restaurant]/owner/route.ts"; const OR = await import("@/app/r/[restaurant]/owner/route.ts");
  world({ restaurants: [{ id: RID_A, slug: "mk-o", name: "A", active: true, deleted_at: null }] });
  const r = await OR.GET(req("/r/mk-o/owner", { cookies: { lfh_staff_auth: await sha(ADMIN_PW) } }), { params: Promise.resolve({ restaurant: "mk-o" }) });
  t(f, "#70: the admin's act-as cookie lasts exactly 6 hours (Max-Age=21600)", /Max-Age=21600/.test(ck(r, "aevidine_admin_rid"))); }
if (want("app/r/[restaurant]/login/page.tsx")) { const f = "app/r/[restaurant]/login/page.tsx"; const RP = await import("@/app/r/[restaurant]/login/page.tsx");
  world({ restaurants: [{ id: RID_A, slug: "mk-p", name: "A", active: true, deleted_at: null }] });
  const el = await RP.default({ params: Promise.resolve({ restaurant: "mk-p" }), searchParams: Promise.resolve({ next: "/r/mk-p/kitchen" }) });
  t(f, "#72: a restaurant's door hands its ?next to the sign-in card unchanged", el.props.next === "/r/mk-p/kitchen" && el.props.restaurantSlug === "mk-p");
  const el2 = await RP.default({ params: Promise.resolve({ restaurant: "mk-p" }), searchParams: Promise.resolve({ next: ["/a", "/b"] }) });
  t(f, "…and a ?next given twice (a list) becomes nothing, never the list", el2.props.next === ""); }
save((process.env.T17_SAVE || "") + "/U-mutkill.json");
