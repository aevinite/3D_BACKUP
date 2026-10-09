// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
import { G, world, req, t, save, quiet, RID_A, RID_B, ADMIN_PW, sha, refuseNet, NET } from "./r5lib.mjs";
import { rng, str, ascii, uni } from "./fz.mjs";
const ONLY = process.env.R5_ONLY || "";
const want = (f) => !ONLY || ONLY === f;
if (want("lib/staffAuth.ts")) { const f = "lib/staffAuth.ts"; const SA = await import("@/lib/staffAuth.ts"); const r = rng(11);
  let bad = 0; for (let i = 0; i < 3000; i++) { const a = ascii(r, 12), b = r() < 0.3 ? a : ascii(r, 12); if (SA.safeEqual(a, b) !== (a === b)) bad++; }
  t(f, "safeEqual agrees with plain equality on 3,000 random pairs (a third of them equal)", bad === 0, `${bad} disagreements`);
  bad = 0; for (let i = 0; i < 2000; i++) { const a = uni(r, 10); if (!SA.safeEqual(a, a) || SA.safeEqual(a, a + "x")) bad++; }
  t(f, "safeEqual: every random Unicode text equals itself and never equals itself plus one letter", bad === 0);
  bad = 0; const { createHash } = await import("node:crypto"); for (let i = 0; i < 300; i++) { const s = uni(r, 40); if ((await SA.sha256hex(s)) !== createHash("sha256").update(s, "utf8").digest("hex")) bad++; }
  t(f, "sha256hex matches Node's own SHA-256 on 300 random Unicode texts", bad === 0);
  t(f, "sha256hex always answers 64 lower-case hex characters", /^[0-9a-f]{64}$/.test(await SA.sha256hex("x")));
  bad = 0; const fails = []; for (let i = 0; i < 20000; i++) { const s = str(r, 16); const out = SA.sameSitePath(s, "/fb"); if (out !== "/fb") { const u = new URL(out, "http://h.example"); if (u.origin !== "http://h.example" || !out.startsWith("/") || out.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(out)) { bad++; if (fails.length < 3) fails.push(JSON.stringify(s)); } } }
  t(f, "sameSitePath on 20,000 random tricky addresses: everything it keeps is a same-site path a browser cannot read as another site", bad === 0, fails.join(" "));
  bad = 0; for (let i = 0; i < 5000; i++) { const s = str(r, 16); const o = SA.sameSitePath(s, "/fb"); if (o !== "/fb" && SA.sameSitePath(o, "/fb") !== o) bad++; }
  t(f, "sameSitePath is stable: a path it kept is kept unchanged when checked again (5,000 tries)", bad === 0);
  for (const [i, o] of [["/a?b=1#c", "/a?b=1#c"], ["/a/./b", "/a/b"], ["/%2e%2e/x", "/x"], ["/a%2F..%2Fb", "/a%2F..%2Fb"], ["///x", "/fb"], ["/ ", "/"], ["", "/fb"], ["/", "/"]])
    t(f, `sameSitePath(${JSON.stringify(i)}) is ${JSON.stringify(o)}`, SA.sameSitePath(i, "/fb") === o, SA.sameSitePath(i, "/fb"));
  t(f, "tokenIsValid uses the FIRST of ADMIN / STAFF / EDITOR password that is set", await (async () => { const k = { ...process.env }; delete process.env.ADMIN_PASSWORD; process.env.STAFF_PASSWORD = "st-pw"; const a = await SA.tokenIsValid(await sha("st-pw")); process.env.ADMIN_PASSWORD = k.ADMIN_PASSWORD; delete process.env.STAFF_PASSWORD; return a; })());
  t(f, "a token one character short of the right one is refused", (await SA.tokenIsValid((await sha(ADMIN_PW)).slice(0, 63))) === false);
  t(f, "a token with one extra character is refused", (await SA.tokenIsValid((await sha(ADMIN_PW)) + "0")) === false);
}
if (want("lib/panelScope.ts")) { const f = "lib/panelScope.ts"; const PS = await import("@/lib/panelScope.ts"); const r = rng(12);
  const mk = (q, ck = {}) => ({ cookies: { get: (n) => (ck[n] !== undefined ? { value: ck[n] } : undefined) }, nextUrl: { searchParams: new URLSearchParams(q) } });
  let bad = 0; for (let i = 0; i < 2000; i++) { const junk = ascii(r, 40); const got = PS.panelRestaurantId(mk("rid=" + encodeURIComponent(junk), { aevidine_admin_rid: junk }), { user: { restaurant_id: RID_A } }); if (got !== RID_A) bad++; }
  t(f, "2,000 random ?rid= and act-as values never move a signed-in staff member off their own restaurant", bad === 0);
  t(f, "an EMPTY ?rid= is ignored and the act-as cookie used instead", PS.panelRestaurantId(mk("rid=", { aevidine_admin_rid: RID_B }), { user: null }) === RID_B);
  t(f, "an empty act-as cookie counts as no restaurant", PS.panelRestaurantId(mk("", { aevidine_admin_rid: "" }), { user: null }) === null);
  t(f, "the admin's ?rid= is passed through exactly (checking its shape is the route's job)", PS.panelRestaurantId(mk("rid=abc"), { user: null }) === "abc");
  t(f, "emptyIdSegment is exactly three words, case-sensitive", ["undefined", "null", "NaN"].every(PS.emptyIdSegment) && !["UNDEFINED", "nan", " null", "0", "false"].some(PS.emptyIdSegment));
}
if (want("lib/panelSettings.ts")) { const f = "lib/panelSettings.ts"; const S = await import("@/lib/panelSettings.ts"); const r = rng(13);
  let bad = 0; for (let i = 0; i < 1000; i++) { const row = {}; const n = Math.floor(r() * 8); for (let j = 0; j < n; j++) row[ascii(r, 6) || "k"] = r(); if (r() < 0.5) row.platform_channels = { k: r() }; const keep = JSON.stringify(row); const o = S.panelSafeSettings(row); if ("platform_channels" in o || JSON.stringify(row) !== keep || Object.keys(o).length !== Object.keys(row).filter((k) => k !== "platform_channels").length) bad++; }
  t(f, "1,000 random settings rows: the delivery keys always go, every other key stays, the original row is never changed", bad === 0);
  t(f, "a row that is an array is treated as an object and keeps its entries (no crash)", JSON.stringify(S.panelSafeSettings([1])) === '{"0":1}');
  t(f, "the result is a NEW object even when there was nothing to remove", (() => { const a = { x: 1 }; return S.panelSafeSettings(a) !== a; })());
  t(f, "a value that is a number or false is passed straight back", S.panelSafeSettings(0) === 0 && S.panelSafeSettings(false) === false);
}
if (want("lib/sentryPrivacy.ts")) { const f = "lib/sentryPrivacy.ts"; const SP = await import("@/lib/sentryPrivacy.ts"); const r = rng(14);
  const names = ["cookie", "set-cookie", "authorization", "x-api-key", "api_key", "apikey", "session", "x-session-token", "password", "passwd", "secret", "lfh_user", "lfh-agent", "lfh_staff_auth", "lfh_reveal", "proxy-authorization", "x-auth"];
  t(f, "every secret-sounding header in a list of 17 is caught", names.every(SP.isSecretName));
  t(f, "…in UPPER case too", names.map((n) => n.toUpperCase()).every(SP.isSecretName));
  t(f, "user-agent in any case or with an underscore stays readable", ["user-agent", "USER-AGENT", "User_Agent", "user_agent"].every((n) => !SP.isSecretName(n)));
  t(f, "…but a header that merely CONTAINS user-agent and a secret word is still secret", SP.isSecretName("x-user-agent-token"));
  let bad = 0; for (let i = 0; i < 1000; i++) { const h = {}; const n = 1 + Math.floor(r() * 6); for (let j = 0; j < n; j++) { const k = r() < 0.5 ? names[Math.floor(r() * names.length)] : ascii(r, 8) || "h"; h[k] = "v" + j; } const ev = { request: { headers: { ...h }, cookies: "c", data: "d" }, data: { ...h }, contexts: { trace: { data: { ...h } } }, spans: [{ data: { ...h } }] }; SP.scrubSentryEvent(ev); for (const box of [ev.request.headers, ev.data, ev.contexts.trace.data, ev.spans[0].data]) for (const [k, v] of Object.entries(box)) if (SP.isSecretName(k) ? v !== SP.REDACTED : v === SP.REDACTED) bad++; if ("cookies" in ev.request || "data" in ev.request) bad++; }
  t(f, "1,000 random error reports: every secret-named field is blanked in all four places, nothing else is", bad === 0);
  t(f, "a field NAMED like a secret but holding an object is blanked too (not walked into)", (() => { const e = { data: { session: { id: 1 } } }; SP.scrubSentryEvent(e); return e.data.session === SP.REDACTED; })());
  t(f, "a report whose headers are an array is left alone (not mangled)", (() => { const e = { request: { headers: ["cookie", "x"] } }; SP.scrubSentryEvent(e); return Array.isArray(e.request.headers) && e.request.headers[0] === "cookie"; })());
  t(f, "the user's IP stays in reports (userInfo on) — the only personal field kept", SP.SENTRY_DATA_COLLECTION.userInfo === true);
}
if (want("lib/revealGate.ts")) { const f = "lib/revealGate.ts"; const RG = await import("@/lib/revealGate.ts"); const r = rng(15);
  delete process.env.REVEAL_PASSWORD;
  let bad = 0; for (let i = 0; i < 300; i++) { const m = await RG.mintRevealToken(60000); const [e, s] = m.value.split("."); const sig2 = s.slice(0, i % s.length) + (s[i % s.length] === "0" ? "1" : "0") + s.slice((i % s.length) + 1); if (await RG.revealUnlocked(`${e}.${sig2}`)) bad++; }
  t(f, "300 unlocks each with ONE signature character changed: every one is refused", bad === 0);
  bad = 0; for (let i = 0; i < 2000; i++) if (await RG.revealUnlocked(str(r, 20))) bad++;
  t(f, "2,000 random cookie values: none unlocks", bad === 0);
  const m = await RG.mintRevealToken();
  t(f, "an unlock's value is <time>.<64 hex>", /^\d{13}\.[0-9a-f]{64}$/.test(m.value));
  t(f, "two unlocks made at different times carry different signatures", await (async () => { const a = await RG.mintRevealToken(1000); await new Promise((x) => setTimeout(x, 3)); const b = await RG.mintRevealToken(1000); return a.value.split(".")[1] !== b.value.split(".")[1]; })());
  t(f, "an unlock whose time is written another way (' 123', '+123', '0123') still ends at exactly the SAME time — it can never be stretched", (await RG.revealUnlockedUntil(" " + m.value)) === m.expiresAt && (await RG.revealUnlockedUntil("+" + m.value)) === m.expiresAt && (await RG.revealUnlockedUntil("0" + m.value)) === m.expiresAt);
  t(f, "the uncover password is exact: one extra space does not open", (await RG.revealPasswordMatches(ADMIN_PW + " ")) === false && (await RG.revealPasswordMatches(" " + ADMIN_PW)) === false);
  t(f, "unlocked-until answers the exact expiry time it was minted with", (await RG.revealUnlockedUntil(m.value)) === m.expiresAt);
}
if (want("lib/publicCap.ts")) { const f = "lib/publicCap.ts"; const PC = await import("@/lib/publicCap.ts");
  const R_ = (dev, xff) => ({ cookies: { get: (n) => (n === "lfh_panel_device" && dev !== undefined ? { value: dev } : undefined) }, headers: { get: (n) => (n === "x-forwarded-for" ? xff ?? null : null) } });
  t(f, "an EMPTY device cookie falls back to the address", PC.capKeyFor(R_("", "1.2.3.4")) === "ip:1.2.3.4");
  world({ staff_actions: [{ id: 1, device_id: "d", action: "a", created_at: new Date(Date.now() - 59000).toISOString() }, { id: 2, device_id: "d", action: "a", created_at: new Date(Date.now() - 61000).toISOString() }] });
  t(f, "a row 59 seconds old is inside a 60-second window, one 61 seconds old is not", (await PC.recentActionCount("d", "a", 60000, 10)) === 1);
  t(f, "underActionCap with a cap of 1 and one row already: refused", (await PC.underActionCap("d", "a", 60000, 1)) === false);
  t(f, "underActionCap with nothing recorded: allowed", (await PC.underActionCap("nobody", "a", 60000, 1)) === true);
  const k = "w-" + Math.random();
  t(f, "withinMemoryCap with a max of 0 refuses after the first (the first call always opens a window)", PC.withinMemoryCap(k, 60000, 0) === true && PC.withinMemoryCap(k, 60000, 0) === false);
  const k2 = "w2-" + Math.random(); const seq = []; for (let i = 0; i < 6; i++) seq.push(PC.withinMemoryCap(k2, 60000, 4));
  t(f, "withinMemoryCap(max 4): exactly 4 allowed, then refused", seq.join() === "true,true,true,true,false,false");
  t(f, "two different callers have separate counts", (() => { const a = "a-" + Math.random(), b = "b-" + Math.random(); PC.withinMemoryCap(a, 60000, 1); PC.withinMemoryCap(a, 60000, 1); return PC.withinMemoryCap(b, 60000, 1) === true; })());
}
if (want("lib/ownerPin.ts")) { const f = "lib/ownerPin.ts"; const OP = await import("@/lib/ownerPin.ts"); const r = rng(16);
  let bad = 0; for (let i = 0; i < 2000; i++) { const v = ascii(r, 20); globalThis.window = { location: { search: "?as=" + encodeURIComponent(v) } }; const s = OP.asSuffix(); if (v ? s !== "&as=" + encodeURIComponent(v) || OP.asValue() !== v : s !== "") bad++; if (s.slice(4).includes("&") || s.slice(4).includes("=")) bad++; }
  delete globalThis.window;
  t(f, "2,000 random owner pins: always carried exactly, encoded, and never able to add a second parameter", bad === 0);
  globalThis.window = { location: { search: "?as=a&as=b" } };
  t(f, "two ?as= in the address: the FIRST one is used", OP.asValue() === "a"); delete globalThis.window;
}
if (want("lib/adminFetch.ts")) { const f = "lib/adminFetch.ts"; const AF = await import("@/lib/adminFetch.ts");
  const W = async (impl, fn) => { globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = refuseNet; } };
  const e404 = await W(async () => new Response(JSON.stringify({ nope: 1 }), { status: 404 }), () => AF.adminFetch("/x", { method: "POST" }));
  t(f, "a 404 with no error words says 'Request failed (404)' and keeps the status", e404.ok === false && e404.error === "Request failed (404)" && e404.status === 404);
  const eNum = await W(async () => new Response(JSON.stringify({ error: 42 }), { status: 400 }), () => AF.adminFetch("/x", { method: "POST" }));
  t(f, "an error that is a number is shown as text ('42')", eNum.error === "42");
  const eNull = await W(async () => new Response(JSON.stringify({ error: null }), { status: 200 }), () => AF.adminFetch("/x"));
  t(f, "a 200 carrying error:null is still a FAILURE (the field is there)", eNull.ok === false);
  const arr = await W(async () => new Response(JSON.stringify([1, 2]), { status: 200 }), () => AF.adminFetch("/x"));
  t(f, "a 200 that is a list is ok with that list", arr.ok === true && arr.data.length === 2);
  let init = null; await W(async (u, i) => { init = i; return new Response("{}"); }, () => AF.adminFetch("/x", { method: "PATCH", headers: { a: "b" } }));
  t(f, "a caller's own method and headers are kept", init?.method === "PATCH" && init?.headers?.a === "b");
  t(f, "…and a read with no signal of its own gets a deadline signal", await (async () => { let s = null; await W(async (u, i) => { s = i?.signal; return new Response("{}"); }, () => AF.adminFetch("/x")); return !!s; })());
  const te = await W(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }, () => AF.adminFetch("/x", { method: "POST" }));
  t(f, "a TimeoutError (not only an AbortError) says it took too long", te.ok === false && te.status === 0 && /too long/i.test(te.error));
}
if (want("lib/passwordVault.ts")) { const f = "lib/passwordVault.ts"; const PV = await import("@/lib/passwordVault.ts"); const r = rng(17); const keep = { ...process.env };
  process.env.CREDENTIAL_VAULT_KEY = "r5-vault-key-0123456789abcdef"; process.env.SUPABASE_SERVICE_ROLE_KEY = "r5-service-key-0123456789abcdef";
  let bad = 0; for (let i = 0; i < 150; i++) { const p = uni(r, 40) || "x"; const s = await PV.sealPassword(p); if ((await PV.openPassword(s)) !== p) bad++; }
  t(f, "150 random Unicode passwords each seal and open back exactly", bad === 0);
  t(f, "a key of exactly 16 characters is usable, 15 is not", (() => { process.env.CREDENTIAL_VAULT_KEY = "x".repeat(16); delete process.env.SUPABASE_SERVICE_ROLE_KEY; const a = PV.vaultReady(); process.env.CREDENTIAL_VAULT_KEY = "x".repeat(15); const b = PV.vaultReady(); return a === true && b === false; })());
  process.env.CREDENTIAL_VAULT_KEY = "r5-vault-key-0123456789abcdef"; process.env.SUPABASE_SERVICE_ROLE_KEY = "r5-service-key-0123456789abcdef";
  const v2 = await PV.sealPassword("p1"); const [, iv, ct] = v2.split("$");
  t(f, "a v2 copy relabelled as v1 does not open (each version only opens with its own key)", (await PV.openPassword(`v1$${iv}$${ct}`)) === null);
  t(f, "a copy with its parts swapped does not open", (await PV.openPassword(`v2$${ct}$${iv}`)) === null);
  t(f, "the random start of each copy is 12 bytes (16 characters)", iv.length === 16);
  delete process.env.CREDENTIAL_VAULT_KEY;
  t(f, "with no own key, a v2 copy cannot be opened at all (there is no key to try)", (await PV.openPassword(v2)) === null);
  process.env.CREDENTIAL_VAULT_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const same = await PV.sealPassword("p2");
  t(f, "when the own key happens to equal the service key, copies still seal (v2) and open", same.startsWith("v2$") && (await PV.openPassword(same)) === "p2");
  t(f, "needsReseal is false for a v1 copy while the own key is missing", (() => { delete process.env.CREDENTIAL_VAULT_KEY; return PV.needsReseal("v1$a$b") === false; })());
  t(f, "needsReseal is true for a v1 copy once the own key exists, false for 'v1' without the separator", (() => { process.env.CREDENTIAL_VAULT_KEY = "r5-vault-key-0123456789abcdef"; return PV.needsReseal("v1$a$b") === true && PV.needsReseal("v1") === false && PV.needsReseal("v10$a") === false; })());
  for (const k of ["CREDENTIAL_VAULT_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
}
t("lib/staffAuth.ts", "no check in this suite reached the internet", NET.length === 0, NET.join(" "));
save((process.env.T17_SAVE || "") + "/U-small.json");
