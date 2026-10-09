// SWEEP #10 T17 ROUND 6 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
//
// Checks written because a deliberate break SURVIVED round 6's mutation pass B (421 breaks, new seed). The number in each
// check is the survivor it kills.
import { G, world, person, sign, req, t, save, quiet, RID_A, randomUUID, refuseNet } from "./r5lib.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
const sent = []; const capture = async (u, init) => { sent.push({ body: String(init?.body ?? ""), headers: new Headers(init?.headers) }); return new Response("{}", { status: 200 }); };
const withAlerts = async (fn) => { const k = process.env.NTFY_TOPIC; process.env.NTFY_TOPIC = "r6-topic"; sent.length = 0; globalThis.fetch = capture; try { return await fn(); } finally { globalThis.fetch = refuseNet; if (k === undefined) delete process.env.NTFY_TOPIC; else process.env.NTFY_TOPIC = k; } };
if (want("lib/sentryPrivacy.ts")) { const f = "lib/sentryPrivacy.ts"; const SP = await import("@/lib/sentryPrivacy.ts");
  const e = { request: null, data: { token: "t" }, contexts: { trace: { data: { cookie: "c" } } } }; SP.scrubSentryEvent(e);
  t(f, "B#1: a report whose request part is EMPTY (null) still has its data and trace secrets blanked", e.data.token === SP.REDACTED && e.contexts.trace.data.cookie === SP.REDACTED); }
if (want("lib/revealGate.ts")) { const f = "lib/revealGate.ts"; const RG = await import("@/lib/revealGate.ts"); delete process.env.REVEAL_PASSWORD;
  t(f, "B#3: an EMPTY typed uncover password never opens, even with a password set", (await RG.revealPasswordMatches("")) === false); }
if (want("lib/passwordVault.ts")) { const f = "lib/passwordVault.ts"; const PV = await import("@/lib/passwordVault.ts");
  t(f, "B#13: opening nothing answers exactly null (the promised 'no copy'), not undefined", (await PV.openPassword(null)) === null && (await PV.openPassword("")) === null); }
if (want("lib/rateLimit.ts")) { const f = "lib/rateLimit.ts"; const RL = await import("@/lib/rateLimit.ts"); const { RATE_LABELS } = await import("@/lib/plainError.ts");
  t(f, "B#29: subjectFor keeps exactly 120 characters of a long name", RL.subjectFor("x".repeat(500)).length === 120);
  world({}); await RL.recordAlert("admin_login", "s".repeat(300), "l".repeat(300), 3); const al = G.RPCS.find((r) => r.name === "lfh_rate_alert")?.args;
  t(f, "B#30: recordAlert stores exactly 200 characters of subject and label", al?.p_subject.length === 200 && al?.p_label.length === 200);
  await withAlerts(async () => { world({}); G.RPC_ANSWERS.lfh_rate_check = false; await RL.rateAllowed("staff_login", "*:z", { label: "lbl" }); });
  const title = sent[0]?.headers.get("Title") || sent[0]?.headers.get("title") || "";
  t(f, "B#31: the alert's title is 'Limit reached: Staff / owner login' — the plain name of the limit, not the code word", /Limit reached: Staff \/ owner login$/.test(title) && RATE_LABELS.staff_login === "Staff / owner login", title);
  world({}); G.RPC_ANSWERS.lfh_rate_check = true; await RL.rateAllowed("staff_login", "x", { label: "L".repeat(250) });
  t(f, "B#34/#37: a long label reaches the limiter as exactly 200 characters", G.RPCS[0].args.p_label.length === 200);
  const s200 = "q".repeat(200); world({ rate_limit_counters: [{ key: "staff_login", subject: s200 }] }); await RL.rateResetOnSuccess("staff_login", s200 + "EXTRA-PART-BEYOND-200");
  t(f, "B#35: a successful sign-in clears the counter stored under the same 200-character cut as the limiter used", G.FIX.rate_limit_counters.length === 0); }
if (want("lib/userAuth.ts")) { const f = "lib/userAuth.ts"; const UA = await import("@/lib/userAuth.ts");
  world({ staff_users: [] }); const r = await UA.loginUser("n".repeat(150), "x");
  t(f, "B#38/#39: an oversize name is logged as exactly its first 80 characters", r.reason === "too_long" && r.attempted.username.length === 80); }
