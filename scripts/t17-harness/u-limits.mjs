// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, person, req, t, save, quiet, RID_A, RID_B, refuseNet, NET, rootFile } from "./r5lib.mjs";
import { rng, ascii } from "./fz.mjs";
const ONLY = process.env.R5_ONLY || ""; const want = (f) => !ONLY || ONLY === f;
if (want("lib/loginThrottle.ts")) { const f = "lib/loginThrottle.ts"; const LT = await import("@/lib/loginThrottle.ts");
  world({ login_throttle: [] });
  const seq = []; for (let i = 0; i < 12; i++) seq.push(await LT.throttleFail("k1", 5, 60000));
  t(f, "with a limit of 5, the counts go 1,2,3,4,5 and the 5th locks", seq.slice(0, 5).map((x) => x.failCount).join() === "1,2,3,4,5" && seq[4].locked === true && seq.slice(0, 4).every((x) => !x.locked));
  t(f, "…'tries left' goes 4,3,2,1,0", seq.slice(0, 5).map((x) => x.attemptsLeft).join() === "4,3,2,1,0");
  t(f, "…after a lock the count starts again from 1 (a new round)", seq[5].failCount === 1);
  world({ login_throttle: [] }); G.RPC_ANSWERS.lfh_throttle_fail = [{ fail_count: 99, locked: false }]; const saveI = G.RPC_IMPL.lfh_throttle_fail; delete G.RPC_IMPL.lfh_throttle_fail;
  const over = await LT.throttleFail("k2", 10, 1);
  t(f, "a count already past the limit never shows a negative 'tries left'", over.attemptsLeft === 0);
  G.RPC_ANSWERS.lfh_throttle_fail = { fail_count: 2, locked: false };
  t(f, "the counter's answer is read whether it comes back as a list or a single row", (await LT.throttleFail("k3", 10, 1)).failCount === 2);
  G.RPC_ANSWERS.lfh_throttle_fail = [];
  t(f, "an empty answer counts as nothing counted (0) rather than an error", (await LT.throttleFail("k4", 10, 1)).failCount === 0);
  G.RPC_ANSWERS.lfh_throttle_fail = [{ fail_count: "3", locked: "true" }];
  const odd = await LT.throttleFail("k5", 10, 1);
  t(f, "only a real yes counts as 'locked' (the word \"true\" does not)", odd.locked === false && odd.failCount === 3);
  G.RPC_IMPL.lfh_throttle_fail = saveI; delete G.RPC_ANSWERS.lfh_throttle_fail;
  world({ login_throttle: [{ key: "k6", locked_until: new Date(Date.now() + 1500).toISOString() }] });
  const st = await LT.throttleStatus("k6");
  t(f, "retryMs is how long is really left (under 1.5 seconds here)", st.locked && st.retryMs > 0 && st.retryMs <= 1500);
  world({ login_throttle: [{ key: "k7", locked_until: "not a date" }] });
  t(f, "a lock time that is not a date counts as not locked (never a crash)", (await LT.throttleStatus("k7")).locked === false);
  world({ login_throttle: [{ key: "admin:1", locked_until: new Date(Date.now() + 366 * 864e5).toISOString() }, { key: "admin:2", locked_until: new Date(Date.now() + 364 * 864e5).toISOString() }] });
  t(f, "the block line is one year: 366 days out is a block, 364 days is a long lock", (await LT.throttleIsBlocked("admin:1")) === true && (await LT.throttleIsBlocked("admin:2")) === false);
  world({ login_throttle: [{ key: "admin:a", locked_until: new Date(Date.now() + 200 * 365 * 864e5).toISOString(), note: "n" }, { key: "pin:a", locked_until: new Date(Date.now() + 200 * 365 * 864e5).toISOString() }] });
  t(f, "the blocked list for another kind of key ('pin:') lists that kind only", (await LT.listBlocked("pin:")).map((x) => x.key).join() === "pin:a");
  world({ login_throttle: [] }); await LT.throttleBlock("admin:9");
  t(f, "a block with no note stores no note (null), and a fresh count of 0", G.FIX.login_throttle[0].note === null && G.FIX.login_throttle[0].fail_count === 0);
  await LT.throttleBlock("admin:9", "second");
  t(f, "blocking the same key again updates that ONE row (never two rows for one key)", G.FIX.login_throttle.length === 1 && G.FIX.login_throttle[0].note === "second");
  world({ login_throttle: [{ key: "x" }, { key: "y" }] }); await LT.throttleReset("x");
  t(f, "a reset removes exactly that key", G.FIX.login_throttle.map((r) => r.key).join() === "y");
  const r = rng(21); let bad = 0; for (let i = 0; i < 2000; i++) { const a = ascii(r, 15).trim(); if (!a) continue; const ip = LT.clientIp({ headers: { get: (n) => (n === "x-forwarded-for" ? `${a}, 10.0.0.1` : null) } }); if (ip !== a.split(",")[0].trim()) bad++; }
  t(f, "2,000 random forwarded lists: the address is always the first entry, trimmed", bad === 0);
  t(f, "an EMPTY forwarded header falls back to the real-ip header", LT.clientIp({ headers: { get: (n) => (n === "x-forwarded-for" ? "" : n === "x-real-ip" ? "4.4.4.4" : null) } }) === "4.4.4.4");
}
if (want("lib/rateLimit.ts")) { const f = "lib/rateLimit.ts"; const RL = await import("@/lib/rateLimit.ts");
  world({}); G.RPC_ANSWERS.lfh_rate_check = null;
  t(f, "a limiter that answers nothing (null) lets the person through", (await RL.rateAllowed("staff_login", "x")) === true);
  world({}); G.RPC_ANSWERS.lfh_rate_check = 0;
  t(f, "only an explicit 'false' refuses — a 0 does not", (await RL.rateAllowed("staff_login", "x")) === true);
  world({}); G.RPC_ANSWERS.lfh_rate_check = true; await RL.rateAllowed("password_change", "u1");
  t(f, "with no restaurant, the check is sent with an empty restaurant (null), not a guess", G.RPCS[0].args.p_rid === null && G.RPCS[0].args.p_label === null);
  world({}); G.RPC_ANSWERS.lfh_rate_check = true; await RL.rateAllowed("staff_login", "s".repeat(250));
  t(f, "a 250-character subject reaches the limiter as exactly 200", G.RPCS[0].args.p_subject.length === 200);
  world({ rate_limit_events: [{ id: "e9", key: "staff_login", subject: "*:x", status: "open", restaurant_id: "00000000-0000-0000-0000-000000000000" }] }); G.RPC_ANSWERS.lfh_rate_check = false;
  await RL.rateAllowed("staff_login", "*:x", { label: "plain label" });
  t(f, "without a wording helper, the open event's label is left alone", G.FIX.rate_limit_events[0].subject_label === undefined);
  world({ rate_limit_events: [{ id: "e10", key: "staff_login", subject: "*:x", status: "open", restaurant_id: RID_A }], restaurants: [{ id: RID_A, name: "Aangan" }] }); G.RPC_ANSWERS.lfh_rate_check = false;
  await RL.rateAllowed("staff_login", "*:x", { restaurantId: RID_A, describe: async () => "D".repeat(300) });
  t(f, "the wording written onto the event is cut to 200", G.FIX.rate_limit_events[0].subject_label?.length === 200);
  world({}); G.RPC_ANSWERS.lfh_rate_check = false; G.FAIL["rate_limit_events"] = "throw";
  t(f, "a refusal still answers 'refused' when the event read throws", (await RL.rateAllowed("staff_login", "*:x", { describe: async () => "d" })) === false);
  world({ rate_limit_counters: [{ key: "staff_login", subject: "*:x", restaurant_id: null }, { key: "admin_login", subject: "*:x" }] });
  await RL.rateResetOnSuccess("staff_login", "  *:x  ");
  t(f, "a reset trims the subject and touches only that key's counter", G.FIX.rate_limit_counters.length === 1 && G.FIX.rate_limit_counters[0].key === "admin_login");
  t(f, "subjectFor keeps inner spaces (it is a counting key, not a display name)", RL.subjectFor("Ravi  Kumar") === "ravi  kumar");
  world({}); G.FAIL["rpc:lfh_rate_alert"] = "error";
  t(f, "recordAlert with an error answer (not a throw) does not throw", await (async () => { try { await RL.recordAlert("admin_login", "x", "l", 3); return true; } catch { return false; } })());
  t(f, "the limiter never reached the internet (alerts are off with no channel set)", NET.length === 0);
}
if (want("lib/managerPin.ts")) { const f = "lib/managerPin.ts"; const MP = await import("@/lib/managerPin.ts"); const UA = await import("@/lib/userAuth.ts");
  const h = await UA.hashSecret("13579");
  for (const [pin, ok] of [["1357", false], ["13579", true], ["135790", false], ["00013579", false]]) {
    world({ staff_users: [{ id: "m1", name: "A", username: "a", role: "manager", restaurant_id: RID_A, active: true, pin_hash: h }] });
    t(f, `the PIN “${pin}” ${ok ? "matches" : "does not match"} a stored 13579`, (await MP.verifyManagerPin(pin, RID_A)).ok === ok);
  }
  world({ staff_users: [{ id: "m1", name: "A", username: "a", role: "manager", restaurant_id: RID_A, active: true, pin_hash: h }] });
  t(f, "an 8-digit PIN is the longest accepted shape; 4 the shortest (read happens for both)", await (async () => { await MP.verifyManagerPin("1234", RID_A); const a = G.READS.length; await MP.verifyManagerPin("12345678", RID_A); return a === 1 && G.READS.length === 2; })());
  world({ staff_users: [{ id: "m1", name: "A", username: "a", role: "manager", restaurant_id: RID_A, active: true, pin_hash: h }], login_throttle: [] });
  for (let i = 0; i < 5; i++) await MP.verifyManagerPin("0000", RID_A, "pin:d");
  const row = G.FIX.login_throttle.find((x) => x.key === "pin:d");
  t(f, "five wrong PINs on one device lock that device (the PIN lock's own limit)", !!row?.locked_until && new Date(row.locked_until) > new Date());
  t(f, "…and then the RIGHT PIN is refused as locked", (await MP.verifyManagerPin("13579", RID_A, "pin:d")).locked === true);
  t(f, "…on ANOTHER device the right PIN still works", (await MP.verifyManagerPin("13579", RID_A, "pin:other")).ok === true);
  world({ staff_users: [{ id: "m1", role: "manager", restaurant_id: RID_A, active: true, pin_hash: h }] });
  t(f, "a manager with neither a name nor a login name is credited with an empty name (never a crash)", (await MP.verifyManagerPin("13579", RID_A)).ok === true);
  world({}); G.FAIL["staff_users"] = "error";
  t(f, "anyManagerHasPin says no when its read fails", (await MP.anyManagerHasPin(RID_A)) === false);
}
if (want("lib/supabaseAdmin.ts")) { const f = "lib/supabaseAdmin.ts";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://r5-not-real.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "r5-service-key-0123456789abcdef";
  const real = await import(rootFile("lib/supabaseAdmin.ts") + "?real=r5");
  let hdr = null; globalThis.fetch = async (u, i) => { hdr = new Headers(i?.headers); return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); };
  await real.supabaseAdmin.from("x").select("id").limit(1); globalThis.fetch = refuseNet;
  t(f, "every read is sent with the service key (it is the server's own client)", hdr?.get("apikey") === "r5-service-key-0123456789abcdef");
  let ms = null; globalThis.fetch = async (u, i) => { const t0 = Date.now(); await new Promise((res) => i.signal.addEventListener("abort", res)); ms = Date.now() - t0; throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); };
  const hold = setInterval(() => {}, 500); const sl = await real.supabaseAdmin.from("x").select("id").limit(1); clearInterval(hold); globalThis.fetch = refuseNet;
  t(f, "a read that never answers is cut off at about 8 seconds, and comes back as an error", ms !== null && ms >= 7500 && ms < 9500 && !!sl.error, `${ms}ms`);
}
save((process.env.T17_SAVE || "") + "/U-limits.json");