if (want("lib/panelAccess.ts")) { const f = "lib/panelAccess.ts"; const PA = await import("@/lib/panelAccess.ts");
  const ow = randomUUID(); const links = Array.from({ length: 1000 }, (_, i) => ({ user_id: ow, restaurant_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
  links.push({ user_id: ow, restaurant_id: "00000000-0000-4000-8000-999999999999" });
  world({ restaurant_owners: links, restaurants: links.map((l) => ({ id: l.restaurant_id, deleted_at: null })) });
  t(f, "B#46: an owner with 1,001 restaurants keeps all 1,001 (a full first page of exactly 1,000 does not end the list)", (await PA.enabledOwnedRestaurantIds(ow, false)).length === 1001);
  world({ restaurant_owners: [{ user_id: "a", restaurant_id: RID_A }, { user_id: "b", restaurant_id: RID_A }] });
  t(f, "B#50: ownersOf lists this restaurant's owners (not an empty list)", JSON.stringify((await PA.ownersOf(RID_A)).sort()) === '["a","b"]');
  world({}); G.FAIL["restaurant_owners"] = "error";
  t(f, "B#51: when an owner's restaurants cannot be read, their log line is filed under exactly null", (await PA.ownerLogRestaurant(randomUUID(), [RID_A])) === null); }
if (want("lib/ownerScope.ts")) { const f = "lib/ownerScope.ts"; const OS = await import("@/lib/ownerScope.ts");
  world({}); t(f, "B#53: no admin cookie and no pass → ownerScope answers exactly null", (await OS.ownerScope(req("/api/owner/x"))) === null);
  t(f, "B#56: an owner's actions are named by their login name when they have one", OS.ownerActorName({ all: false, ids: [], ownerId: "id-1", ownerName: "meera" }) === "meera");
  t(f, "B#57: …and by their id when they have no name", OS.ownerActorName({ all: false, ids: [], ownerId: "id-1" }) === "id-1"); }
if (want("app/api/panel-profile/route.ts")) { const f = "app/api/panel-profile/route.ts"; const PP = await import("@/app/api/panel-profile/route.ts");
  process.env.CREDENTIAL_VAULT_KEY = "r6-vault-key-0123456789abcdef";
  const POST = (u, json) => PP.POST(req("/api/panel-profile", { method: "POST", json, cookies: { lfh_user: sign(u) } }));
  const n = await person({ role: "tablet", can_self_set_pin: false }); world({ staff_users: [n] });
  t(f, "B#59: a PIN for someone the admin manages answers exactly 403", (await POST(n, { pin: "1234" })).status === 403);
  const pw = await person({ username: "b64", pw: "Same-Pass-1" }); world({ staff_users: [pw] });
  t(f, "B#64: 'must be different' answers exactly 400", (await POST(pw, { currentPassword: "Same-Pass-1", newPassword: "Same-Pass-1" })).status === 400);
  const pr = await person({ role: "tablet", profile: {} }); world({ staff_users: [pr], settings: [{ restaurant_id: RID_A, payroll_allowed: true }] }); G.FAIL["staff_users:update"] = "error";
  t(f, "B#66: a failed own-details write answers exactly 500", (await quiet(() => POST(pr, { profile: { city: "x" } }))).v?.status === 500);
  world({ staff_users: [n] }); t(f, "B#67: 'nothing to update' answers exactly 400", (await POST(n, { nothing: 1 })).status === 400);
  const mp = await person({ role: "manager", can_self_set_pin: true, pin_hash: null, name: "M", phone: null, profile_confirmed: false }); world({ staff_users: [mp] });
  await POST(mp, { name: "M", phone: "9" });
  t(f, "B#65: a manager who must set a PIN is NOT 'set up' with only a name and phone", G.FIX.staff_users[0].profile_confirmed !== true);
  const lb = await person({ username: "lbu", name: "Label Name", role: "manager", pw: "Old-1-pass" }); world({ staff_users: [lb] }); G.RPC_ANSWERS.lfh_rate_check = true;
  await POST(lb, { currentPassword: "Old-1-pass", newPassword: "New-2-pass" });
  t(f, "B#68: the own-password limit names the person by display name ('Label Name (manager) changing their own password')", G.RPCS.find((x) => x.name === "lfh_rate_check")?.args.p_label === "Label Name (manager) changing their own password"); }
save((process.env.T17_SAVE || "") + "/U-mutkill2.json");
