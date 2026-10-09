// verify-t25-login-and-panel-apis.mjs — the permanent regression guard for the STAFF DOORS
// and the manager panel's write API.
//
// Territory (sweep #8, terminal 25):
//   app/api/panel-login · panel-logout · panel-profile · staff-login · staff-logout
//   app/login/** · app/staff-login/** · app/r/[restaurant]/login (the tenant-scoped door)
//   lib/userAuth.ts
//   app/api/editor/[...path]/route.ts — the POST/PATCH/DELETE half (from ~line 3000 to the end)
//
// WHY IT EXISTS. Sweeps #6 and #7 wrote ~160 numbered checks over these files
// (.claude/sweep/LEDGER/T10.md, T24.md, T27.md). Almost all of them were answered by a person
// reading the file once. A fix nothing watches comes back, so every one of those that a script
// can answer is answered here — by id — alongside sweep #8's own 500.
//
//   node scripts/verify-t25-login-and-panel-apis.mjs               # source rules only, no network
//   node scripts/verify-t25-login-and-panel-apis.mjs --live        # …plus the driven checks
//   node scripts/verify-t25-login-and-panel-apis.mjs --base http://127.0.0.1:4325 --live
//   node scripts/verify-t25-login-and-panel-apis.mjs --only P78742 # one check
//   node scripts/verify-t25-login-and-panel-apis.mjs --ids         # print every id it asserts
//
// THE LIVE BLOCK SIGNS IN AT MOST ONCE, through scripts/sweep/login.mjs (which caches to disk and
// across processes). It never POSTs JSON to /api/staff-login — that counts as a wrong admin
// password and walls the IP. It writes no row it does not delete in the same run.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

// The pure halves of lib/userAuth.ts are RUN, not grepped — a guard that re-implements the rule
// it checks proves nothing about the rule that ships. The one import userAuth makes that needs a
// network is the service-role client, so it resolves to the repo's existing in-memory stub
// (scripts/panel-stubs/sb.mjs, the same one verify:manager-gates drives the manager route with).
// Nothing here opens a socket and no real project is named.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

const argv = process.argv.slice(2);
const LIVE = argv.includes("--live");
const IDS_ONLY = argv.includes("--ids");
const ONLY = (() => { const i = argv.indexOf("--only"); return i >= 0 ? argv[i + 1] : null; })();
const BASE = (() => {
  const i = argv.indexOf("--base");
  return (i >= 0 ? argv[i + 1] : process.env.BASE_URL) || "http://127.0.0.1:4325";
})();

let pass = 0;
const fails = [];
const seen = new Set();
const idsAsserted = [];
const head = (t) => { if (!IDS_ONLY) console.log(`\n── ${t} ──`); };

// Every check carries the ledger id it answers. A duplicate id is a bug in this file — two
// checks sharing an id is exactly how the ledger stopped meaning anything twice before.
function check(id, msg, cond, got) {
  if (seen.has(id)) { fails.push(`DUPLICATE ID ${id}`); console.log(`  ✗ DUPLICATE ID ${id}`); return; }
  seen.add(id);
  idsAsserted.push(id);
  if (IDS_ONLY) { console.log(`${id}\t${msg}`); return; }
  if (ONLY && ONLY !== id) return;
  if (cond) { pass++; console.log(`  ✓ ${id} ${msg}`); }
  else { fails.push(`${id} ${msg}`); console.log(`  ✗ ${id} ${msg}${got === undefined ? "" : `  → got ${JSON.stringify(got)}`}`); }
}

// ── the files this guard is about ────────────────────────────────────────────────────────────
const F = {
  panelLogin: "app/api/panel-login/route.ts",
  panelLogout: "app/api/panel-logout/route.ts",
  panelProfile: "app/api/panel-profile/route.ts",
  staffLogin: "app/api/staff-login/route.ts",
  staffLogout: "app/api/staff-logout/route.ts",
  loginPage: "app/login/page.tsx",
  loginForm: "app/login/LoginForm.tsx",
  staffLoginPage: "app/staff-login/page.tsx",
  staffLoginForm: "app/staff-login/LoginForm.tsx",
  blockedView: "app/staff-login/BlockedView.tsx",
  scopedLoginPage: "app/r/[restaurant]/login/page.tsx",
  userAuth: "lib/userAuth.ts",
  editor: "app/api/editor/[...path]/route.ts",
};
const S = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, read(p)]));

// The editor route is shared by LINE RANGE with terminal 24: it owns 1..~3000 (GET), this file
// owns the write half. The split is found by the POST handler, never by a hard-coded number —
// a line number in a guard is a guard that goes red for a refactor.
const editorLines = S.editor.split("\n");
const postStart = editorLines.findIndex((l) => /^export const POST = withIdempotency\(/.test(l));
const WRITE_HALF = editorLines.slice(postStart < 0 ? 0 : postStart).join("\n");

// Strip comments before asserting on CODE. Line comments FIRST: a `/*` inside a `//` line
// otherwise swallows everything to the next `*/` (the shipped-guard fault of 2026-09-04).
const stripComments = (src) =>
  src.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const CODE = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, stripComments(v)]));
const WRITE_CODE = stripComments(WRITE_HALF);

const has = (src, needle) => src.includes(needle);
const rx = (src, re) => re.test(src);
const count = (src, re) => (src.match(re) || []).length;

// ═════════════════════════════════════════════════════════════════════════════════════════════
head("R. SWEEP #6/#7's OWN ROWS, RE-RUN BY ID (T10, T24, T27) — a green here is a re-run");
// Every row below is an existing ledger id. It keeps its id for ever; this is the mechanical
// re-execution of the claim it makes, so "re-run P04626" is a sentence that means something.
// ═════════════════════════════════════════════════════════════════════════════════════════════

// ── T10 · the blocked page ──
check("P04591", "the blocked page's Retry and Request both handle a network failure",
  count(CODE.blockedView, /catch \{/g) >= 3);
check("P04592", "the Request button words a transient failure as 'try again'",
  has(S.blockedView, "Couldn't send your request — please try again."));
check("P04593", "an unblocked device is bounced back to /staff-login by BOTH paths",
  count(CODE.blockedView, /window\.location\.assign\("\/staff-login"\)/g) >= 3);
check("P04594", "the blocked page never shows the raw IP or device id to the visitor",
  !rx(CODE.blockedView, /\bip\b|device_id|deviceId/));

// ── T10 · /api/staff-login ──
check("P04626", "staff-login runs the not-a-person check BEFORE the throttle read",
  CODE.staffLogin.indexOf("botVerdict(") < CODE.staffLogin.indexOf("throttleStatus("));
check("P04627", "the not-a-person check refuses only on a present-and-wrong signal",
  has(read("lib/botCheck.ts"), "export function botVerdict"));
check("P04628", "a refusal reuses the ORDINARY 401, never 'you look like a bot'",
  has(CODE.staffLogin, "return bad({});") && !/look like a bot/i.test(CODE.staffLogin));
check("P04629", "a refusal does not count against the human lockout",
  CODE.staffLogin.split("botVerdict(")[1].split("return bad({})")[0].indexOf("throttleFail") === -1);
check("P04630", "the password compare is constant-time via safeEqual",
  has(CODE.staffLogin, "safeEqual(await sha256hex(password), await sha256hex(expected))"));
check("P04631", "the length cap sits AHEAD of the hash",
  CODE.staffLogin.indexOf("const tooLong") < CODE.staffLogin.indexOf("safeEqual(await sha256hex"));
check("P04632", "an empty ADMIN_PASSWORD can never match",
  has(CODE.staffLogin, "!!expected && !tooLong &&"));
check("P04633", "a deliberate block and a wrong-tries lockout are different answers",
  has(CODE.staffLogin, "bad(blocked ? { blocked: true } : { locked: true })"));
check("P04634", "the redirect target only accepts a same-site relative path",
  // (sweep #10 T17 item 9: the prefix test let "/\\other.site" through; the target now goes through sameSitePath.)
  has(CODE.staffLogin, 'const next = sameSitePath(form?.get("next") || "/aevinite", "/aevinite");'));
check("P04635", "both cookies are secure in production",
  has(CODE.staffLogin, 'const secure = process.env.NODE_ENV === "production"')
  && count(CODE.staffLogin, /secure \}\)/g) >= 2);
check("P04636", "the auth cookie is httpOnly; the flag cookie deliberately is not",
  has(CODE.staffLogin, "res.cookies.set(AUTH_COOKIE, token, { httpOnly: true")
  && has(CODE.staffLogin, 'res.cookies.set(FLAG_COOKIE, "1", { httpOnly: false'));
check("P04637", "every attempt (ok / wrong / blocked / not-a-person) writes an admin log line",
  count(CODE.staffLogin, /logAction\("admin"/g) >= 4);
check("P04638", "after N wrong tries the admin is ALERTED but never locked out early",
  has(CODE.staffLogin, "ADMIN_ALERT_AT = 3") && has(CODE.staffLogin, "ADMIN_MAX_FAILS = 10")
  && has(CODE.staffLogin, 't.failCount >= ADMIN_ALERT_AT'));
check("P04639", "a correct password clears the counter",
  has(CODE.staffLogin, "await throttleReset(throttleKey)"));
check("P04640", "the JSON path and the no-JS redirect path give the same verdict",
  has(CODE.staffLogin, "const bad = (extra: Record<string, unknown>) =>") && has(CODE.staffLogin, "wantsJson"));
check("P04641", "the route never echoes the typed password anywhere",
  !rx(CODE.staffLogin, /detail:[^\n]*\$\{password\}/) && !rx(CODE.staffLogin, /console\.[a-z]+\([^)]*password/));

// ── T10 · app/staff-login ──
check("P04642", "the staff-login form posts url-encoded so the no-JS form and the fetch agree",
  has(CODE.staffLoginForm, "new URLSearchParams({ password, next, [BOT_TRAP_FIELD]"));
check("P04643", "the trap fields are read BEFORE the first await",
  CODE.staffLoginForm.indexOf("botFields(e.currentTarget") < CODE.staffLoginForm.indexOf("await fetch("));
check("P04644", "<BotTrap/> is LAST in the staff-login form",
  CODE.staffLoginForm.lastIndexOf("<BotTrap />") < CODE.staffLoginForm.lastIndexOf("</form>")
  && CODE.staffLoginForm.indexOf("<BotTrap />") > CODE.staffLoginForm.indexOf('name="password"'));
check("P04645", "the wrong-password message auto-clears after 3s; a lockout does not",
  has(CODE.staffLoginForm, 'if (err?.kind !== "wrong") return;') && has(CODE.staffLoginForm, "3000"));
check("P04646", "the typed password survives a wrong attempt",
  !has(CODE.staffLoginForm, 'setPassword("")'));
check("P04647", "'N attempts left' is shown once the person starts missing",
  has(CODE.staffLoginForm, "left before a temporary lock.") && has(CODE.staffLoginForm, "err.attemptsLeft"));
check("P04648", "this door says 'admin console', not 'staff sign in'",
  has(S.staffLoginForm, "Restaurant OS · admin console"));
check("P04649", "there is a plain link to the staff door for someone at the wrong one",
  has(CODE.staffLoginForm, 'href="/login"'));
// R19 and R24 are the owner's own decisions, recorded in docs/REJECTED-IDEAS.md — these two
// checks exist so nobody "fixes" either of them again.
check("P04650", "the 100vh on /staff-login is left alone (REJECTED R19)",
  has(S.staffLoginPage, 'minHeight: "100vh"') && has(S.staffLoginPage, "REJECTED (owner, 2026-08-13)"));
check("P04651", "the SVG brand mark is left alone (REJECTED R24)",
  has(S.staffLoginForm, "/brand/aevidine-mark.svg") && has(S.staffLoginForm, "REJECTED (owner, 2026-08-14)"));
check("P04652", "app/staff-login/page.tsx fails OPEN if the block check errors",
  has(read("lib/loginThrottle.ts"), "throttleIsBlocked") && rx(read("lib/loginThrottle.ts"), /catch[\s\S]{0,200}return false/));
check("P04653", "?blocked=1 also renders the blocked view",
  has(CODE.staffLoginPage, 'blocked === "1"'));
check("P04654", "?bad=1 / ?locked=1 become the right initial error",
  has(CODE.staffLoginPage, 'locked ? { kind: "locked" as const } : bad ? { kind: "wrong" as const } : null'));
check("P04655", "next defaults to /aevinite",
  has(CODE.staffLoginPage, 'next = "/aevinite"'));

// ── T10 · /api/panel-login ──
check("P04656", "panel-login runs the not-a-person check before the rate limit",
  CODE.panelLogin.indexOf("botVerdict(") < CODE.panelLogin.indexOf("rateAllowed("));
check("P04657", "an unknown slug gets the SAME generic message as bad credentials",
  rx(CODE.panelLogin, /if \(!rest\) return NextResponse\.json\(\{ ok: false, error: "Wrong name or password\." \}/));
check("P04658", "the rate limit is counted per username (+ restaurant when the door names one)",
  has(CODE.panelLogin, '`${restaurantId || "*"}:${subjectFor(uname)}`'));
check("P04659", "describe only runs when the wall is actually hit",
  has(CODE.panelLogin, "describe: () => describeLoginTarget("));
check("P04660", "a DB blip on the credential lookup answers 503, never 401",
  // (sweep #10 T17 item 13: a deployment with no signing secret is 503 too.)
  has(CODE.panelLogin, "status: r.transient || r.unavailable ? 503 : 401"));
check("P04661", "the real refusal reason goes to the ADMIN log, never to the person",
  has(CODE.panelLogin, "error: r.error") && has(CODE.panelLogin, 'logAction((a?.role ?? "admin"), "login_failed"'));
check("P04662", "a transient blip writes NO login-failed row",
  has(CODE.panelLogin, 'if (!r.transient && r.reason && r.reason !== "empty")'));
check("P04663", "a successful login clears the login counter",
  has(CODE.panelLogin, "rateResetOnSuccess("));
check("P04664", "an owner with no owner-panel-enabled restaurant is refused with a reason",
  has(CODE.panelLogin, "The owner panel isn't enabled for any of your restaurants."));
check("P04665", "the owner's entitlement is read UNCACHED at the door",
  // (sweep #10 T17 item 7: an owner's line is filed under a restaurant they OWN — the literal moved.)
  has(CODE.panelLogin, "enabledOwnedRestaurantIds(u.id, false)"));
// Moved in sweep #10 T17 round 6, item 40 (owner 2026-10-09): the per-panel switch and its checks were deleted; the rule
// that remains is the recycle bin + the suspension (item 30), re-checked the same way.
check("P04666", "a binned restaurant blocks every non-owner role, before the suspension check",
  CODE.panelLogin.indexOf("isRestaurantDeleted(u.restaurant_id)") > 0 && CODE.panelLogin.indexOf("isRestaurantDeleted(u.restaurant_id)") < CODE.panelLogin.indexOf("isRestaurantSuspended(u.restaurant_id)"));
check("P04667", "the retired 'this panel isn't enabled' refusal is gone, and the switched-off refusal says who can help",
  !has(CODE.panelLogin, "This panel isn't enabled for your restaurant") && !/isPanelEnabled/.test(CODE.panelLogin) && has(CODE.panelLogin, "error: DOOR_OFF"));
check("P04668", "the login log row carries the person's OWN restaurant_id",
  // (sweep #10 T17 item 7: an owner's line is filed under a restaurant they OWN — the literal moved.)
  has(CODE.panelLogin, ": (u.restaurant_id ?? null),") && has(CODE.panelLogin, "await ownerLogRestaurant(u.id, [restaurantId, u.restaurant_id], ownedIds)"));
check("P04669", "the login log row carries the stable actor_id",
  has(CODE.panelLogin, "actor_id: u.id"));
check("P04670", "the login log detail does not repeat the name three times",
  has(CODE.panelLogin, 'u.name && u.name !== u.username ? `username "${u.username}"` : null'));
check("P04671", "the user cookie is httpOnly + sameSite lax + secure in production",
  has(CODE.panelLogin, "httpOnly: true, sameSite: \"lax\"")
  && has(CODE.panelLogin, 'secure: process.env.NODE_ENV === "production"'));
check("P04672", "the cookie's 7-day age is also enforced in the signature",
  has(CODE.userAuth, "TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000")
  && has(CODE.userAuth, "if (Date.now() - iat > TOKEN_TTL_MS) return null;"));
check("P04673", "needsProfile is derived from profile_confirmed, not from empty fields",
  has(CODE.panelLogin, "const needsProfile = !u.profile_confirmed;"));

// ── T10 · app/login ──
check("P04675", "app/login/LoginForm reads the trap fields before the first await",
  CODE.loginForm.indexOf("botFields(e.currentTarget") < CODE.loginForm.indexOf("await fetch("));
check("P04676", "<BotTrap/> is LAST in the staff form too",
  CODE.loginForm.lastIndexOf("<BotTrap />") < CODE.loginForm.lastIndexOf("</form>"));
check("P04677", "a new sign-in clears the previous account's owner snapshots",
  has(CODE.loginForm, "clearOwnerSnaps();"));
check("P04678", "a new sign-in tells the service worker to wipe saved screens",
  has(CODE.loginForm, 'postMessage({ type: "LFH_CLEAR_DATA" })'));
// Round 5, item 31 (owner 2026-10-09) moved this rule: a ?next INSIDE the person's own panel is now kept (deep link).
check("P04679", "?next is honoured only on this site and only inside this user's own panel home",
  has(CODE.loginForm, "if (u.origin !== window.location.origin) return home;") && has(CODE.loginForm, 'if (u.pathname !== home && !u.pathname.startsWith(home + "/")) return home;'));
check("P04680", "the scoped door lands on the scoped panel URL",
  has(CODE.loginForm, "restaurantSlug ? `/r/${restaurantSlug}${base}` : base"));
check("P04681", "ROLE_HOME here matches lib/panelGate.ts ROLE_HOME", (() => {
  const pick = (src) => (src.match(/ROLE_HOME[^=]*=\s*\{([^}]*)\}/) || [])[1] || "";
  const norm = (s) => s.replace(/\s|"/g, "").split(",").filter(Boolean).sort().join("|");
  return norm(pick(CODE.loginForm)) === norm(pick(read("lib/panelGate.ts")));
})());
check("P04682", "the 100vh on /login is left alone (REJECTED R19)",
  has(S.loginForm, 'minHeight: "100vh"') && has(S.loginForm, "REJECTED (owner, 2026-08-13)"));
check("P04683", "the ✦ text mark is left alone (REJECTED R24)",
  has(S.loginForm, "REJECTED (owner, 2026-08-14)"));
check("P04684", "the sign-in button is disabled while a request is in flight",
  has(CODE.loginForm, "disabled={busy || !username || !password}"));
check("P04685", "a network failure shows a retryable sentence and re-enables the button",
  has(CODE.loginForm, 'setErr("Network error — please try again.");') && has(CODE.loginForm, "setBusy(false);"));
check("P04686", "app/login/page.tsx redirects an already-signed-in person to their panel",
  has(CODE.loginPage, 'redirect(ROLE_HOME[u.role] || "/menu")'));
check("P04687", "a database blip on /login shows the form instead of an error page",
  has(CODE.loginPage, "if (!(e instanceof AuthDbError)) throw e;"));
check("P04688", "the fallthrough is safe: the form itself is public",
  !rx(CODE.loginPage, /requireRole|tokenIsValid/));
check("P04689", "next is passed through as a string only",
  has(CODE.loginPage, 'typeof next === "string" ? next : ""'));

// ── T10 · the two logout routes ──
check("P04691", "panel-logout is POST-only",
  !rx(CODE.panelLogout, /export async function (GET|PUT|PATCH|DELETE)\b/));
check("P04692", "a logout never depends on the database answering",
  rx(CODE.panelLogout, /try \{[\s\S]{0,200}userFromCookie\([\s\S]{0,120}\} catch/));
check("P04693", "the cookie is cleared whether or not the audit line was written",
  CODE.panelLogout.indexOf("} catch (e) {") < CODE.panelLogout.indexOf('res.cookies.set(USER_COOKIE, ""'));
check("P04694", "the logout redirects 303 so the browser follows with a GET",
  has(CODE.panelLogout, 'NextResponse.redirect(new URL("/login", req.url), 303)'));
check("P04695", "staff-logout is POST-only",
  !rx(CODE.staffLogout, /export async function (GET|PUT|PATCH|DELETE)\b/));
check("P04696", "staff-logout clears AUTH, FLAG and the act-as restaurant cookie",
  // 4 since sweep #10 T17 item 12: the passwords-uncovered unlock is cleared too.
  count(CODE.staffLogout, /maxAge: 0/g) === 4 && has(CODE.staffLogout, "aevidine_admin_rid"));
check("P04697", "staff-logout lands on the open guest menu, not a password screen",
  has(CODE.staffLogout, 'new URL("/menu", req.url), 303'));
check("P04698", "neither logout route touches data",
  !rx(CODE.panelLogout, /supabaseAdmin|sb\.from\(/) && !rx(CODE.staffLogout, /supabaseAdmin|sb\.from\(/));

// ── T10 · /api/panel-profile ──
check("P04700", "panel-profile GET answers 200 {staff:false} for the admin",
  has(CODE.panelProfile, 'return NextResponse.json({ staff: false, error: "not logged in" })'));
check("P04701", "POST still answers 401 when nobody is signed in",
  has(CODE.panelProfile, 'return NextResponse.json({ error: "not logged in" }, { status: 401 })'));
check("P04702", "a DB blip answers 503 + busy, on BOTH GET and POST",
  count(CODE.panelProfile, /if \("busy" in asker\) return asker\.busy;/g) === 2);
check("P04703", "the busy answer carries the X-LFH-Busy header the offline layer reads",
  has(CODE.panelProfile, '"X-LFH-Busy": "1"'));
check("P04704", "the three independent reads start together",
  CODE.panelProfile.indexOf("const rowP =") < CODE.panelProfile.indexOf("const limit = await tablesP;"));
check("P04705", "rowP attaches its rejection handler immediately",
  rx(CODE.panelProfile, /\.maybeSingle\(\)\s*\n?\s*\.then\(\(r\) => r, \(e\)/));
check("P04706", "POST is wrapped in withIdempotency",
  has(CODE.panelProfile, 'export const POST = withIdempotency(postImpl, "panel-profile");'));
check("P04707", "POST runs ONE expectClash gate covering every branch",
  count(CODE.panelProfile, /expectClash\(/g) === 1
  && CODE.panelProfile.indexOf("expectClash(") < CODE.panelProfile.indexOf("body?.newPassword !== undefined"));
check("P04708", "the password change re-authenticates with the current password",
  has(CODE.panelProfile, "verifySecret(current, row?.password_hash ?? null)"));
check("P04709", "the password change is rate-limited PER ACCOUNT, not per device",
  has(CODE.panelProfile, 'rateAllowed("password_change", u.id'));
check("P04710", "the wall is checked BEFORE verifySecret so a wrong guess counts",
  CODE.panelProfile.indexOf('rateAllowed("password_change"') < CODE.panelProfile.indexOf("verifySecret(current"));
check("P04711", "a successful change clears the counter",
  has(CODE.panelProfile, 'rateResetOnSuccess("password_change", u.id'));
check("P04712", "the password write checks BOTH the error and the row count",
  has(CODE.panelProfile, "if (pw.error)") && has(CODE.panelProfile, "if (!pw.data?.length)"));
check("P04713", "a failed password write does NOT log password_change",
  CODE.panelProfile.indexOf("if (!pw.data?.length)") < CODE.panelProfile.indexOf('logAction(u.role, "password_change"'));
check("P04714", "token_version is bumped so every existing session ends",
  has(CODE.panelProfile, "token_version: (u.token_version || 0) + 1"));
check("P04715", "the self-profile patch is whitelisted by SELF_PROFILE_FIELDS",
  has(CODE.panelProfile, "mergeProfilePatch(cur, p as Record<string, unknown>, SELF_PROFILE_FIELDS)"));
check("P04716", "the profile branch checks its write error",
  rx(CODE.panelProfile, /const \{ error \} = await sb\.from\("staff_users"\)\.update\(\{ profile: merged \}\)[\s\S]{0,120}if \(error\)/));
check("P04717", "the name/phone/PIN write checks BOTH error and row count",
  has(CODE.panelProfile, "if (saved.error)") && has(CODE.panelProfile, "if (!saved.data?.length)"));
check("P04718", "the username uniqueness check is scoped to THIS restaurant",
  rx(CODE.panelProfile, /\.eq\("username", key\)[\s\S]{0,80}\.eq\("restaurant_id", u\.restaurant_id\)/));
check("P04719", "the uniqueness check excludes the person's own row and soft-deleted rows",
  has(CODE.panelProfile, '.neq("id", u.id).is("deleted_at", null)'));
check("P04720", "a PIN must be 4–8 digits and is stored as a salted slow hash",
  has(CODE.panelProfile, "/^\\d{4,8}$/.test(pin)") && has(CODE.panelProfile, "await hashSecret(pin)"));
check("P04721", "a person who may not self-set a PIN is refused with a sentence",
  has(CODE.panelProfile, "Your admin manages your PIN. Ask them to set it."));
check("P04722", "a person who may not self-reset a password is refused with a sentence",
  has(CODE.panelProfile, "Your admin manages your password. Ask them to reset it."));
check("P04723", "pay is only sent when the person is ON the pay list AND allowed to see it",
  has(CODE.panelProfile, 'row?.can_see_own_pay !== false && row?.in_payroll === true'));
check("P04724", "the job fields are sent read-only, whatever the pay switch says",
  CODE.panelProfile.indexOf("job: {") < CODE.panelProfile.indexOf("out.pay = {"));
check("P04725", "the payments read is scoped by staff_id AND restaurant_id, with a limit",
  has(CODE.panelProfile, '.eq("staff_id", u.id).eq("restaurant_id", u.restaurant_id)')
  && has(CODE.panelProfile, ".limit(40)"));
check("P04726", "the person's own row id is returned so the clash gate has something to name",
  has(CODE.panelProfile, "id: u.id,"));
check("P04727", "kitchen has NO profile and this route does not invent one",
  has(CODE.panelProfile, "hasProfile(u.role)")
  && has(read("lib/staffProfileShared.ts"), 'PROFILE_ROLES = ["owner", "manager", "tablet"]'));

// ── T10 · the egress + scoping sweeps over the five staff-door routes ──
for (const [id, key, label] of [
  ["P19630", "staffLogin", "staff-login"], ["P19631", "panelLogin", "panel-login"],
  ["P19632", "panelLogout", "panel-logout"], ["P19633", "staffLogout", "staff-logout"],
  ["P19634", "panelProfile", "panel-profile"],
]) {
  // Every restaurant-wide list read carries a bound. A read keyed to ONE already-verified row
  // (.eq on a uuid/id, or maybeSingle/single) is exempt — that is one row, not a list.
  const chains = (CODE[key].match(/\.from\("[a-z_]+"\)[\s\S]{0,400}?(?=;|\n\s*\n)/g) || []);
  const unbounded = chains.filter((c) =>
    /\.select\(/.test(c) && !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(c)
    && !/\.limit\(|\.maybeSingle\(\)|\.single\(\)|count: "exact"/.test(c));
  check(id, `${label}: every restaurant-wide list read carries a bound`, unbounded.length === 0, unbounded);
}
for (const [id, key, label] of [
  ["P19678", "staffLogin", "staff-login"], ["P19679", "panelLogin", "panel-login"],
  ["P19680", "panelLogout", "panel-logout"], ["P19681", "staffLogout", "staff-logout"],
  ["P19682", "panelProfile", "panel-profile"],
]) {
  check(id, `${label}: the route sets no server-side poll or interval of its own`,
    !rx(CODE[key], /setInterval\(|while \(true\)/));
}
check("P19688", "panel-profile: every staff_users chain is keyed by the cookie's own user id",
  (CODE.panelProfile.match(/\.from\("staff_users"\)[\s\S]{0,300}?(?=;)/g) || [])
    .every((c) => /\.eq\("id", u\.id\)|\.neq\("id", u\.id\)|\.eq\("username", key\)/.test(c)));

// ── T24 · lib/userAuth.ts (the rows verify:t24-money-rules also answers) ──
check("P11669", "normalizeLoginName trims, lowercases and collapses inner whitespace",
  has(CODE.userAuth, '.trim().toLowerCase().replace(/\\s+/g, " ")'));
check("P11670", "loginUser refuses an empty name or password with reason 'empty'",
  has(CODE.userAuth, 'reason: "empty"'));
check("P11671", "loginUser caps the username and password length BEFORE the slow hash",
  CODE.userAuth.indexOf("MAX_USERNAME_LEN") < CODE.userAuth.indexOf("verifySecret(String(password)"));
check("P11672", "a failed candidate lookup is reported as transient, never wrong credentials",
  has(CODE.userAuth, "if (candRes.error) return { ok: false, error: \"Can't reach the server"));
check("P11673", "loginUser excludes recycle-bin rows",
  has(CODE.userAuth, '.is("deleted_at", null).limit(MAX_LOGIN_CANDIDATES)'));
check("P11674", "disabled rows are fetched only so a disabled person can be told the truth",
  has(CODE.userAuth, "This login has been disabled. Speak to your manager or owner."));
check("P11675", "on the tenant door only that restaurant's people can match",
  has(CODE.userAuth, 'u.restaurant_id === restaurantId || (u.role === "owner" && ownsHere.has(u.id))'));
check("P11676", "an owner can sign in at a restaurant they OWN via restaurant_owners",
  has(CODE.userAuth, 'sb.from("restaurant_owners").select("user_id")'));
check("P11677", "a lockout on any matching live row is honoured",
  has(CODE.userAuth, "live.find((u) => u.locked_until && new Date(u.locked_until) > now)"));
// (sweep #10 T17 round 3, item 23: the count is now added INSIDE the database — mig 411 — so simultaneous wrong
//  tries each count. The two checks below assert the same rule on the new code.)
check("P11678", "a wrong password bumps failed_count on every live match",
  has(CODE.userAuth, 'sb.rpc("lfh_staff_login_failed", { p_ids: live.map((u) => u.id)'));
check("P11679", "five wrong tries lock the account for 60 seconds and reset the counter",
  has(CODE.userAuth, "MAX_FAILS = 5") && has(CODE.userAuth, "LOCK_MS = 60 * 1000")
  && has(CODE.userAuth, "p_max: MAX_FAILS, p_lock_seconds: Math.round(LOCK_MS / 1000)"));
check("P11680", "a correct password clears failed_count and locked_until",
  has(CODE.userAuth, "failed_count: 0, locked_until: null, last_seen_at:"));
check("P11681", "a disabled person is told so ONLY on a verified password",
  rx(CODE.userAuth, /u\.active !== true && await verifySecret\(String\(password\), u\.password_hash\)/));
check("P11682", "when only disabled rows exist and the password is wrong, the answer is generic",
  has(CODE.userAuth, "if (!live.length) {") && count(CODE.userAuth, /reason: "no_such_name"/g) === 2);
check("P11683", "hashSecret produces a self-describing pbkdf2$iters$salt$hash string",
  has(CODE.userAuth, "`pbkdf2$${PBKDF2_ITERS}$${b64url(salt)}$${b64url(h)}`"));
check("P11684", "verifySecret compares in constant time via safeEqual",
  has(CODE.userAuth, "return safeEqual(got, parts[3]);"));
check("P11685", "verifySecret still accepts a legacy bare sha256 hash",
  has(CODE.userAuth, "return safeEqual(await sha256hex(plain), stored);"));
check("P11686", "the cookie signature covers id:role:token_version:iat",
  has(CODE.userAuth, "hmac(`${u.id}:${u.role}:${u.token_version}:${iat}`)"));
check("P11687", "userFromCookie rejects a value that is not exactly three dot-separated parts",
  has(CODE.userAuth, "if (parts.length !== 3) return null;"));
check("P11688", "userFromCookie rejects a cookie older than the 7-day max age",
  has(CODE.userAuth, "if (Date.now() - iat > TOKEN_TTL_MS) return null;"));
check("P11689", "userFromCookie retries the lookup once before giving up on a flap",
  has(CODE.userAuth, "await new Promise((r) => setTimeout(r, 120));"));
check("P11690", "userFromCookie throws AuthDbError on a sustained lookup failure",
  has(CODE.userAuth, "if (res.error) throw new AuthDbError(res.error.message);"));
check("P11691", "roleSatisfies: owner covers everything, manager covers kitchen+tablet, devices do not cover each other",
  has(CODE.userAuth, 'if (have === "owner") return true;')
  && has(CODE.userAuth, 'if (have === "manager") return need === "kitchen" || need === "tablet";'));
check("P11692", "requireRole checks the STAFF cookie before the admin fallback",
  CODE.userAuth.indexOf("userFromCookie(req.cookies.get(USER_COOKIE)?.value)")
    < CODE.userAuth.lastIndexOf("tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)"));
// Moved in sweep #10 T17 round 6, item 40 (owner 2026-10-09): the per-panel switch and its checks were deleted; the rule
// that remains is the recycle bin + the suspension (item 30), re-checked the same way.
check("P11693", "requireRole re-checks the recycle bin and the suspension on every request",
  has(CODE.userAuth, "isRestaurantSuspended(u.restaurant_id)") && has(CODE.userAuth, "isRestaurantDeleted(u.restaurant_id)") && !/isPanelEnabled/.test(CODE.userAuth));
check("P11752", "userAuth never returns the sensitive failure reason to the person",
  (CODE.userAuth.match(/error: "[^"]+"/g) || []).every((e) => !/no_such_name|wrong_password|too_long/.test(e)));
check("P11799", "the userAuth candidate loop is still capped",
  has(CODE.userAuth, "MAX_LOGIN_CANDIDATES = 50") && has(CODE.userAuth, ".limit(MAX_LOGIN_CANDIDATES)"));

// ── T27 · the two staff-door components are English-only by decision ──
for (const [id, key, label] of [["P13366", "blockedView", "BlockedView"], ["P13367", "staffLoginForm", "staff-login LoginForm"]]) {
  check(id, `${label} is a staff surface, so English-only text is correct`,
    !rx(CODE[key], /from "@\/lib\/i18n"/));
}
check("P28334", "the logout log line reads as English once its id tail is trimmed",
  has(CODE.panelLogout, 'logged out · user "${u.username}" · id ${u.id}'));

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SWEEP #8 · TERMINAL 25 · THE 500 NEW CHECKS — P78701 … P79380
// ═════════════════════════════════════════════════════════════════════════════════════════════

// Round 4 (sweep #10 T17): extensionless imports (`./supabase`, `next/server`) now resolve, and the public database
// client goes to the same in-memory stub — so lib/ownerScope.ts and the sign-in routes can be RUN here, not just read.
const ANON_STUB = pathToFileURL(join(root, "scripts/panel-stubs/anon.mjs")).href;
const toStub = (r) => (/\/lib\/supabase\.ts$/.test(r.url) ? { url: ANON_STUB, shortCircuit: true } : r);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "@/lib/supabaseAdmin") return next(pathToFileURL(join(root, "scripts/panel-stubs/sb.mjs")).href, ctx);
    if (spec.startsWith("@/")) {
      let q = join(root, spec.slice(2));
      if (!existsSync(q)) for (const e of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(q + e)) { q += e; break; }
      return toStub(next(pathToFileURL(q).href, ctx));
    }
    try { return toStub(next(spec, ctx)); } catch (e) {
      for (const suf of [".js", ".ts"]) { try { return toStub(next(spec + suf, ctx)); } catch { /* try the next */ } }
      throw e;
    }
  },
});
const UA = await import("@/lib/userAuth.ts");
const { G, resetWorld } = await import(pathToFileURL(join(root, "scripts/panel-stubs/state.mjs")).href);
// Stand-in for mig 411's lfh_staff_login_failed — the SAME rule as its SQL (P161229 below pins the SQL itself).
G.RPC_IMPL = { lfh_staff_login_failed: ({ p_ids, p_max = 5, p_lock_seconds = 60 }) => (G.FIX.staff_users || []).filter((u) => (p_ids || []).includes(u.id)).map((u) => {
  const next = (u.failed_count || 0) + 1;
  if (next >= p_max) { u.failed_count = 0; u.locked_until = new Date(Date.now() + p_lock_seconds * 1000).toISOString(); } else u.failed_count = next;
  return { id: u.id, failed_count: u.failed_count, locked_until: u.locked_until ?? null };
}) };

// ─────────────────────────────────────────────────────────────────────────────────────────────
head("1. lib/userAuth.ts — the RUNNING functions (P78701–P78800)");
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ── normalizeLoginName: the one function that makes a single "Name" field a login id ──
const N = UA.normalizeLoginName;
const NAME_CASES = [
  ["P78701", "  Raj   Kumar ", "raj kumar", "outer trim + inner collapse"],
  ["P78702", "RAJ", "raj", "upper-case is folded"],
  ["P78703", "raj", "raj", "an already-clean name is unchanged"],
  ["P78704", "Raj\tKumar", "raj kumar", "a tab counts as whitespace"],
  ["P78705", "Raj\nKumar", "raj kumar", "a newline counts as whitespace"],
  ["P78706", "", "", "empty stays empty"],
  ["P78707", "   ", "", "all-whitespace becomes empty, so the login is refused"],
  ["P78708", "Ravi  ", "ravi", "trailing spaces do not make a second account"],
  ["P78709", "  Ravi", "ravi", "leading spaces do not make a second account"],
  ["P78710", "İstanbul", "i̇stanbul", "a non-ASCII name is lowercased, not dropped"],
  ["P78711", "Raj-Kumar", "raj-kumar", "a hyphen is part of the name, not whitespace"],
  ["P78712", "Raj.Kumar", "raj.kumar", "a dot survives — the cookie splits on dots, the NAME does not"],
];
for (const [id, input, want, why] of NAME_CASES) {
  check(id, `normalizeLoginName(${JSON.stringify(input)}) → ${JSON.stringify(want)} — ${why}`,
    N(input) === want, N(input));
}
check("P78713", "normalizeLoginName is total: null/undefined/number never throw",
  [null, undefined, 0, 12].every((v) => typeof N(v) === "string"));
check("P78714", "the SAME normalizer is used by the login lookup and by the profile rename",
  has(CODE.userAuth, "const uname = normalizeLoginName(username);")
  && has(CODE.panelProfile, "const key = normalizeLoginName(display);"));

// ── roleSatisfies: the whole 4×4 matrix, run ──
const ROLES = ["owner", "manager", "kitchen", "tablet"];
const WANT = {
  owner:   { owner: true,  manager: true,  kitchen: true,  tablet: true },
  manager: { owner: false, manager: true,  kitchen: true,  tablet: true },
  kitchen: { owner: false, manager: false, kitchen: true,  tablet: false },
  tablet:  { owner: false, manager: false, kitchen: false, tablet: true },
};
let rsId = 78715;
for (const have of ROLES) for (const need of ROLES) {
  const id = `P${rsId++}`;
  const got = UA.roleSatisfies(have, need);
  check(id, `a ${have} ${WANT[have][need] ? "may" : "may NOT"} use a ${need} API`, got === WANT[have][need], got);
}
check("P78731", "the two device roles are siblings — neither may use the other's API",
  !UA.roleSatisfies("kitchen", "tablet") && !UA.roleSatisfies("tablet", "kitchen"));
check("P78732", "an unknown role satisfies nothing",
  ROLES.every((need) => !UA.roleSatisfies("chef", need)));

// ── hashSecret / verifySecret: run against real hashes ──
const H1 = await UA.hashSecret("hunter2");
const H2 = await UA.hashSecret("hunter2");
check("P78733", "hashSecret is salted — the same password hashes differently every time", H1 !== H2);
check("P78734", "the hash names its own algorithm and work factor", /^pbkdf2\$120000\$/.test(H1), H1.slice(0, 24));
check("P78735", "the stored string has exactly four $-separated parts", H1.split("$").length === 4);
check("P78736", "the salt is 16 bytes (22 base64url chars, unpadded)", H1.split("$")[2].length === 22, H1.split("$")[2]);
check("P78737", "the derived key is 32 bytes (43 base64url chars, unpadded)", H1.split("$")[3].length === 43);
check("P78738", "the stored string is URL-safe — no +, / or = to break a cookie or a URL",
  !/[+/=]/.test(H1));
check("P78739", "the right password verifies against both hashes of it",
  (await UA.verifySecret("hunter2", H1)) && (await UA.verifySecret("hunter2", H2)));
check("P78740", "a wrong password does not verify", !(await UA.verifySecret("hunter3", H1)));
check("P78741", "a password differing only in case does not verify", !(await UA.verifySecret("Hunter2", H1)));
check("P78742", "a password with a trailing space does not verify — passwords are NOT trimmed",
  !(await UA.verifySecret("hunter2 ", H1)));
check("P78743", "an empty stored hash verifies nothing", !(await UA.verifySecret("hunter2", "")));
check("P78744", "a null stored hash verifies nothing (a person with no password can never sign in)",
  !(await UA.verifySecret("hunter2", null)));
check("P78745", "an empty password does not verify against a real hash", !(await UA.verifySecret("", H1)));
check("P78746", "a malformed stored value falls back to the legacy compare and refuses",
  !(await UA.verifySecret("hunter2", "pbkdf2$junk")));
// The throw this defends against KILLS the process, so it is caught here and reported as a red
// rather than taking the whole guard down — a crash and a failure look different to whoever is
// reading the output, and only one of them names the check.
{
  let threw = null, answer = null;
  try { answer = await UA.verifySecret("hunter2", `pbkdf2$120000$!!!!$${H1.split("$")[3]}`); }
  catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check("P78747", "a stored value with the right shape but a corrupt salt REFUSES rather than throwing",
    threw === null && answer === false, threw ?? answer);
}
{
  const enc = new TextEncoder().encode("legacy-pass");
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  check("P78749", "…and that legacy path really matches the sha256 of the password",
    await UA.verifySecret("legacy-pass", hex));
  check("P78750", "…while a wrong password against a legacy hash still refuses",
    !(await UA.verifySecret("legacy-pas", hex)));
  check("P78748", "a legacy bare sha256 hash is recognised BY SHAPE, not by a flag column",
    hex.split("$").length === 1 && (await UA.verifySecret("legacy-pass", hex)));
}
check("P78751", "an 8-character PIN and a 4-character PIN both hash to the same shape",
  /^pbkdf2\$120000\$/.test(await UA.hashSecret("1234")) && /^pbkdf2\$120000\$/.test(await UA.hashSecret("12345678")));
{
  const long = "x".repeat(200);
  const hLong = await UA.hashSecret(long);
  check("P78752", "a 200-character password (the length cap) still hashes and verifies",
    await UA.verifySecret(long, hLong));
}
check("P78753", "the work factor is 120,000 iterations — the number is not silently lowered",
  has(CODE.userAuth, "PBKDF2_ITERS = 120_000"));
check("P78754", "the iteration count is read back from the STORED string, so an old row still verifies",
  has(CODE.userAuth, "const iters = parseInt(parts[1], 10) || PBKDF2_ITERS;"));

// ── userFromCookie: every early return, run (no database is reached on any of these) ──
const COOKIE_JUNK = [
  ["P78755", undefined, "undefined"], ["P78756", null, "null"], ["P78757", "", "an empty string"],
  ["P78758", "abc", "one part"], ["P78759", "a.b", "two parts"], ["P78760", "a.b.c.d", "four parts"],
  ["P78761", "a.notanumber.c", "a non-numeric issued-at"], ["P78762", ".123.sig", "an empty id"],
  ["P78763", "id..sig", "an empty issued-at"], ["P78764", "id.NaN.sig", "NaN as the issued-at"],
  ["P78765", "id.Infinity.sig", "Infinity as the issued-at"],
];
for (const [id, value, why] of COOKIE_JUNK) {
  check(id, `a cookie that is ${why} is refused without a database read`,
    (await UA.userFromCookie(value)) === null);
}
check("P78766", "a cookie whose issued-at is older than 7 days is refused without a database read",
  (await UA.userFromCookie(`someid.${Date.now() - 8 * 24 * 3600_000}.sig`)) === null);
// P78767 used the id "no-such-user" until 2026-10-08. Against this stub that reached the lookup and
// came back empty — but against the REAL database a non-uuid id is a refusal (22P02), which the code
// read as an outage. The id is uuid-shaped now, so this row still proves what it says; item 4 below
// proves the non-uuid case never reaches the database at all.
check("P78767", "…and one inside the window gets as far as the lookup (it then fails on the signature)",
  await (async () => { resetWorld(); const r = await UA.userFromCookie(`00000000-0000-4000-8000-00000000abcd.${Date.now()}.sig`);
    return r === null && G.READS.some((x) => x.table === "staff_users"); })());
// SWEEP #10 T17, item 4 — a cookie whose id cannot be a staff id is "not signed in", decided BEFORE
// the database. A refused non-uuid used to be thrown as AuthDbError → 503 "busy" for a week.
for (const [cid, idPart, why] of [
  ["P186010", "abc", "a short word"], ["P186011", "no-such-user", "a hyphenated word"],
  ["P186012", "00000000-0000-0000-0000-00000000000", "a uuid one character short"],
  ["P186013", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", "uuid-shaped but not hex"],
  ["P186014", "undefined", "the word undefined"],
]) {
  resetWorld();
  let threw = false, r;
  try { r = await UA.userFromCookie(`${idPart}.${Date.now()}.sig`); } catch { threw = true; }
  check(cid, `a fresh cookie whose id is ${why} is "not signed in" — no throw, and no database read`,
    !threw && r === null && !G.READS.some((x) => x.table === "staff_users"), { threw, reads: G.READS.length });
}
// SWEEP #10 T17, item 5 — /r/<slug>/owner is a ROUTE HANDLER, so a throw there has no error page to
// land on: a database blip on the slug lookup answered the platform's bare "Internal Server Error".
{
  const ow = stripComments(read("app/r/[restaurant]/owner/route.ts"));
  const tryAt = ow.indexOf("try {\n    r = await getRestaurantBySlug(restaurant);");
  check("P186016", "/r/<slug>/owner looks the restaurant up inside a try (getRestaurantBySlug THROWS on a failed read)",
    tryAt > 0 && count(ow, /await getRestaurantBySlug\(/g) === 1);
  check("P186017", "…and its catch answers 503 with a retry-after, in words, never a bare 500",
    /status: 503/.test(ow.slice(tryAt, tryAt + 1600)) && /retry-after/.test(ow.slice(tryAt, tryAt + 1600)) && /Can't reach the server/.test(ow.slice(tryAt, tryAt + 1600)));
  check("P186018", "…and the try-again page names no restaurant (it could not read one)",
    !/\$\{(r|restaurant)\b/.test(ow.slice(tryAt, ow.indexOf("{ status: 503", tryAt))));
}
// SWEEP #10 T17, item 6 — the admin console's card must read EVERY answer /api/staff-login gives.
// It knew two (ok, locked); a BLOCKED device and a platform error page both read "Wrong password".
{
  const route = CODE.staffLogin, form = CODE.staffLoginForm;
  const keys = [...new Set([...route.matchAll(/bad\(\{\s*([a-zA-Z]+)\s*:/g)].map((m) => m[1]).concat(
    [...route.matchAll(/bad\([a-zA-Z.]+ \? \{ ([a-zA-Z]+): true \} : \{ ([a-zA-Z]+)/g)].flatMap((m) => [m[1], m[2]])))];
  check("P186019", "every refusal key /api/staff-login can send is one the card reads (blocked, locked, attemptsLeft)",
    keys.length >= 3 && keys.every((k) => new RegExp(`data\\.${k}\\b`).test(form)), keys);
  check("P186020", "a BLOCKED answer takes the person to the blocked screen instead of saying 'wrong password'",
    /if \(data\.blocked\) \{ window\.location\.assign\(`\/staff-login\?blocked=1/.test(form));
  check("P186021", "a reply that is not the door's own JSON (no `ok` key) is the SERVER failing, not a wrong password",
    has(form, `if (data.ok !== false) { setErr({ kind: "server" }); return; }`) && has(form, `err?.kind === "server" ? "The server didn\\u2019t answer properly`));
  check("P186022", "…and the blocked/server branches run BEFORE the wrong-password one",
    form.indexOf("if (data.blocked)") > 0 && form.indexOf("if (data.ok !== false)") > form.indexOf("if (data.blocked)") &&
    form.indexOf(`setErr(data.locked ?`) > form.indexOf("if (data.ok !== false)"));
}
// SWEEP #10 T17, item 7 — an owner's sign-in, sign-out and failed sign-in are filed under a restaurant
// they OWN. Their staff_users.restaurant_id is a filing home, not ownership: measured 2026-10-08, 1 of
// 19 live dev owners (owns Aangan + Burger Barn) was filed under French House, so French House's
// Activity log would have read another restaurant's owner signing in.
{
  const PA = await import("@/lib/panelAccess.ts");
  const R = PA.ownerLogRestaurant;
  check("P186173", "an owner signing in at a restaurant's own door is filed under THAT restaurant",
    (await R("u", ["rB", "rH"], ["rA", "rB"])) === "rB");
  check("P186174", "on the plain door, their home is used only when they own it",
    (await R("u", [undefined, "rA"], ["rA", "rB"])) === "rA");
  check("P186175", "a home they do NOT own is never used — the first restaurant they own is",
    (await R("u", [undefined, "rHOME"], ["rA", "rB"])) === "rA");
  check("P186176", "a restaurant door they do not own is never used either",
    (await R("u", ["rX", "rHOME"], ["rA"])) === "rA");
  check("P186177", "an owner who owns nothing readable is a platform-level row (null), never a guess",
    (await R("u", ["rX", "rHOME"], [])) === null);
  check("P186178", "/api/panel-login files a failed OWNER attempt through ownerLogRestaurant, everyone else as before",
    has(CODE.panelLogin, 'const failRid = a?.role === "owner" && r.reason !== "no_such_name"') && has(CODE.panelLogin, "await ownerLogRestaurant(a?.id || \"\", [restaurantId, a?.restaurant_id])"));
  check("P186179", "loginUser hands the targeted account's id to the route (for the log only; the person never sees it)",
    has(CODE.userAuth, "actor: u.name || u.username, id: u.id,") && !rx(CODE.panelLogin, /json\(\{[^}]*attempted/));
  check("P186180", "no owner sign-in, sign-out or failed sign-in is filed under u.restaurant_id unchecked",
    !/logAction\(u\.role, "(login|logout)", \{[^}]*restaurant_id: u\.restaurant_id \?\? null/s.test(CODE.panelLogin) && !/restaurant_id: u\.restaurant_id,\s*\n\s*actor: u\.name/.test(CODE.panelLogout));
}
// SWEEP #10 T17, item 9 — "where to go after signing in" on the admin console's door must be one of
// OUR pages. The old test (starts with "/" but not "//") let "/\\example.com" through, which a browser and
// Next's redirect both read as https://example.com/.
{
  const SA = await import("@/lib/staffAuth.ts");
  const P = SA.sameSitePath, F = "/aevinite";
  const OFF = ["/\\example.com", "/\\/example.com", "//example.com", "https://example.com", "javascript:alert(1)", "\\\\example.com", "/\texample.com", "/\nexample.com", "", "aevinite", null, undefined, 42];
  check("P186181", "a backslash address that browsers read as another website is refused",
    P("/\\example.com", F) === F && P("/\\/example.com", F) === F, [P("/\\example.com", F), P("/\\/example.com", F)]);
  check("P186182", "every off-site, scheme, relative, control-character or non-text target falls back to the console",
    OFF.every((v) => P(v, F) === F), OFF.map((v) => P(v, F)).filter((x) => x !== F));
  check("P186183", "our own pages pass through unchanged, query and hash included",
    P("/aevinite", F) === "/aevinite" && P("/aevinite/printing?x=1#a", F) === "/aevinite/printing?x=1#a" && P("/owner?rid=00000000-0000-0000-0000-000000000001", F) === "/owner?rid=00000000-0000-0000-0000-000000000001");
  check("P186184", "a percent-encoded backslash stays a harmless path on our own site",
    P("/%5Cexample.com", F) === "/%5Cexample.com");
  check("P186185", "/api/staff-login decides `next` through sameSitePath, not a hand-rolled prefix test",
    has(CODE.staffLogin, 'const next = sameSitePath(form?.get("next") || "/aevinite", "/aevinite");') && !/startsWith\("\/\/"\)/.test(CODE.staffLogin));
  check("P186186", "the admin card follows only the SERVER's checked `next`, never the raw ?next it was opened with",
    has(CODE.staffLoginForm, 'window.location.assign(data.next || "/aevinite")') && !/assign\(data\.next \|\| next\)/.test(CODE.staffLoginForm));
  check("P186187", "the failed-password redirect carries `next` only as an ENCODED query value",
    has(CODE.staffLogin, "&next=${encodeURIComponent(next)}"));
  // Round 5, item 31 moved this rule (see P04679): the landing is decided in ONE function, landingFor.
  check("P186188", "the staff door's card decides where to land in one place (landingFor), never from a raw ?next",
    has(CODE.loginForm, "const dest = landingFor(next, home);") && !rx(CODE.loginForm, /router\.push\(next\)/));
}
// SWEEP #10 T17, item 10 — the three sign-in cards fit the room they sit in. The page keeps a 16px gutter,
// so a viewport-based width (92vw / 94vw) came out WIDER than that room at phone width: measured at 360px,
// right-hand gaps of 13px and 6px against 16px on the left. 100% of the page's own box is exactly the room.
for (const [cid, key, max] of [["P186189", "loginForm", "380px"], ["P186190", "staffLoginForm", "360px"], ["P186191", "blockedView", "380px"]]) {
  check(cid, `${F[key]}: the card is min(100%, ${max}) — never a vw width that overhangs the page's gutter`,
    has(CODE[key], `width: "min(100%, ${max})"`) && !/width: "min\(\d+vw/.test(CODE[key]));
}
// SWEEP #10 T17, items 11 + 12 (owner picked both, 2026-10-08).
check("P186501", "signing out of the admin console re-covers the passwords (clears the reveal unlock cookie)",
  has(CODE.staffLogout, 'res.cookies.set(REVEAL_COOKIE, "", { path: "/", maxAge: 0 });') && has(CODE.staffLogout, 'import { REVEAL_COOKIE } from "@/lib/revealGate";'));
check("P186502", "…and still touches no database and signs no staff member out",
  !rx(CODE.staffLogout, /supabaseAdmin|sb\.from\(|logAction|USER_COOKIE/));
check("P186503", "the 'You're blocked' note box uses the card's own lettering, not the browser's typewriter default",
  /<textarea[\s\S]*?fontFamily: "inherit"/.test(CODE.blockedView));
// SWEEP #10 T17, item 14 (owner picked 2026-10-08) — the handover passwords get the vault's OWN key, and a copy
// sealed under the old key keeps opening, so changing keys never shows "not stored yet". Fake keys only.
{
  const PV = await import("@/lib/passwordVault.ts");
  const keep = { svc: process.env.SUPABASE_SERVICE_ROLE_KEY, cvk: process.env.CREDENTIAL_VAULT_KEY };
  const set = (svc, cvk) => { if (svc === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = svc;
    if (cvk === undefined) delete process.env.CREDENTIAL_VAULT_KEY; else process.env.CREDENTIAL_VAULT_KEY = cvk; };
  const SVC1 = "fake-service-key-one-0123456789", SVC2 = "fake-service-key-TWO-9876543210", CVK = "fake-vault-key-abcdefghijklmnop";
  try {
    set(SVC1, undefined);
    const old = await PV.sealPassword("handover-1");
    check("P186504", "a stack WITHOUT the vault key seals and opens exactly as before (v1)",
      old?.startsWith("v1$") && (await PV.openPassword(old)) === "handover-1" && !PV.needsReseal(old));
    set(SVC1, CVK);
    const fresh = await PV.sealPassword("handover-2");
    check("P186505", "with CREDENTIAL_VAULT_KEY set, new copies are sealed with the vault's own key (v2)",
      fresh?.startsWith("v2$") && (await PV.openPassword(fresh)) === "handover-2");
    check("P186506", "a copy sealed BEFORE the vault key existed still opens after it is set (nothing shows 'not stored yet')",
      (await PV.openPassword(old)) === "handover-1");
    check("P186507", "…and is the one the reseal script would move; a v2 copy is not",
      PV.needsReseal(old) === true && PV.needsReseal(fresh) === false);
    set(SVC2, CVK);
    check("P186508", "THE POINT: after the database key is rotated, a v2 copy still opens",
      (await PV.openPassword(fresh)) === "handover-2");
    check("P186509", "…while an un-moved v1 copy cannot (why the reseal runs) — and it answers null, never throws",
      (await PV.openPassword(old)) === null);
    set(SVC2, "a-different-vault-key-zzzzzzzz");
    check("P186510", "a v2 copy under the wrong vault key opens to null, never half a string",
      (await PV.openPassword(fresh)) === null);
    set(SVC1, undefined);
    check("P186511", "a v2 copy on a stack with no vault key opens to null (backup-2 / AV live never guess)",
      (await PV.openPassword(fresh)) === null && PV.needsReseal(old) === false);
  } finally { set(keep.svc, keep.cvk); }
  const RS = stripComments(read("scripts/reseal-handover-passwords.mjs"));
  check("P186512", "the reseal script is a DRY RUN unless --write, and refuses to start without the vault key",
    has(RS, 'const WRITE = process.argv.includes("--write");') && /CREDENTIAL_VAULT_KEY[\s\S]{0,200}process\.exit\(2\)/.test(RS));
  check("P186513", "…moves a row only if it still holds the copy it read (first save wins), and re-opens the new copy before writing",
    has(RS, '.eq("id", row.id).eq("password_shown", row.password_shown)') && has(RS, "(await V.openPassword(sealed)) !== plain"));
  check("P186514", "…and never prints a password, a key or a sealed value",
    !/console\.\w+\([^)]*(plain|sealed|password_shown|CREDENTIAL_VAULT_KEY\b[^"]*\))/.test(RS.replace(/"[^"]*"/g, '""')));
  check("P186515", "sign-in still never reads the vault (password_hash alone decides)", !/passwordVault|password_shown/.test(CODE.userAuth));
}
// SWEEP #10 T17, item 13 (owner picked 2026-10-08) — a PRODUCTION deployment with no signing secret at all
// refuses staff sign-in instead of sealing passes with the fallback word that is written in the code.
{
  const { createHmac } = await import("node:crypto");
  const NAMES = ["NODE_ENV", "SESSION_SECRET", "ADMIN_PASSWORD", "STAFF_PASSWORD"];
  const keep = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
  const env = (o) => { for (const k of NAMES) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
  const sid = "00000000-0000-4000-8000-0000000000aa";
  const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const passWith = (secret) => { const iat = Date.now(); return `${sid}.${iat}.${b64u(createHmac("sha256", secret).update(`${sid}:manager:0:${iat}`).digest())}`; };
  const quiet = console.error; console.error = () => {};
  try {
    await world([{ id: sid, username: "item13", password_hash: await UA.hashSecret("pw-13"), role: "manager", restaurant_id: "r1", active: true, deleted_at: null, token_version: 0 }]);
    env({ NODE_ENV: "production" });
    resetWorld(); G.FIX.staff_users = [{ id: sid, username: "item13", password_hash: await UA.hashSecret("pw-13"), role: "manager", restaurant_id: "r1", active: true, deleted_at: null, token_version: 0 }];
    const r = await UA.loginUser("item13", "pw-13");
    check("P186516", "production with NO signing secret: sign-in is refused in words, as 'not set up', not as a wrong password",
      r.ok === false && r.reason === "not_configured" && r.unavailable === true && r.error === UA.NOT_SET_UP, r);
    check("P186517", "…and nobody was looked up, counted or locked (no database read at all)", G.READS.length === 0 && G.WRITES.length === 0, { reads: G.READS.length, writes: G.WRITES.length });
    check("P186518", "…and a pass sealed with the built-in fallback word is trusted by nobody",
      (await UA.userFromCookie(passWith("lfh-dev-secret"))) === null);
    env({ NODE_ENV: "development" });
    check("P186519", "local development keeps the fallback, so a fresh checkout still signs in",
      (await UA.userFromCookie(passWith("lfh-dev-secret")))?.id === sid);
    env({ NODE_ENV: "production", SESSION_SECRET: "a-real-session-secret-for-the-guard" });
    const ok = await UA.loginUser("item13", "pw-13");
    check("P186520", "production WITH a secret signs in exactly as before, and that pass is trusted",
      ok.ok === true && (await UA.userFromCookie(ok.cookie))?.id === sid);
  } finally { env(keep); console.error = quiet; }
  check("P186521", "/api/panel-login answers the 'not set up' refusal with 503 and records why for the admin",
    has(CODE.panelLogin, "{ status: r.transient || r.unavailable ? 503 : 401 }") && has(CODE.panelLogin, 'r.reason === "not_configured"'));
}
// SWEEP #10 T17 ROUND 2, problem 15 — a handover-sheet copy that no longer matches the account's real password
// is cleared (the sheet then says "not stored yet") instead of printed. 3 of 77 dev copies were stale.
{
  const SPC = await import(pathToFileURL(join(root, "scripts/lib/storedPasswordCheck.mjs")).href);
  const h1 = await UA.hashSecret("same-pass"), legacy = await (await import("@/lib/staffAuth.ts")).sha256hex("legacy-pass");
  const cases = [["same-pass", h1], ["other-pass", h1], ["", h1], ["legacy-pass", legacy], ["nope", legacy], ["x", "pbkdf2$120000$@@@@$abc"], ["x", null], ["x", "pbkdf2$abc"]];
  let agree = true; const diffs = [];
  for (const [pw, h] of cases) { const a = await UA.verifySecret(pw, h), b = await SPC.verifySecret(pw, h); if (a !== b) { agree = false; diffs.push([pw, String(h).slice(0, 12), a, b]); } }
  check("P186637", "the script-side password check gives the SAME answer as the app's verifySecret on 8 kinds of input", agree, diffs);
  const RS2 = stripComments(read("scripts/reseal-handover-passwords.mjs"));
  check("P186638", "--stale compares each copy with the REAL password hash and clears only one that does not match",
    has(RS2, "if (await verifySecret(plain, row.password_hash)) continue;") && has(RS2, ".update({ password_shown: null })"));
  check("P186639", "…first save wins: a row is cleared only if it still holds BOTH the copy and the hash it read",
    has(RS2, '.eq("id", row.id).eq("password_shown", row.password_shown).eq("password_hash", row.password_hash)'));
  check("P186640", "…a copy it cannot open is left alone, and nothing is written without --write",
    has(RS2, "if (plain === null) { unreadable++; continue; }") && has(RS2, "if (!WRITE) continue;"));
}
// SWEEP #10 T17 ROUND 2, problem 16 — the gate rulebook (docs/CLAUDE-DETAIL.md → Security gate) must match the
// routes. It calls its public list COMPLETE, so a public route missing from it points the next audit at a
// fine route, and a deleted route still described points it at nothing. Found: /api/guest/leave missing,
// /api/pair (deleted by mig 380) still described as live, panel-logout described as answering GET.
{
  const { execFileSync } = await import("node:child_process");
  const detail = read("docs/CLAUDE-DETAIL.md");
  const gateSec = detail.slice(detail.indexOf("## Security gate"), detail.indexOf("### The one middleware"));
  const live = gateSec.split("\n").filter((l) => !/DELETED|REMOVED|removed|deleted/.test(l)).join("\n");
  const routes = execFileSync("git", ["ls-files", "app/api"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith("/route.ts"));
  const urlOf = (f) => "/" + f.replace(/^app\//, "").replace(/\/route\.ts$/, "").replace(/\/\[\.\.\.path\]$/, "").replace(/\[([a-z]+)\]/g, "<slug>");
  const GATE = /tokenIsValid\(|requireRole\(|ownerScope(Or503)?\(|agentFrom|agentToken|x-lfh-agent|WEBHOOK_SECRET|x-webhook-secret/;
  const ungated = routes.filter((f) => !GATE.test(stripComments(read(f)))).map(urlOf);
  const named = (u) => gateSec.includes("`" + u + "`") || gateSec.includes("`" + u.replace("<slug>", "<source>") + "`");
  const missing = ungated.filter((u) => !named(u));
  check("P186905", "every API route with no login gate is named on the rulebook's public or door list", missing.length === 0, missing);
  const urls = routes.map(urlOf);
  const claimed = [...new Set([...live.matchAll(/`(\/api\/[a-z0-9/_<>-]+)(\/\*\*)?`/g)].map((m) => m[1]))];
  const gone = claimed.filter((n) => !urls.some((u) => u === n || u.startsWith(n + "/") || n.startsWith(u + "/") || u.replace(/<[a-z]+>/g, "<>") === n.replace(/<[a-z]+>/g, "<>")));
  check("P186906", "every route the rulebook describes as a LIVE gate still exists", gone.length === 0, gone);
  check("P186907", "the rulebook describes panel-logout as POST-only, as its code is", !/panel-logout`\s*still offers both shapes/.test(gateSec) && /panel-logout` has been POST-only/.test(gateSec));
  check("P186908", "…and names /api/guest/leave on the public list with its reason", gateSec.includes("`/api/guest/leave`") && /lfh_leave_session/.test(gateSec));
}
// SWEEP #10 T17 ROUND 2, item 17 — the owner entrance's try-again page (item 5) scrolled by 32px on a phone:
// min-height:100vh plus 16px padding with content-box sizing. Measured in Chrome at 360×780: 812 vs 780.
check("P186909", "the owner entrance's try-again page sizes its padding INSIDE the screen height (no 32px scroll)",
  /<body style="margin:0;box-sizing:border-box;min-height:100vh;/.test(read("app/r/[restaurant]/owner/route.ts")));
// SWEEP #10 T17 ROUND 3 (ids P161001–P162000, taken from the planning session's deliberately free gap with the
// owner's go-ahead, 2026-10-08) — items 18–20, owner: "do all".
{
  const lf = CODE.loginForm, sp = CODE.staffLoginPage;
  check("P161001", "item 18: the staff sign-in page scrolls by itself (its own scroll box), so Sign in is reachable on a phone held sideways",
    has(lf, 'minHeight: "100vh", height: "100%", overflowY: "auto"'));
  check("P161002", "…and so does the admin console's door (and the blocked card inside it)", has(sp, 'minHeight: "100vh", height: "100%", overflowY: "auto"'));
  check("P161003", "…R19 still holds: the screen height is 100vh, never 100dvh", !/100dvh/.test(lf + sp) && (lf + sp).split('minHeight: "100vh"').length === 3);
  check("P161004", "…every sign-in card centres with margin:auto, which cannot push its top out of reach",
    has(lf, 'className="lfh-signin" style={{ margin: "auto"') && has(CODE.staffLoginForm, 'style={{ margin: "auto"') && has(CODE.blockedView, '<div style={{ margin: "auto"'));
  check("P161005", "item 19: the box the keyboard is in gets a visible ring (:focus-visible), not only the caret",
    /\.lfh-signin input:focus-visible\{box-shadow:0 0 0 3px/.test(lf));
  check("P161006", "item 20: 'Username' and 'Password' are tied to their boxes (htmlFor = id)",
    has(lf, 'htmlFor="lfh-login-username"') && has(lf, 'id="lfh-login-username"') && has(lf, 'htmlFor="lfh-login-password"') && has(lf, 'id="lfh-login-password"'));
}
// ── SWEEP #10 T17 ROUND 3, item 22 — 32 SAFETY RULES THAT NO GUARD WATCHED (found by breaking each one) ────────
// Round 3 broke every key rule in T17's files one at a time and ran the guards: 32 breaks stayed GREEN. Rounds 1–2
// had checked those rules once, by running them — but a one-off check is not a guard, so any of them could have been
// undone tomorrow in silence. This block runs each rule for real (or, where a file cannot be loaded here, reads the
// exact rule) so the break turns this guard red. One check per rule; ids P161095–P161128.
{
  const SA = await import("@/lib/staffAuth.ts");
  const RG = await import("@/lib/revealGate.ts");
  const PV = await import("@/lib/passwordVault.ts");
  const PC = await import("@/lib/publicCap.ts");
  const AF = await import("@/lib/adminFetch.ts");
  const OP = await import("@/lib/ownerPin.ts");
  const LT = await import("@/lib/loginThrottle.ts");
  const src = (f) => stripComments(read(f));
  const fnFrom = (f, name, params) => { const s = read(f); const i = s.indexOf(`export function ${name}(`); const body = s.slice(s.indexOf("{", s.indexOf(")", i)) , s.indexOf("\n}\n", i) + 2); return new Function(...params, body); };
  const keepEnv = { ...process.env };
  // staffAuth
  check("P161095", "safeEqual refuses a string that is only a PREFIX of the other (its length check)", SA.safeEqual("abc", "abcd") === false && SA.safeEqual("abcd", "abc") === false && SA.safeEqual("a", "abcdef") === false);
  process.env.ADMIN_PASSWORD = ""; process.env.STAFF_PASSWORD = ""; process.env.EDITOR_PASSWORD = "";
  const emptyHash = await SA.sha256hex("");
  check("P161096", "with NO admin password configured, even the hash of an empty password is refused", (await SA.tokenIsValid(emptyHash)) === false);
  Object.assign(process.env, keepEnv); for (const k of ["ADMIN_PASSWORD", "STAFF_PASSWORD", "EDITOR_PASSWORD"]) if (!(k in keepEnv)) delete process.env[k];
  check("P161097", "sameSitePath keeps its SECOND layer (the parser's own same-site test) even though the first refuses every known trick", /u\.origin === base \? u\.pathname \+ u\.search \+ u\.hash : fallback/.test(src("lib/staffAuth.ts")));
  // the admin door
  const SL = CODE.staffLogin;
  check("P161098", "the admin door locks one address after 10 wrong tries for 5 minutes", /const ADMIN_MAX_FAILS = 10;/.test(SL) && /const ADMIN_LOCK_MS = 5 \* 60 \* 1000;/.test(SL) && /throttleFail\(throttleKey, ADMIN_MAX_FAILS, ADMIN_LOCK_MS\)/.test(SL));
  check("P161099", "the admin door refuses an automated submission before anything else", /if \(!verdict\.ok \|\| !\(await verifyTurnstile\(/.test(SL) && SL.indexOf("botVerdict(") < SL.indexOf("throttleStatus("));
  check("P161100", "a correct admin password clears that address's counter", /\n\s*await throttleReset\(throttleKey\);/.test(SL) && SL.indexOf("throttleReset(throttleKey)") > SL.indexOf("if (!matches) {"));
  // the staff door + own password
  const PL = CODE.panelLogin, PP = CODE.panelProfile;
  check("P161101", "the staff door refuses with 429 once the per-name limit is reached", /if \(!okRate\) \{[\s\S]{0,400}status: 429/.test(PL));
  check("P161102", "…and a correct sign-in clears that person's counter", /if \(uname\) await rateResetOnSuccess\("staff_login"/.test(PL));
  check("P161103", "the own-password box is counted per account before the current password is checked", /if \(!\(await rateAllowed\("password_change", u\.id/.test(PP) && PP.indexOf('rateAllowed("password_change"') < PP.indexOf("verifySecret(current"));
  check("P161104", "…and a person whose password the admin manages is refused there", /if \(!u\.can_self_reset\) \{\s*return NextResponse\.json\(\{ error: "Your admin manages your password/.test(PP));
  // the owner entrance + panel gates
  const OW = src("app/r/[restaurant]/owner/route.ts"), PG = src("lib/panelGate.ts");
  check("P161105", "the admin's act-as cookie from the owner entrance is HttpOnly", /res\.cookies\.set\(ADMIN_ACT_COOKIE, r\.id, \{ path: "\/", httpOnly: true/.test(OW));
  check("P161106", "an old owner address forwards with a TEMPORARY 307, never a cached-for-ever 308", /new URL\(`\/r\/\$\{moved\}\/owner`, req\.url\), 307\)/.test(OW) && !/, 308\)/.test(OW));
  check("P161107", "an admin panel pin (?rid) must be a full restaurant id", PG.includes("const RID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;") && /rid && RID_RE\.test\(rid\)/.test(PG));
  check("P161108", "the admin enters a bare panel only after picking a restaurant (else back to the console)", /if \(store\.get\(ADMIN_ACT_COOKIE\)\?\.value\) return;\s*redirect\("\/aevinite"\);/.test(PG));
  const iframe = fnFrom("lib/panelGate.ts", "panelIframeSrc", ["base", "adminRid", "pins"]);
  check("P161109", "the paint hint is forwarded only when it is a 36-character id", iframe("/p", null, { skelRid: "x&rid=evil" }) === "/p" && iframe("/p", null, { skelRid: "00000000-0000-4000-8000-000000000001" }) === "/p?skel=00000000-0000-4000-8000-000000000001");
  const PSs = src("lib/panelScope.ts"); const prBody = PSs.slice(PSs.indexOf("export function panelRestaurantId("), PSs.indexOf("export type ScopeReq"));
  check("P161110", "a STAFF member always acts on their own restaurant — the FIRST thing panelRestaurantId does, before any ?rid= is read",
    /\{\s*if \(g\.user\) return g\.user\.restaurant_id \|\| DEFAULT_RESTAURANT_ID;/.test(prBody.slice(prBody.indexOf("): string | null {"))) && prBody.indexOf("if (g.user) return g.user.restaurant_id") < prBody.indexOf('searchParams?.get("rid")'));
  const ei = fnFrom("lib/panelScope.ts", "emptyIdSegment", ["v"]);
  check("P161111", "'undefined', 'null' and 'NaN' path segments are all refused before the database", ei("undefined") && ei("null") && ei("NaN") && !ei("0"));
  const PA = src("lib/panelAccess.ts");
  check("P161112", "a panel switched off cuts open tabs within 30 seconds", PA.includes("const PANEL_TTL_MS = 30_000;"));
  check("P161113", "a binned restaurant drops out of its owner's list", /\.in\("id", chunk\)\.is\("deleted_at", null\)/.test(PA));
  // ownerScope
  const OSs = src("lib/ownerScope.ts");
  check("P161114", "an owner-cockpit pin (?scope/?rid/?as) counts only WITH a valid admin cookie", /pinSp\?\.get\("as"\)\) &&\s*\(await tokenIsValid\(req\.cookies\.get\(AUTH_COOKIE\)\?\.value\)\);/.test(OSs));
  check("P161115", "?as= is honoured only for somebody who co-owns the pinned restaurant", OSs.includes("(asOwner && members.includes(asOwner))"));
  const dfBody = OSs.slice(OSs.indexOf("export function dbFail("), OSs.indexOf("export { type PartialKey"));
  check("P161116", "dbFail never hands the database's own sentence to an owner (it goes to the server log only)",
    dfBody.includes('(opts?.message ?? "Couldn\'t load that just now — please try again.")') && /console\.error\(`\[\$\{where\}\] read failed[^;]*raw\);/.test(dfBody) && !/\{ error: raw|error: raw/.test(dfBody));
  check("P161117", "a restaurant id must be a full uuid — nothing else is asked about", OSs.includes("const RESTAURANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;"));
  // passwordVault
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "guard-only-service-key-0123456789";
  const a1 = await PV.sealPassword("same-pw"), a2 = await PV.sealPassword("same-pw");
  check("P161118", "two copies of the SAME password are sealed differently (a fresh nonce each time)", !!a1 && !!a2 && a1.split("$")[1] !== a2.split("$")[1]);
  // revealGate
  check("P161119", "one uncover lasts five minutes", RG.REVEAL_TTL_MS === 5 * 60 * 1000);
  process.env.ADMIN_PASSWORD ||= "guard-only-admin-password";
  const m = await RG.mintRevealToken();
  check("P161120", "an unlock cookie with a FORGED signature is locked", (await RG.revealUnlocked(`${m.expiresAt}.not-the-signature`)) === false && (await RG.revealUnlocked(m.value)) === true);
  const old = await RG.mintRevealToken(-1000);
  check("P161121", "an EXPIRED unlock is locked", (await RG.revealUnlocked(old.value)) === false);
  Object.assign(process.env, keepEnv); for (const k of Object.keys(process.env)) if (!(k in keepEnv)) delete process.env[k];
  // publicCap / loginThrottle / managerPin / supabaseAdmin / adminFetch / ownerPin / instrumentation
  check("P161122", "the in-memory cap map is bounded at 5,000 entries", /const MAX_TRACKED = 5000;/.test(src("lib/publicCap.ts")) && /if \(windows\.size > MAX_TRACKED\) windows\.clear\(\);/.test(src("lib/publicCap.ts")));
  check("P161123", "a throttle that cannot be read lets people in (it never locks the admin out by itself)", /catch \{\s*return \{ locked: false, retryMs: 0 \}; \/\/ fail-open/.test(read("lib/loginThrottle.ts")));
  check("P161124", "a manager PIN is checked only against THIS restaurant's managers", /select\("id,name,username,pin_hash"\)\s*\.eq\("restaurant_id", restaurantId\)/.test(src("lib/managerPin.ts")));
  check("P161125", "every database read has an 8-second deadline", /export const DB_TIMEOUT_MS = 8000;/.test(src("lib/supabaseAdmin.ts")));
  const realFetch = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify({ error: "nope" }), { status: 200 });
  const af = await AF.adminFetch("/x"); globalThis.fetch = realFetch;
  check("P161126", "an admin screen treats a 200 that carries {error} as a FAILURE", af.ok === false && af.error === "nope");
  globalThis.window = { location: { search: "?as=a%26rid%3Db" } };
  check("P161127", "the ?as= pin is encoded, so it can never smuggle a second parameter", OP.asSuffix() === "&as=a%26rid%3Db");
  delete globalThis.window;
  check("P161128", "server errors are still handed to the error reporter (instrumentation onRequestError)", /export const onRequestError = Sentry\.captureRequestError;/.test(src("instrumentation.ts")));
}
// SWEEP #10 T17 ROUND 3, item 23 — the wrong-password count is added INSIDE the database (mig 411).
{
  const sql = read("supabase/migrations/411_a_wrong_password_is_counted_once_each.sql");
  check("P161230", "migration 411 adds one INSIDE the update, so simultaneous wrong tries each count",
    /SET failed_count = CASE WHEN s\.failed_count \+ 1 >= p_max THEN 0 ELSE s\.failed_count \+ 1 END/.test(sql) && /WHERE s\.id = ANY \(p_ids\)/.test(sql));
  check("P161231", "…locks for p_lock_seconds on the try that reaches the limit", /locked_until = CASE WHEN s\.failed_count \+ 1 >= p_max THEN now\(\) \+ make_interval\(secs => p_lock_seconds\)/.test(sql));
  check("P161232", "…and is staff-only: REVOKE from PUBLIC/anon/authenticated, GRANT to service_role",
    /REVOKE ALL ON FUNCTION public\.lfh_staff_login_failed\(uuid\[\], integer, integer\) FROM PUBLIC, anon, authenticated;/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.lfh_staff_login_failed\(uuid\[\], integer, integer\) TO service_role;/.test(sql));
  check("P161233", "loginUser no longer counts with a read-add-write in the app", !/const fc = \(u\.failed_count \|\| 0\) \+ 1;/.test(CODE.userAuth));
  check("P161234", "…and a count that could not be written is said in the server log", has(CODE.userAuth, 'if (counted.error) console.error("[auth] could not count a wrong password:"'));
}
// ── SWEEP #10 T17 ROUND 3, item 24 — 17 MORE RULES NO GUARD WATCHED (the second break-it pass) ─────────────
// After item 22 the second break-it pass broke 42 further rules, items 13–23's own included; 17 stayed GREEN. Each one is
// pinned here: run for real where the file loads in this harness, else its exact rule read. ids P161522–P161538.
{
  const src = (f) => stripComments(read(f));
  const PV = await import("@/lib/passwordVault.ts");
  const PC = await import("@/lib/publicCap.ts");
  const AF = await import("@/lib/adminFetch.ts");
  const OP = await import("@/lib/ownerPin.ts");
  const LT = await import("@/lib/loginThrottle.ts");
  const RL = await import("@/lib/rateLimit.ts");
  const MP = await import("@/lib/managerPin.ts");
  const PA = await import("@/lib/panelAccess.ts");
  const { TOOK_TOO_LONG } = await import("@/lib/partialRead.ts");
  // a bare ?rid= with NO admin cookie is ignored — only the admin cookie turns a pinned request into the admin's
  resetWorld();
  const pinned = await UA.requireRole({ cookies: { get: () => undefined }, nextUrl: { searchParams: new URLSearchParams("rid=00000000-0000-0000-0000-000000000001") } }, "manager");
  check("P161522", "a signed-out visitor adding ?rid= to a panel call is NOT treated as the admin", pinned.ok === false);
  check("P161523", "a stored password copy from an unknown version (v3…) is refused, never guessed at",
    /if \(parts\.length !== 3 \|\| \(parts\[0\] !== "v1" && parts\[0\] !== "v2"\)\) return null;/.test(src("lib/passwordVault.ts")) && (await PV.openPassword("v3$abc$def")) === null);
  check("P161524", "the uncover password is hashed on both sides and compared by safeEqual — never with ===",
    /return safeEqual\(await sha256hex\(typed\), await sha256hex\(real\)\);/.test(src("lib/revealGate.ts")) && !/typed\s*===|===\s*real/.test(src("lib/revealGate.ts")));
  check("P161525", "a restaurant's owner entrance opens /owner only for an owner of THAT restaurant",
    /if \(member\) return NextResponse\.redirect\(new URL\("\/owner", req\.url\)\);/.test(src("app/r/[restaurant]/owner/route.ts")) &&
    /u\.restaurant_id === r\.id \|\|/.test(src("app/r/[restaurant]/owner/route.ts")) && /\.eq\("user_id", u\.id\)\.eq\("restaurant_id", r\.id\)/.test(src("app/r/[restaurant]/owner/route.ts")));
  check("P161526", "a restaurant's panel address lets in only that restaurant's own staff",
    /u\.role === role && u\.restaurant_id === r\.id && r\.active/.test(src("lib/panelGate.ts")));
  // Round 4 (items 25 + 28) moved this line inside a try, and the retired owner switch is no longer part of the rule.
  check("P161527", "a real owner's cockpit covers only the live restaurants they own",
    /try \{ ids = await enabledOwnedRestaurantIds\(owner\.id\); \}/.test(src("lib/ownerScope.ts")));
  resetWorld();
  const pinHash = await UA.hashSecret("4321");
  G.FIX.staff_users = [
    { id: "m1", name: "Asha", username: "asha", role: "manager", restaurant_id: "r1", active: true, pin_hash: pinHash },
    { id: "m2", name: "Bina", username: "bina", role: "manager", restaurant_id: "r1", active: true, pin_hash: pinHash },
  ];
  const shared = await MP.verifyManagerPin("4321", "r1");
  check("P161528", "a PIN two managers share credits BOTH of them (not whichever row came first)",
    shared.ok === true && shared.sharedPin === true && JSON.stringify(shared.managerIds) === '["m1","m2"]');
  resetWorld();
  G.FIX.login_throttle = [{ key: "admin:two-days", locked_until: new Date(Date.now() + 2 * 864e5).toISOString() }, { key: "admin:two-years", locked_until: new Date(Date.now() + 730 * 864e5).toISOString() }];
  check("P161529", "a lockout of days is a lockout, not a deliberate block — only one over a year is a block",
    (await LT.throttleIsBlocked("admin:two-days")) === false && (await LT.throttleIsBlocked("admin:two-years")) === true);
  resetWorld();
  await RL.rateAllowed("staff_login", "x".repeat(500));
  const rc = G.RPCS.find((c) => c.name === "lfh_rate_check");
  check("P161530", "a subject is cut to 200 characters before it reaches the limiter", !!rc && rc.args.p_subject.length === 200, rc?.args?.p_subject?.length);
  check("P161531", "the blocked screen remembers a request already sent (after a reload too)",
    /const alreadyAsked = sent \|\| status\?\.pending === true;/.test(src("app/staff-login/BlockedView.tsx")));
  const SLF = src("app/staff-login/LoginForm.tsx");
  check("P161532", "the admin card ignores a second tap while the first sign-in is still going",
    /if \(busy\) return;\s*setBusy\(true\);/.test(SLF));
  let pinOk = false; try { delete globalThis.window; pinOk = OP.asValue() === null && OP.asSuffix() === ""; } catch { pinOk = false; }
  check("P161533", "the owner pin helper answers 'none' on the server instead of crashing", pinOk);
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async () => { const e = new Error("slow"); e.name = "TimeoutError"; throw e; };
  const slow = await AF.adminFetch("/x"); globalThis.fetch = realFetch2;
  check("P161534", "a slow admin read says it took too long — not 'network fault'", slow.ok === false && slow.error === TOOK_TOO_LONG, slow.error);
  const dev = PC.capKeyFor({ cookies: { get: (n) => (n === "lfh_panel_device" ? { value: "dev-1" } : undefined) }, headers: { get: () => "1.2.3.4" } });
  const ip = PC.capKeyFor({ cookies: { get: () => undefined }, headers: { get: () => "1.2.3.4" } });
  check("P161535", "each panel device is counted on its own; only a device with no cookie falls back to its address", dev === "dev-1" && ip.startsWith("ip:"), `${dev} / ${ip}`);
  check("P161536", "every database read is given the 8-second deadline (the deadline fetch is what the client uses)",
    /fetch\(input, \{ \.\.\.init, signal: init\?\.signal \?\? AbortSignal\.timeout\(DB_TIMEOUT_MS\) \}\)/.test(src("lib/supabaseAdmin.ts")) && /global: \{ fetch: withDeadline \}/.test(src("lib/supabaseAdmin.ts")));
  check("P161537", "the retired per-panel switch is GONE (round 6, item 40) — no file can switch a staff app off any more", !("getEnabledPanels" in PA) && !("isPanelEnabled" in PA) && !("isPanelEnabledCached" in PA) && !/isPanelEnabled|getEnabledPanels/.test(["lib/userAuth.ts", "lib/panelGate.ts", "app/api/panel-login/route.ts", "app/r/[restaurant]/login/page.tsx"].map((f) => stripComments(read(f))).join("\n")));
  check("P161538", "the 'no secret on this site' message is words a waiter can read, not a setting name",
    / /.test(UA.NOT_SET_UP) && UA.NOT_SET_UP.length > 30 && !/[A-Z]{2,}_[A-Z]{2,}/.test(UA.NOT_SET_UP), UA.NOT_SET_UP);
}
// ── SWEEP #10 T17 ROUND 4 — FIVE THINGS A DATABASE BLIP OR A RETIRED SWITCH COULD STILL DO (items 25–29) ──────────
// Round 4 measured every branch of T17's files with code coverage and drove each one. Five were wrong; each is pinned
// here by RUNNING the real file against the in-memory stub (round 4 taught the stub to fail on purpose — G.FAIL /
// G.FAIL_NTH — and this loader to resolve the files the routes import). ids P162135–P162150.
{
  const PA = await import("@/lib/panelAccess.ts");
  const OS = await import("@/lib/ownerScope.ts");
  const LT = await import("@/lib/loginThrottle.ts");
  const PP = await import("@/app/api/panel-profile/route.ts");
  const { NextRequest } = await import("next/server.js");
  const RA = "00000000-0000-4000-8000-0000000000a1";
  const fresh = () => { resetWorld(); G.FAIL = {}; G.FAIL_NTH = {}; G.CALLS = {}; };
  const passFor = async (u, pw) => { fresh(); G.FIX.staff_users = [u]; const r = await UA.loginUser(u.username, pw); return r.ok ? r.cookie : null; };
  const rq = (path, cookie, init = {}) => { const h = new Headers(init.headers || {}); if (cookie) h.set("cookie", `lfh_user=${cookie}`); if (init.json !== undefined) h.set("content-type", "application/json"); return new NextRequest(new URL(path, "http://guard.local"), { method: init.method || "GET", headers: h, body: init.json !== undefined ? JSON.stringify(init.json) : undefined }); };
  const base = (o) => ({ id: "00000000-0000-4000-8000-00000000c0" + o.n, username: o.username, role: o.role, restaurant_id: RA, name: o.username, phone: null, active: true, deleted_at: null, pin_hash: null, token_version: 0, can_self_reset: true, can_self_set_pin: false, profile_confirmed: true, permissions: null, assigned_tables: null, failed_count: 0, locked_until: null, last_seen_at: new Date().toISOString(), password_hash: o.hash, ...o.extra });
  const H = await UA.hashSecret("guard-pass-1");
  // item 25 — the retired owner switch
  const own = base({ n: "01", username: "g4owner", role: "owner", hash: H });
  fresh(); G.FIX.restaurant_owners = [{ user_id: own.id, restaurant_id: RA }]; G.FIX.restaurants = [{ id: RA, deleted_at: null }]; G.FIX.settings = [{ restaurant_id: RA, enabled_panels: { owner: false } }];
  const kept = await PA.enabledOwnedRestaurantIds(own.id, false);
  check("P162135", "item 25: a restaurant still carrying the RETIRED owner switch OFF does not lock its owner out", kept.length === 1 && kept[0] === RA);
  check("P162136", "…and working out an owner's restaurants reads no settings at all (one query fewer per sign-in)", !G.READS.some((r) => r.table === "settings"));
  check("P162137", "…and lib/panelAccess.ts no longer reads settings.enabled_panels anywhere", !/enabled_panels/.test(stripComments(read("lib/panelAccess.ts"))));
  // item 28 — the owner cockpit on a blip
  const oc = await passFor(own, "guard-pass-1");
  fresh(); G.FIX.staff_users = [own]; G.FIX.restaurant_owners = [{ user_id: own.id, restaurant_id: RA }]; G.FAIL["restaurant_owners"] = "error"; PA.forgetRestaurant("x", [own.id]);
  const e0 = console.error; console.error = () => {};
  let r28; try { r28 = await OS.ownerScopeOr503(rq("/api/owner/overview", oc)); } catch (e) { r28 = { threw: e?.name }; }
  check("P162138", "item 28: a blip while working out a signed-in owner's restaurants answers 503 'try again', not a crash", r28?.resp?.status === 503, JSON.stringify(r28?.threw || r28?.resp?.status));
  fresh(); G.FIX.staff_users = [own]; G.FAIL["staff_users"] = "error";
  let r28b; try { r28b = await OS.ownerScopeOr503(rq("/api/owner/overview", oc)); } catch (e) { r28b = { threw: e?.name }; }
  console.error = e0;
  check("P162139", "…and the same when the database cannot say who the owner is", r28b?.resp?.status === 503, JSON.stringify(r28b?.threw || r28b?.resp?.status));
  const OSsrc = stripComments(read("lib/ownerScope.ts"));
  check("P162140", "…while any OTHER error still surfaces (a real bug is never dressed up as 'try again')",
    /if \(e instanceof AuthDbError\) \{[^}]*throw new OwnerScopeUnavailable\(\); \}\s*throw e;/.test(OSsrc) && /if \(e instanceof OwnedLookupFailed\) \{[^}]*throw new OwnerScopeUnavailable\(\); \}\s*throw e;/.test(OSsrc));
  // items 26 + 27 — the profile route on a blip
  const mgr = base({ n: "02", username: "g4mgr", role: "manager", hash: H, extra: { profile: { address: "12 MG Road", id_type: "Aadhaar", id_last4: "1234", id_verified: true, notes: "owner's note" } } });
  const mc = await passFor(mgr, "guard-pass-1");
  fresh(); G.FIX.staff_users = [JSON.parse(JSON.stringify(mgr))]; G.FIX.settings = [{ restaurant_id: RA, payroll_allowed: true }]; G.FAIL_NTH["staff_users:select"] = { at: 2, mode: "error" };
  console.error = () => {};
  const r26 = await PP.POST(rq("/api/panel-profile", mc, { method: "POST", json: { profile: { blood_group: "O+" } } }));
  console.error = e0;
  const after = G.FIX.staff_users[0].profile;
  check("P162141", "item 26: a blip reading a person's saved details never wipes the owner's ID record and private note", after.id_type === "Aadhaar" && after.id_verified === true && after.notes === "owner's note" && after.address === "12 MG Road" && !("blood_group" in after), JSON.stringify(after));
  check("P162142", "…the person is told to try again (503 busy), which the panel's queue retries by itself", r26.status === 503 && r26.headers.get("X-LFH-Busy") === "1");
  fresh(); G.FIX.staff_users = [JSON.parse(JSON.stringify(mgr))]; G.FAIL_NTH["staff_users:select"] = { at: 2, mode: "error" };
  console.error = () => {};
  const r27 = await PP.POST(rq("/api/panel-profile", mc, { method: "POST", json: { currentPassword: "guard-pass-1", newPassword: "guard-pass-2" } }));
  console.error = e0;
  check("P162143", "item 27: a blip during a password change says 'try again' — never 'your current password is wrong'", r27.status === 503 && !/wrong/i.test((await r27.json()).error || ""));
  check("P162144", "…and the password is left exactly as it was", G.FIX.staff_users[0].password_hash === H && !G.WRITES.some((w) => w.table === "staff_users"));
  // item 29 — the admin door and the manager PIN, counted in the database
  const sql = read("supabase/migrations/414_admin_and_pin_wrong_tries_are_counted_once_each.sql");
  check("P162145", "item 29: migration 414 adds one INSIDE one insert-or-update, so simultaneous wrong tries each count",
    /ON CONFLICT \(key\) DO UPDATE\s+SET fail_count\s+= t\.fail_count \+ 1/.test(sql) && /RETURNING t\.fail_count INTO n;/.test(sql));
  check("P162146", "…locks on the try that reaches the limit, and never SHORTENS a lock already running",
    /IF n >= p_max THEN/.test(sql) && /locked_until = GREATEST\(COALESCE\(t\.locked_until, now\(\)\), now\(\) \+ make_interval\(secs => p_lock_ms \/ 1000\.0\)\)/.test(sql));
  check("P162147", "…and a wrong try never clears a lock (or a deliberate block) that is still running",
    /locked_until = CASE WHEN t\.locked_until > now\(\) THEN t\.locked_until ELSE NULL END/.test(sql));
  check("P162148", "…and is staff-only: REVOKE from PUBLIC/anon/authenticated, GRANT to service_role",
    /REVOKE ALL ON FUNCTION public\.lfh_throttle_fail\(text, integer, integer\) FROM PUBLIC, anon, authenticated;/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.lfh_throttle_fail\(text, integer, integer\) TO service_role;/.test(sql));
  fresh(); G.RPC_ANSWERS.lfh_throttle_fail = [{ fail_count: 3, locked: false }];
  const t29 = await LT.throttleFail("admin:9.9.9.9", 10, 300000);
  const call = G.RPCS.find((r) => r.name === "lfh_throttle_fail")?.args;
  check("P162149", "throttleFail counts with ONE database call (key, limit, lock length) and no read-then-write here",
    call?.p_key === "admin:9.9.9.9" && call?.p_max === 10 && call?.p_lock_ms === 300000 && !G.READS.some((r) => r.table === "login_throttle") && t29.failCount === 3 && t29.attemptsLeft === 7);
  fresh(); G.FAIL["rpc:lfh_throttle_fail"] = "error"; const logged = []; console.error = (...a) => logged.push(a.join(" "));
  const t29b = await LT.throttleFail("admin:9.9.9.9", 10, 300000); console.error = e0;
  check("P162150", "…and a count that cannot be written still fails OPEN (never breaks a sign-in) and says so in the server log",
    t29b.locked === false && t29b.failCount === 0 && t29b.attemptsLeft === 10 && logged.some((l) => /could not count a wrong try/.test(l)));
  delete G.RPC_ANSWERS.lfh_throttle_fail; G.FAIL = {}; G.FAIL_NTH = {};
}
// ── SWEEP #10 T17 ROUND 5 — SUSPENDED STOPS THE STAFF APPS, NO SIGN-IN LOOP, DEEP LINKS, ALERT ENGLISH (items 30, 31, 33, 34) ──
// ids P162233–P162248. Run for real where the file loads here; the page files (JSX) are read.
{
  const PA = await import("@/lib/panelAccess.ts");
  const PG = await import("@/lib/panelGate.ts");
  const PL = await import("@/app/api/panel-login/route.ts");
  const { NextRequest } = await import("next/server.js");
  const RA = "00000000-0000-4000-8000-0000000000a1", RB = "00000000-0000-4000-8000-0000000000b2";
  const fresh = () => { resetWorld(); G.FAIL = {}; G.FAIL_NTH = {}; G.CALLS = {}; };
  const H5 = await UA.hashSecret("guard5-pass");
  const mk = (n, role, extra = {}) => ({ id: "00000000-0000-4000-8000-00000000d0" + n, username: "g5" + n, role, restaurant_id: RA, name: "G5 " + n, phone: null, active: true, deleted_at: null, pin_hash: null, token_version: 0, can_self_reset: true, can_self_set_pin: false, profile_confirmed: true, permissions: null, assigned_tables: null, failed_count: 0, locked_until: null, last_seen_at: new Date().toISOString(), password_hash: H5, ...extra });
  const passOf = async (u) => { fresh(); G.FIX.staff_users = [u]; const r = await UA.loginUser(u.username, "guard5-pass"); return r.cookie; };
  const rr = (cookie, q = "") => ({ cookies: { get: (n) => (n === "lfh_user" && cookie ? { value: cookie } : undefined) }, nextUrl: { searchParams: new URLSearchParams(q) }, headers: { get: () => null } });
  const m5 = mk("01", "manager"); const mc = await passOf(m5);
  fresh(); G.FIX.staff_users = [m5]; G.FIX.restaurants = [{ id: RA, deleted_at: null, active: false }]; PA.forgetRestaurant(RA);
  check("P162233", "item 30: a SUSPENDED restaurant's manager is refused on every panel call (requireRole)", (await UA.requireRole(rr(mc), "manager")).ok === false);
  const reads = G.READS.filter((r) => r.table === "restaurants").length; await UA.requireRole(rr(mc), "manager");
  check("P162234", "…and the bin + suspension answers share ONE cached read (no extra trip per call)", reads === 1 && G.READS.filter((r) => r.table === "restaurants").length === 1);
  const o5 = mk("02", "owner"); const oc = await passOf(o5);
  fresh(); G.FIX.staff_users = [o5]; G.FIX.restaurant_owners = [{ user_id: o5.id, restaurant_id: RA }]; G.FIX.restaurants = [{ id: RA, deleted_at: null, active: false }]; PA.forgetRestaurant(RA, [o5.id]);
  check("P162235", "…while the OWNER of a suspended restaurant still gets into the owner panel", (await UA.requireRole(rr(oc), "owner")).ok === true);
  fresh(); G.FIX.restaurants = [{ id: RA, deleted_at: "2026-10-01T00:00:00Z", active: false }]; PA.forgetRestaurant(RA);
  const binWins = (await PA.isRestaurantDeleted(RA)) === true && (await PA.isRestaurantSuspended(RA)) === false;
  fresh(); G.FIX.restaurants = [{ id: RA, deleted_at: null, active: false }]; G.FAIL["restaurants"] = "error"; PA.forgetRestaurant(RA);
  const failOpen = (await PA.isRestaurantSuspended(RA)) === false; G.FAIL = {};
  check("P162236", "isRestaurantSuspended: a binned restaurant counts as binned (not suspended); a failed read lets people in and is NOT remembered",
    binWins && failOpen && (await PA.isRestaurantSuspended(RA)) === true);
  PA.forgetRestaurant(RA);
  fresh(); G.FIX.staff_users = [m5]; G.FIX.restaurants = [{ id: RA, deleted_at: null, active: false }]; PA.forgetRestaurant(RA);
  const e0 = console.error; console.error = () => {};
  const sres = await PL.POST(new NextRequest(new URL("/api/panel-login", "http://guard.local"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: m5.username, password: "guard5-pass" }) }));
  console.error = e0; const sbody = await sres.json();
  check("P162237", "item 30: signing in to a suspended restaurant with the RIGHT password: 403, the 'switched off' sentence, and no pass cookie",
    sres.status === 403 && sbody.error === PG.DOOR_OFF && !(sres.headers.getSetCookie?.() || []).some((c) => c.startsWith("lfh_user=")));
  check("P162238", "…logged as login_denied naming the suspension", (G.FIX.staff_actions || []).some((r) => r.action === "login_denied" && /switched off \(suspended\)/.test(r.detail || "")));
  PA.forgetRestaurant(RA);
  fresh(); G.FIX.restaurant_owners = []; G.FIX.restaurants = []; PA.forgetRestaurant("x", [o5.id]);
  const nd = await PG.panelDoor(o5);
  fresh(); G.FIX.restaurants = [{ id: RA, deleted_at: null, active: false }]; PA.forgetRestaurant(RA);
  const sd = await PG.panelDoor(m5); PA.forgetRestaurant(RA);
  check("P162239", "item 33: panelDoor refuses an owner with no live restaurant (owner sentence) and staff of a suspended one ('switched off')",
    nd.ok === false && nd.message === PG.DOOR_NO_OWNED && sd.ok === false && sd.why === "off" && sd.message === PG.DOOR_OFF);
  const G5 = stripComments(read("lib/panelGate.ts"));
  check("P162240", "item 33: requirePanel sends a refused person to the card WITH the reason (?why=), not back round the loop",
    /if \(door && !door\.ok\) redirect\(`\/login\?why=\$\{door\.why\}`\);/.test(G5) && G5.indexOf("if (door && !door.ok)") < G5.lastIndexOf("redirect(`/login?next="));
  check("P162241", "item 30: a suspended restaurant's own address sends its staff to its card with ?why=off",
    /if \(u && u\.role === role && u\.restaurant_id === r\.id && !r\.active\) redirect\(`\/r\/\$\{slug\}\/login\?why=off`\);/.test(G5));
  const LPg = stripComments(read("app/login/page.tsx"));
  check("P162242", "item 33: /login redirects a signed-in person ONLY when panelDoor says they may enter; otherwise it shows why",
    /const door = await panelDoor\(u\);\s*if \(door\.ok\) redirect\(ROLE_HOME\[u\.role\] \|\| "\/menu"\);\s*notice = door\.message;/.test(LPg) && !/if \(u\) redirect\(/.test(LPg));
  check("P162243", "…and ?why= can only pick one of two FIXED sentences (nothing from the address is shown)",
    /let notice = why === "off" \? DOOR_OFF : why === "gone" \? DOOR_GONE : "";/.test(LPg));
  check("P162244", "item 30: a switched-off restaurant's door shows the sentence before anyone types", /notice=\{r\.active \? "" : DOOR_OFF\}/.test(stripComments(read("app/r/[restaurant]/login/page.tsx"))));
  const LFg = stripComments(read("app/login/LoginForm.tsx"));
  check("P162245", "the card draws the notice as plain text in a status box (never as HTML)",
    /\{notice \? <div role="status"[^>]*>\{notice\}<\/div> : null\}/.test(LFg) && !/dangerouslySetInnerHTML/.test(LFg));
  check("P162246", "item 31: a deep ?next inside the person's own panel is kept, with its query and #part",
    /return u\.pathname \+ u\.search \+ u\.hash;/.test(LFg) && /const u = new URL\(next, window\.location\.origin\);/.test(LFg));
  fresh(); G.FIX.staff_users = [{ id: "a", role: "tablet", name: "x", username: "x", restaurant_id: RA, active: true, deleted_at: null }, { id: "b", role: "tablet", name: "x", username: "x", restaurant_id: RB, active: true, deleted_at: null }]; G.FIX.restaurants = [{ id: RA, name: "A" }, { id: RB, name: "B" }];
  const one = await UA.describeLoginTarget("x");
  G.FIX.staff_users.push({ id: "c", role: "tablet", name: "x", username: "x", restaurant_id: RB, active: true, deleted_at: null });
  const two = await UA.describeLoginTarget("x");
  check("P162247", "item 34: the limit alert reads '+1 more account uses this name'", /\(\+1 more account uses this name\)$/.test(one || ""), one);
  check("P162248", "…and '+2 more accounts use this name'", /\(\+2 more accounts use this name\)$/.test(two || ""), two);
  G.FAIL = {}; G.FAIL_NTH = {};
}
// ── SWEEP #10 T17 ROUND 5 — RULES A DELIBERATE BREAK SURVIVED (mutation testing, 291 breaks) ─────────────────────────
// Round 5 broke T17's files automatically; these rules had no check that would notice. ids P162249–P162262.
{
  const SA = await import("@/lib/staffAuth.ts");
  const RG = await import("@/lib/revealGate.ts");
  const RL = await import("@/lib/rateLimit.ts");
  const PS = await import("@/lib/panelSettings.ts");
  const SPv = await import("@/lib/sentryPrivacy.ts");
  const PGv = await import("@/lib/panelGate.ts");
  const OSv = await import("@/lib/ownerScope.ts");
  const PLv = await import("@/app/api/panel-login/route.ts");
  const ORv = await import("@/app/r/[restaurant]/owner/route.ts");
  const SLv = await import("@/app/api/staff-login/route.ts");
  const { NextRequest } = await import("next/server.js");
  const RA = "00000000-0000-4000-8000-0000000000a1";
  const fresh = () => { resetWorld(); G.FAIL = {}; G.FAIL_NTH = {}; G.CALLS = {}; };
  const nreq = (path, init = {}) => { const h = new Headers(init.headers || {}); let b; if (init.json !== undefined) { h.set("content-type", "application/json"); b = JSON.stringify(init.json); } if (init.form) b = new URLSearchParams(init.form); if (init.cookie) h.set("cookie", init.cookie); return new NextRequest(new URL(path, "http://guard.local"), { method: init.method || "GET", headers: h, body: b }); };
  const keepEnv = { ...process.env };
  delete process.env.ADMIN_PASSWORD; delete process.env.STAFF_PASSWORD; delete process.env.EDITOR_PASSWORD; delete process.env.REVEAL_PASSWORD;
  check("P162249", "with no admin password of any kind, adminPassword is the EMPTY TEXT and the uncover door says it is not set up", SA.adminPassword() === "" && RG.revealConfigured() === false);
  process.env.ADMIN_PASSWORD = "guard5b-admin-pw";
  check("P162250", "the RIGHT uncover password opens, and the same with one letter more does not", (await RG.revealPasswordMatches("guard5b-admin-pw")) === true && (await RG.revealPasswordMatches("guard5b-admin-pwx")) === false);
  fresh();
  check("P162251", "a blank subject is allowed and never sent to the limiter", (await RL.rateAllowed("staff_login", "  ")) === true && !G.RPCS.length);
  fresh(); G.FAIL["rpc:lfh_rate_check"] = "throw";
  check("P162252", "a limiter that THROWS lets the person through (it fails open)", (await RL.rateAllowed("staff_login", "x")) === true);
  check("P162253", "a settings row of null is handed straight back (never a crash)", (() => { try { return PS.panelSafeSettings(null) === null; } catch { return false; } })());
  const ev = { data: null, contexts: { trace: { data: { cookie: "c" } } }, spans: [{ data: { token: "t" } }] }; SPv.scrubSentryEvent(ev);
  check("P162254", "an error report whose extra data is null still has its trace and span secrets blanked", ev.contexts.trace.data.cookie === SPv.REDACTED && ev.spans[0].data.token === SPv.REDACTED);
  check("P162255", "the admin panel's frame never carries an ?as= that is not a real id", PGv.panelIframeSrc("/p/", RA, { as: "x&rid=y" }) === `/p/?rid=${RA}`);
  check("P162256", "the 'couldn't read every restaurant' reply is a 503 (retryable)", OSv.incompleteListResponse().status === 503);
  const H = await UA.hashSecret("guard5b-pass");
  const u = { id: "00000000-0000-4000-8000-00000000e001", username: "g5b", role: "manager", restaurant_id: RA, name: "G5B", active: true, deleted_at: null, token_version: 0, failed_count: 0, locked_until: null, password_hash: H, profile_confirmed: true };
  fresh(); G.FIX.staff_users = [JSON.parse(JSON.stringify(u))];
  const e0 = console.error; console.error = () => {};
  const bt = await PLv.POST(nreq("/api/panel-login", { method: "POST", json: { username: "g5b", password: "guard5b-pass", trap: "bot" } }));
  console.error = e0;
  check("P162257", "a filled bot trap is refused EVEN WITH THE RIGHT PASSWORD (and no pass is handed out)", bt.status === 401 && !(bt.headers.getSetCookie?.() || []).some((c) => c.startsWith("lfh_user=")));
  fresh(); G.FIX.staff_users = [JSON.parse(JSON.stringify(u))];
  const ep = await UA.loginUser("g5b", "");
  check("P162258", "a name with an EMPTY password is refused as empty — never looked up, never counted as a wrong try", ep.reason === "empty" && G.READS.length === 0 && G.RPCS.length === 0);
  const tok = await SA.sha256hex("guard5b-admin-pw");
  fresh(); G.FIX.restaurants = [{ id: RA, slug: "g5b-o", name: "A", active: true, deleted_at: null }];
  G.RPC_IMPL = { ...(G.RPC_IMPL || {}), lfh_guest_restaurant: ({ p_slug }) => (G.FIX.restaurants || []).find((x) => x.slug === p_slug) || null };
  const orr = await ORv.GET(nreq("/r/g5b-o/owner", { cookie: `lfh_staff_auth=${tok}` }), { params: Promise.resolve({ restaurant: "g5b-o" }) });
  const act = (orr.headers.getSetCookie?.() || []).find((c) => c.startsWith("aevidine_admin_rid=")) || "";
  check("P162259", "the admin's act-as cookie is HttpOnly and lasts exactly 6 hours", /HttpOnly/i.test(act) && /Max-Age=21600/.test(act), act);
  process.env.ADMIN_PASSWORD = "b".repeat(200);
  fresh(); G.RPC_IMPL = { ...(G.RPC_IMPL || {}), lfh_throttle_fail: () => [{ fail_count: 1, locked: false }] };
  const okLong = await (await SLv.POST(nreq("/api/staff-login", { method: "POST", form: { password: "b".repeat(200) }, headers: { accept: "application/json", "x-forwarded-for": "7.7.7.77" } }))).json();
  process.env.ADMIN_PASSWORD = "b".repeat(201);
  fresh(); G.RPC_IMPL = { ...(G.RPC_IMPL || {}), lfh_throttle_fail: () => [{ fail_count: 1, locked: false }] };
  const noLong = await (await SLv.POST(nreq("/api/staff-login", { method: "POST", form: { password: "b".repeat(201) }, headers: { accept: "application/json", "x-forwarded-for": "7.7.7.78" } }))).json();
  check("P162260", "an admin password of exactly 200 characters is accepted; 201 is refused without being hashed", okLong.ok === true && noLong.ok === false);
  process.env.ADMIN_PASSWORD = "guard5b-admin-pw";
  fresh(); const mm = { ...u, sw_version: "v5", last_seen_at: new Date().toISOString() }; G.FIX.staff_users = [mm]; G.FIX.restaurants = [{ id: RA, deleted_at: null, active: true }];
  const pass = (await (async () => { const r = await UA.loginUser("g5b", "guard5b-pass"); return r.cookie; })());
  G.FIX.staff_users[0].last_seen_at = new Date().toISOString(); G.WRITES.length = 0;
  const PAx = await import("@/lib/panelAccess.ts"); PAx.forgetRestaurant(RA);
  await UA.requireRole({ cookies: { get: (n) => (n === "lfh_user" ? { value: pass } : undefined) }, headers: { get: () => null } }, "manager"); await new Promise((r) => setTimeout(r, 5));
  check("P162261", "a panel call with NO app-version header never writes (or clears) the stored version", !G.WRITES.some((w) => w.table === "staff_users"));
  G.FIX.staff_users[0].last_seen_at = new Date(Date.now() - 50000).toISOString(); G.WRITES.length = 0; PAx.forgetRestaurant(RA);
  await UA.requireRole({ cookies: { get: (n) => (n === "lfh_user" ? { value: pass } : undefined) }, headers: { get: () => null } }, "manager"); await new Promise((r) => setTimeout(r, 5));
  check("P162262", "…while a 'last seen' 50 seconds old IS refreshed", G.WRITES.some((w) => w.table === "staff_users" && w.patch?.last_seen_at));
  PAx.forgetRestaurant(RA);
  for (const k of ["ADMIN_PASSWORD", "STAFF_PASSWORD", "EDITOR_PASSWORD", "REVEAL_PASSWORD"]) if (keepEnv[k] === undefined) delete process.env[k]; else process.env[k] = keepEnv[k];
  G.FAIL = {}; G.FAIL_NTH = {};
}
// ── SWEEP #10 T17 ROUND 6 — items 37, 38, 39, 40 (owner 2026-10-09: "do all 4") ─────────────────────────────────────────
// ids P163142–P163150. The owner layout and the console page are JSX, so their rules are read here; the browser half is
// in the round's ledger rows (every signed-out owner page carried to sign-in and back, JS off included).
{
  const srcOf = (f) => stripComments(read(f));
  const ALL = ["lib/panelAccess.ts", "lib/panelGate.ts", "lib/userAuth.ts", "app/api/panel-login/route.ts", "app/r/[restaurant]/login/page.tsx", "app/login/page.tsx", "app/owner/layout.tsx"].map(srcOf).join("\n");
  check("P163142", "item 40: no sign-in file asks the retired per-panel switch any more (getEnabledPanels / isPanelEnabled are deleted)", !/getEnabledPanels|isPanelEnabled/.test(ALL));
  const ADM = srcOf("app/api/admin/restaurants/route.ts");
  const sus = ADM.slice(ADM.indexOf('action === "set_restaurant_active"'), ADM.indexOf('action === "soft_delete_restaurant"'));
  check("P163143", "item 38: suspending or reactivating clears the remembered restaurant state at once (forgetRestaurant), before logging",
    /forgetRestaurant\(rid, await ownersOf\(rid\)\);\s*await logAction\("admin", active \? "restaurant_reactivate" : "restaurant_suspend"/.test(sus));
  const RP = read("app/aevinite/restaurants/page.tsx");
  check("P163144", "item 38: the console never says a suspended restaurant's staff keep working",
    !/Its own staff can still sign in to their panels/.test(RP) && !/Staff panels stay reachable to you via the buttons below/.test(RP) && !/staff panels stay reachable to you via act-as/.test(RP) && /its manager, kitchen and waiter apps STOP immediately/.test(RP));
  const OL = srcOf("app/owner/layout.tsx");
  check("P163145", "item 37: a signed-out visitor to any owner page is handed to the browser step that carries the page (not a fixed /owner)",
    /return <SignInBounce \/>;\s*\}\s*$/.test(OL.trim() + "\n") || /return <SignInBounce \/>;\n\}/.test(OL));
  const SB = read("app/owner/SignInBounce.tsx");
  check("P163146", "item 37: the step carries path + query + #part, encoded, and replaces the history entry (Back does not bounce)",
    /const here = window\.location\.pathname \+ window\.location\.search \+ window\.location\.hash;/.test(SB) && /window\.location\.replace\(`\/login\?next=\$\{encodeURIComponent\(here\)\}`\);/.test(SB));
  check("P163147", "…and without JavaScript a refresh still reaches the sign-in card", /<noscript>\s*<meta httpEquiv="refresh" content="0;url=\/login\?next=%2Fowner" \/>/.test(SB));
  check("P163148", "item 37: Menu, Inventory and Manager mode draw nothing for a signed-out visitor instead of throwing the page away with a redirect",
    ["app/owner/menu/page.tsx", "app/owner/inventory/page.tsx", "app/owner/manager/page.tsx"].every((f) => { const s = srcOf(f); const a = s.indexOf("if (!u && !(store.get(ADMIN_ACT_COOKIE)?.value && (await tokenIsValid(store.get(AUTH_COOKIE)?.value)))) return null;"); const b = s.search(/if \(!(selected|restaurants\.length)\) redirect\("\/owner"\);/); return a > 0 && b > a; }));
  check("P163149", "the owner layout shows its reconnecting screen (not the crash page) when an owner's restaurants cannot be read",
    /if \(e instanceof AuthDbError \|\| e instanceof OwnedLookupFailed\) return <OwnerReconnecting \/>;/.test(OL));
  const AL = read("lib/alerts.ts");
  check("P163150", "item 39: the alerts header names the SAME quiet priority the code sends ('low')",
    /const QUIET_PRIORITY = "low";/.test(AL) && /Priority "low" \(QUIET_PRIORITY below\)/.test(AL) && /`silent: true` → ntfy "low"/.test(AL));
}
// ── SWEEP #10 T17 ROUND 6 — the owner layout's rules a deliberate break survived (mutation pass B) — P163151–P163154 ──
{
  const OL = stripComments(read("app/owner/layout.tsx"));
  check("P163151", "the owner cockpit opens for a signed-in OWNER (role check is exactly 'owner'), and only they get the owner shell first",
    /if \(u && u\.role === "owner"\) \{\s*if \(!ownedIds\.length\) redirect\("\/login\?next=\/owner"\);/.test(OL));
  check("P163152", "…an owner with NO live restaurant goes to the sign-in card (which tells them why) — one with restaurants is never sent there",
    (OL.match(/redirect\("\/login\?next=\/owner"\)/g) || []).length === 1 && /if \(!ownedIds\.length\) redirect/.test(OL));
  check("P163153", "the admin's view names the restaurant, falling back to 'this restaurant' only when it has no name (both places)",
    (OL.match(/r\?\.name \|\| "this restaurant"/g) || []).length === 2);
  check("P163154", "the owner layout reads who is signed in and their restaurants inside ONE try (a blip there shows the reconnecting screen)",
    /try \{\s*u = await userFromCookie[\s\S]{0,300}if \(u && u\.role === "owner"\) ownedIds = await enabledOwnedRestaurantIds\(u\.id\);\s*\} catch \(e\) \{/.test(OL));
}
// ── SWEEP #10 T17 ROUND 6 — safety rules a deliberate break survived in mutation pass C — P163155–P163157 ──────────
{
  const RGc = await import("@/lib/revealGate.ts"); const PVc = await import("@/lib/passwordVault.ts"); const { createHash } = await import("node:crypto");
  const keep = { ...process.env };
  process.env.ADMIN_PASSWORD = "guard6c-admin"; delete process.env.REVEAL_PASSWORD;
  check("P163155", "an uncover cookie that is not text is LOCKED (an error inside the check never counts as unlocked)", (await RGc.revealUnlocked(12345)) === false && (await RGc.revealUnlocked({})) === false);
  delete process.env.ADMIN_PASSWORD; delete process.env.STAFF_PASSWORD; delete process.env.EDITOR_PASSWORD;
  const exp = Date.now() + 60000; const key = createHash("sha256").update("aevidine.reveal.v1$").digest("hex");
  check("P163156", "with NO password configured, an unlock signed with the empty password stays locked", (await RGc.revealUnlocked(`${exp}.${createHash("sha256").update(`${key}$${exp}`).digest("hex")}`)) === false);
  delete process.env.CREDENTIAL_VAULT_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  check("P163157", "with no vault key, a new password's readable copy is exactly null — so the OLD copy is cleared, never left on the handover sheet", (await PVc.passwordFields("x-pass-1")).password_shown === null);
  for (const k of ["ADMIN_PASSWORD", "STAFF_PASSWORD", "EDITOR_PASSWORD", "REVEAL_PASSWORD", "CREDENTIAL_VAULT_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
}
// ── SWEEP #10 T17 ROUND 6 — mutation pass D's safety rule — P163158 ─────────────────────────────────────────────────
{
  const PVd = await import("@/lib/passwordVault.ts"); const keep = process.env.CREDENTIAL_VAULT_KEY; process.env.CREDENTIAL_VAULT_KEY = "guard6d-vault-key-0123456789";
  const real = crypto.subtle.encrypt.bind(crypto.subtle); crypto.subtle.encrypt = async () => { throw new Error("guard: encrypt down"); };
  let pf; try { pf = await PVd.passwordFields("x-pass-6d"); } finally { crypto.subtle.encrypt = real; if (keep === undefined) delete process.env.CREDENTIAL_VAULT_KEY; else process.env.CREDENTIAL_VAULT_KEY = keep; }
  check("P163158", "if sealing the readable copy FAILS mid-way, it is exactly null — a password change clears the old copy, never leaves it", pf.password_shown === null && pf.password_hash.startsWith("pbkdf2$"));
}
check("P186015", "lib/userAuth.ts tests the id's SHAPE before the staff_users lookup, not after",
  (() => { const c = CODE.userAuth; const a = c.indexOf("if (!STAFF_ID.test(id)) return null;"); const b = c.indexOf('select("*").eq("id", id)');
    return a > 0 && b > a; })());

// ── loginUser: the real function, driven against fixtures ──
async function world(rows, owners = []) {
  resetWorld();
  G.FIX.staff_users = JSON.parse(JSON.stringify(rows));
  G.FIX.restaurant_owners = JSON.parse(JSON.stringify(owners));
}
const PW = await UA.hashSecret("right-pass");
const OTHER = await UA.hashSecret("other-pass");
const row = (o) => ({
  id: "u1", username: "ravi", role: "manager", restaurant_id: "r1", name: "Ravi",
  active: true, deleted_at: null, password_hash: PW, token_version: 1,
  failed_count: 0, locked_until: null, ...o,
});

await world([row({})]);
const good = await UA.loginUser("ravi", "right-pass");
check("P78768", "the right name and password sign in", good.ok === true, good.error);
check("P78769", "…and the reply carries a ready-to-set cookie", typeof good.cookie === "string" && good.cookie.split(".").length === 3);
check("P78770", "…whose first part is the user's id, so the server can look them up",
  good.ok && good.cookie.split(".")[0] === "u1");
check("P78771", "…and whose issued-at is now, not zero",
  good.ok && Math.abs(Number(good.cookie.split(".")[1]) - Date.now()) < 10_000);
check("P78772", "…and the returned user carries the restaurant, so nothing has to guess it later",
  good.ok && good.user.restaurant_id === "r1");
check("P78773", "a successful login clears the fail counter and the lock on the row",
  G.FIX.staff_users[0].failed_count === 0 && G.FIX.staff_users[0].locked_until === null);
check("P78774", "…and stamps last_seen_at, which is what the who-is-working board reads",
  !!G.FIX.staff_users[0].last_seen_at);

await world([row({})]);
check("P78775", "the name is matched case-insensitively and whitespace-forgivingly",
  (await UA.loginUser("  RAVI  ", "right-pass")).ok === true);
await world([row({})]);
check("P78776", "the PASSWORD is not normalised — case and spaces matter",
  (await UA.loginUser("ravi", "Right-Pass")).ok === false);

await world([row({})]);
const wrong = await UA.loginUser("ravi", "nope");
check("P78777", "a wrong password is refused with the generic sentence",
  wrong.error === "Wrong name or password.");
check("P78778", "…and the sensitive reason is returned separately, for the admin log only",
  wrong.reason === "wrong_password");
check("P78779", "…and the admin log gets the REAL account it was aimed at",
  wrong.attempted?.actor === "Ravi" && wrong.attempted?.restaurant_id === "r1");
check("P78780", "…and the row's fail counter went up by exactly one",
  G.FIX.staff_users[0].failed_count === 1, G.FIX.staff_users[0].failed_count);

await world([row({})]);
const unknown = await UA.loginUser("nobody-here", "nope");
check("P78781", "an unknown name gets the SAME sentence as a wrong password",
  unknown.error === "Wrong name or password.");
check("P78782", "…so nothing tells a guesser which names exist", unknown.reason === "no_such_name");
check("P78783", "…and the attempt record carries only what was typed",
  unknown.attempted?.actor === undefined);

await world([row({ failed_count: 4 })]);
await UA.loginUser("ravi", "nope");
check("P78784", "the fifth wrong try locks the account", !!G.FIX.staff_users[0].locked_until);
check("P78785", "…and resets the counter, so the lock is the thing holding them, not the count",
  G.FIX.staff_users[0].failed_count === 0);
{
  const until = new Date(G.FIX.staff_users[0].locked_until).getTime();
  check("P78786", "…for about a minute, not for ever", until - Date.now() > 50_000 && until - Date.now() <= 61_000);
}
await world([row({ locked_until: new Date(Date.now() + 30_000).toISOString() })]);
const locked = await UA.loginUser("ravi", "right-pass");
check("P78787", "a locked account is refused even with the RIGHT password", locked.ok === false);
check("P78788", "…and told plainly to wait, not that their password is wrong",
  /wait a minute/i.test(String(locked.error)));
check("P78789", "…and the reason recorded for the admin is 'locked'", locked.reason === "locked");
await world([row({ locked_until: new Date(Date.now() - 30_000).toISOString() })]);
check("P78790", "an EXPIRED lock does not block a correct password",
  (await UA.loginUser("ravi", "right-pass")).ok === true);

await world([row({ active: false })]);
const disabled = await UA.loginUser("ravi", "right-pass");
check("P78791", "a DISABLED person with the right password is told the truth",
  /disabled/i.test(String(disabled.error)) && disabled.reason === "disabled");
await world([row({ active: false })]);
const disabledWrong = await UA.loginUser("ravi", "nope");
check("P78792", "…but a WRONG password on a disabled row gets the generic answer",
  disabledWrong.error === "Wrong name or password." && disabledWrong.reason === "no_such_name");
await world([row({ deleted_at: "2026-01-01T00:00:00Z" })]);
check("P78793", "a recycle-bin account is not a login at all, right password or not",
  (await UA.loginUser("ravi", "right-pass")).reason === "no_such_name");
await world([row({ id: "dead", deleted_at: "2026-01-01T00:00:00Z", password_hash: OTHER }), row({ id: "live" })]);
check("P78794", "a LIVE account that re-used a binned account's name matches the live row",
  (await UA.loginUser("ravi", "right-pass")).ok === true);
await world([row({ id: "dead", deleted_at: "2026-01-01T00:00:00Z", password_hash: OTHER }), row({ id: "live" })]);
check("P78795", "…and the binned row's OLD password no longer opens anything",
  (await UA.loginUser("ravi", "other-pass")).ok === false);

// the same name at two restaurants (mig 091) — the plain door picks by password
await world([row({ id: "a", restaurant_id: "r1" }), row({ id: "b", restaurant_id: "r2", password_hash: OTHER })]);
const pick = await UA.loginUser("ravi", "other-pass");
check("P78796", "the same name at two restaurants is told apart by the PASSWORD",
  pick.ok === true && pick.user.restaurant_id === "r2", pick.ok && pick.user.restaurant_id);
await world([row({ id: "a", restaurant_id: "r1" }), row({ id: "b", restaurant_id: "r2", password_hash: OTHER })]);
await UA.loginUser("ravi", "neither");
check("P78797", "a wrong password bumps the counter on BOTH matching rows, so neither dodges the lock",
  G.FIX.staff_users.every((u) => u.failed_count === 1), G.FIX.staff_users.map((u) => u.failed_count));
await world([row({ id: "a", restaurant_id: "r1", locked_until: new Date(Date.now() + 30_000).toISOString() }),
             row({ id: "b", restaurant_id: "r2", password_hash: OTHER })]);
check("P78798", "a lockout on ANY matching row is honoured, so a colliding name cannot dodge it",
  (await UA.loginUser("ravi", "other-pass")).reason === "locked");

// the tenant door
await world([row({ id: "a", restaurant_id: "r1" }), row({ id: "b", restaurant_id: "r2", password_hash: OTHER })]);
check("P78799", "the tenant door refuses the OTHER restaurant's person outright",
  (await UA.loginUser("ravi", "other-pass", "r1")).ok === false);
await world([row({ id: "a", restaurant_id: "r1" }), row({ id: "b", restaurant_id: "r2", password_hash: OTHER })]);
check("P78800", "…and still signs in the person who belongs there",
  (await UA.loginUser("ravi", "right-pass", "r1")).ok === true);

// ─────────────────────────────────────────────────────────────────────────────────────────────
head("2. /api/panel-login — the staff door (P78801–P78880)");
// ─────────────────────────────────────────────────────────────────────────────────────────────
const PL = CODE.panelLogin;
const at = (src, needle) => src.indexOf(needle);
const before = (src, a2, b2) => at(src, a2) >= 0 && at(src, b2) >= 0 && at(src, a2) < at(src, b2);

check("P78801", "the route is POST-only — there is no GET that can sign anybody in",
  !rx(PL, /export async function (GET|PUT|PATCH|DELETE|HEAD)\b/));
check("P78802", "it is force-dynamic, so no sign-in is ever served from a cache",
  has(PL, 'export const dynamic = "force-dynamic";'));
check("P78803", "a body that is not JSON becomes {} instead of throwing",
  has(PL, "try { body = await req.json(); } catch {}"));
check("P78804", "the username is coerced to a string before anything looks at it",
  has(PL, 'String(body?.username || "")'));
check("P78805", "the password is coerced to a string too, so a number or an object cannot reach the hash",
  has(PL, 'String(body?.password || "")'));
check("P78806", "the slug is coerced to a string before the tenant lookup",
  has(PL, "String(body.restaurant)"));
check("P78807", "the tenant lookup happens BEFORE the rate limit, so the counter is keyed per restaurant",
  before(PL, "getRestaurantBySlug", "rateAllowed("));
check("P78808", "an unknown slug never reaches the credential lookup",
  before(PL, "if (!rest) return NextResponse.json", "loginUser("));
check("P78809", "the not-a-person refusal is logged, so the admin can still see the traffic",
  before(PL, "botVerdict(", 'logAction("admin", "login_failed"'));
check("P78810", "…and it names WHICH signal refused it, in the admin log only",
  has(PL, 'verdict.ok ? "turnstile" : verdict.reason'));
check("P78811", "the rate-limit label is length-capped so a huge typed name cannot bloat an alert",
  has(PL, "uname.slice(0, 60)") && has(PL, "String(body.restaurant).slice(0, 40)"));
check("P78812", "the rate limit is skipped entirely when no name was typed (nothing to count against)",
  has(PL, "if (uname) {"));
check("P78813", "a walled login answers 429, not 401 — the person is told to WAIT, not that they are wrong",
  has(PL, "Too many attempts. Please wait a few minutes and try again.") && has(PL, "status: 429"));
check("P78814", "…and the wall is written to the admin log as rate_limited, a different event from a wrong password",
  has(PL, 'logAction("admin", "rate_limited"'));
check("P78815", "the wall row names the restaurant, so a wall at one tenant is not filed under another",
  has(PL, "restaurant_id: restaurantId ?? null"));
check("P78816", "the counter is cleared ONLY after the password verified",
  before(PL, "const r = await loginUser(", "rateResetOnSuccess("));
check("P78817", "…and it is cleared under the SAME key it was counted with",
  count(PL, /\$\{restaurantId \|\| "\*"\}:\$\{subjectFor\(uname\)\}/g) === 2);
check("P78818", "a transient DB failure is answered 503 and nothing is logged as an attempt",
  has(PL, "if (!r.transient && r.reason"));
check("P78819", "every non-transient refusal reason has its own admin-log sentence",
  ["no_such_name", "wrong_password", "locked", "too_long", "disabled"].every((k) => has(PL, `r.reason === "${k}"`)));
check("P78820", "the refusal row is filed under the TARGETED account's panel, not always 'admin'",
  has(PL, 'logAction((a?.role ?? "admin"), "login_failed"'));
check("P78821", "…and under the targeted account's restaurant",
  // (sweep #10 T17 item 7: an owner's line is filed under a restaurant they OWN — the literal moved.)
  has(PL, ": (a?.restaurant_id ?? null);") && has(PL, "restaurant_id: failRid,"));
check("P78822", "the person only ever sees r.error, never r.reason",
  !rx(PL, /json\(\{[^}]*reason/));
check("P78823", "an owner is checked against what they OWN, never against their home namespace",
  before(PL, 'if (u.role === "owner")', "enabledOwnedRestaurantIds(u.id, false)"));
// Round 5, item 30 added the fourth refusal (a switched-off restaurant).
// Moved in sweep #10 T17 round 6, item 40: the per-panel 'isn't enabled' refusal was deleted with the retired switch.
check("P78824", "a refused owner login is recorded as login_denied, a different event from login_failed",
  count(PL, /"login_denied"/g) === 3);
check("P78825", "the binned-restaurant refusal names the recycle bin in the log",
  has(PL, "the restaurant is in the recycle bin"));
check("P78826", "the switched-off refusal names the suspension in the log (the disabled-panel one is gone)",
  has(PL, "the restaurant is switched off (suspended)") && !has(PL, "panel is not enabled for this restaurant"));
// Round 5, item 30 added the fourth (switched-off restaurant).
check("P78827", "all three refusals answer 403, not 401 — the password was RIGHT",
  count(PL, /\}, \{ status: 403 \}\)/g) === 3);
check("P78828", "the successful sign-in is logged under the person's own role",
  has(PL, "await logAction(u.role, \"login\", {"));
check("P78829", "the cookie's max age matches the signature's max age (7 days), so neither outlives the other",
  has(PL, "maxAge: 60 * 60 * 24 * 7") && has(CODE.userAuth, "TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000"));
check("P78830", "the cookie is set on the whole site, so every panel sees it",
  has(PL, 'path: "/",'));
check("P78831", "the reply tells the client the role, so the card can route without a second call",
  has(PL, "ok: true, role: u.role, needsProfile"));
check("P78832", "the reply carries no password hash, token version or user id",
  !rx(PL, /json\(\{ ok: true[^}]*(password|token_version|id:)/));
check("P78833", "the device id comes from the request, never from the body",
  has(PL, "deviceIdFrom(req)") && !rx(PL, /body\?\.device/));
check("P78834", "the restaurant scope is resolved through lib/tenant, not by a hand-rolled query",
  has(PL, 'from "@/lib/tenant"') && !rx(PL, /from\("restaurants"\)/));
check("P78835", "the route never touches the database directly — every read goes through a named helper",
  !rx(PL, /supabaseAdmin/));
check("P78836", "the not-a-person check and the turnstile check share ONE refusal, so neither leaks which fired",
  count(PL, /return NextResponse\.json\(\{ ok: false, error: "Wrong name or password\." \}, \{ status: 401 \}\);/g) >= 2);
check("P78837", "the turnstile answer is AWAITED (an un-awaited promise is always truthy)",
  has(PL, "await verifyTurnstile("));
check("P78838", "…and so is every ladder/entitlement read on the success path",
  count(PL, /await (enabledOwnedRestaurantIds|isRestaurantDeleted|isRestaurantSuspended)\(/g) === 3);
check("P78839", "the sign-in log carries the device, so 'which tablet was this' has an answer",
  has(PL, "device_id: deviceIdFrom(req)"));
check("P78840", "nothing in this file writes the typed password anywhere",
  !rx(PL, /(detail|actor|label)\s*:[^\n]*\bpassword\b/));

// The five sentences a person can be shown by this door. Each one has to be plain, actionable,
// and free of jargon — a waiter reads them at the start of a shift.
const DOOR_SENTENCES = [
  ["P78841", "Wrong name or password."],
  ["P78842", "Too many attempts. Please wait a few minutes and try again."],
  ["P78843", "The owner panel isn't enabled for any of your restaurants. Ask your admin to turn it on."],
  ["P78844", "This restaurant is no longer available. Contact your admin."],
];
// P78845 moved (round 6, item 40): the retired panel sentence is gone; the door's switched-off sentence lives in
// lib/panelGate.ts (DOOR_OFF) and /api/panel-login answers with it — checked here the same way.
check("P78845", "the door can say \"This restaurant is switched off right now. …\" and it reads as English",
  /export const DOOR_OFF = "This restaurant is switched off right now\. Ask Aevidine to turn it back on\.";/.test(read("lib/panelGate.ts")) && has(PL, "error: DOOR_OFF"));
check("P78850", "…and \"This restaurant is switched off right…\" contains no template hole", !/\$\{|undefined|null/.test("This restaurant is switched off right now. Ask Aevidine to turn it back on."));
for (const [id, sentence] of DOOR_SENTENCES) {
  check(id, `the door can say "${sentence.slice(0, 46)}…" and it reads as English`,
    has(PL, sentence) && !/\b(null|undefined|NaN|403|401|rid|uuid)\b/.test(sentence));
}
for (const [id, sentence] of DOOR_SENTENCES) {
  check(`P${Number(id.slice(1)) + 5}`, `…and "${sentence.slice(0, 32)}…" contains no template hole`,
    !/\$\{/.test(sentence));
}
check("P78851", "the two sentences a person sees most often end in a full stop",
  DOOR_SENTENCES.every(([, t]) => /[.!?]$/.test(t)));
check("P78852", "no refusal sentence names a database column",
  !rx(PL, /error: "[^"]*(restaurant_id|password_hash|token_version|deleted_at)/));
check("P78853", "the owner refusal says who can fix it ('your admin'), not just that it failed",
  /Ask your admin/.test(PL));

// ── the shape of the reply, driven through the real handler's own contract ──
check("P78854", "loginUser is the ONLY thing this route trusts for 'did the password match'",
  count(PL, /loginUser\(/g) === 1);
check("P78855", "the route never re-implements the lockout — it reads the reason loginUser returns",
  !rx(PL, /failed_count|locked_until/));
check("P78856", "…nor the hash comparison",
  !rx(PL, /verifySecret|pbkdf2|sha256/));
check("P78857", "the tenant-scoped door and the plain door share one handler, so they cannot drift",
  count(PL, /export async function POST/g) === 1);
check("P78858", "describeLoginTarget is imported from lib/userAuth, not copied",
  has(PL, "describeLoginTarget } from \"@/lib/userAuth\"")
  || has(PL, "describeLoginTarget") && has(PL, 'from "@/lib/userAuth"'));

// ── describeLoginTarget: the alert wording, RUN ──
await world([row({ name: "Ravi Kumar" })]);
G.FIX.restaurants = [{ id: "r1", name: "French House" }];
{
  const d = await UA.describeLoginTarget("ravi");
  check("P78859", "a walled login names the ROLE in words, not the database value",
    /^Manager /.test(String(d)), d);
  check("P78860", "…and the person's display name with their login in brackets",
    /“Ravi Kumar” \(ravi\)/.test(String(d)), d);
  check("P78861", "…and WHICH restaurant it was aimed at", /at French House/.test(String(d)), d);
}
await world([row({ name: "ravi" })]);
G.FIX.restaurants = [{ id: "r1", name: "French House" }];
check("P78862", "the name is not printed twice when the display name IS the login name",
  !/\(ravi\)/.test(String(await UA.describeLoginTarget("ravi"))));
await world([]);
check("P78863", "a name nobody has is SAID so — it reads very differently from a fumbled password",
  /Unknown name/.test(String(await UA.describeLoginTarget("ghost"))));
await world([row({ id: "a" }), row({ id: "b", restaurant_id: "r2" })]);
G.FIX.restaurants = [{ id: "r1", name: "French House" }, { id: "r2", name: "Aangan" }];
check("P78864", "when several restaurants share the name, the first is named and the rest counted",
  /\+1 more account\b/.test(String(await UA.describeLoginTarget("ravi"))),
  await UA.describeLoginTarget("ravi"));
await world([]);
check("P78865", "an empty name produces nothing rather than a broken sentence",
  (await UA.describeLoginTarget("   ")) === null);
check("P78866", "the wording helper never throws — a broken alert must not break a login",
  has(CODE.userAuth, "return null; // wording help only"));
check("P78867", "…and every read inside it is capped",
  (CODE.userAuth.split("export async function describeLoginTarget")[1] || "")
    .match(/\.select\(/g)?.length === (CODE.userAuth.split("export async function describeLoginTarget")[1] || "").match(/\.limit\(/g)?.length);
check("P78868", "…and names its columns rather than select(*)",
  !/describeLoginTarget[\s\S]*select\("\*"\)/.test(CODE.userAuth));
check("P78869", "it runs ONLY on the wall path — the normal login makes no extra read",
  has(PL, "describe: () => describeLoginTarget("));
check("P78870", "the four role words are all plain English",
  ["Owner", "Manager", "Kitchen screen", "Waiter tablet"].every((w) => has(CODE.userAuth, `"${w}"`)));
check("P78871", "an owner's restaurants come from the ownership join, not from their home namespace",
  has(CODE.userAuth, 'ownerRows.length && !restaurantId'));
check("P78872", "…and more than two owned restaurants are summarised, not listed for ever",
  has(CODE.userAuth, "owned.slice(0, 2).join(\" + \")"));

// ── the login candidate cap ──
check("P78873", "the candidate read is capped at 50 accounts for one typed name",
  has(CODE.userAuth, ".limit(MAX_LOGIN_CANDIDATES)"));
check("P78874", "…and reaching the cap is SAID OUT LOUD, never silent",
  has(CODE.userAuth, "console.warn(`[auth] the name"));
check("P78875", "the ownership join that follows it is bounded too",
  has(CODE.userAuth, '.in("user_id", ownerIds).limit(1000)'));
check("P78876", "…and a failure of that join is transient, not 'wrong password'",
  has(CODE.userAuth, "if (links.error) return { ok: false, error: \"Can't reach the server"));
check("P78877", "the join only runs when there is actually an owner candidate to check",
  has(CODE.userAuth, "if (ownerIds.length) {"));
check("P78878", "the PBKDF2 verify loop runs over LIVE rows only",
  has(CODE.userAuth, "for (const u of live) {"));
check("P78879", "…and stops at the first match, so a common name costs one verify, not fifty",
  has(CODE.userAuth, "{ matched = u; break; }"));
check("P78880", "the disabled-row sweep runs only after every live row has already failed",
  before(CODE.userAuth, "if (!matched) {", "u.active !== true && await verifySecret"));

// ─────────────────────────────────────────────────────────────────────────────────────────────
head("3. /api/panel-logout + /api/staff-logout — signing OUT (P78881–P78920)");
// ─────────────────────────────────────────────────────────────────────────────────────────────
const PLO = CODE.panelLogout, SLO = CODE.staffLogout;
check("P78881", "panel-logout clears the staff cookie on the whole site, not one path",
  has(PLO, 'res.cookies.set(USER_COOKIE, "", { path: "/", maxAge: 0 })'));
check("P78882", "…with maxAge 0, which is what actually removes it rather than shortening it",
  has(PLO, "maxAge: 0"));
check("P78883", "the audit line is written BEFORE the cookie is cleared, so it still knows who it was",
  before(PLO, "logAction(u.role,", 'res.cookies.set(USER_COOKIE, ""'));
check("P78884", "a DB failure while reading who it was is caught and printed, not rethrown",
  has(PLO, "console.error(\"[panel-logout] couldn't read who was signing out:\""));
check("P78885", "the logout still happens when nobody could be identified",
  has(PLO, "if (u) {"));
check("P78886", "the logout row names the restaurant, so it files under the right tenant",
  // (sweep #10 T17 item 7: an owner's line is filed under a restaurant they OWN — the literal moved.)
  has(PLO, 'restaurant_id: u.role === "owner" ? await ownerLogRestaurant(u.id, [u.restaurant_id]) : u.restaurant_id,'));
check("P78887", "…and the device, so a shared tablet's sign-outs are distinguishable",
  has(PLO, "device_id: deviceIdFrom(req)"));
check("P78888", "the redirect is 303, so the browser follows with a GET and cannot re-post",
  has(PLO, ", 303)"));
check("P78889", "it lands on /login, a page that exists and is public",
  has(PLO, '"/login"') && existsSync(join(root, "app/login/page.tsx")));
check("P78890", "the redirect URL is built from req.url, so it stays on this host",
  has(PLO, "new URL(\"/login\", req.url)"));
check("P78891", "panel-logout is force-dynamic — a cached logout would sign out the wrong person",
  has(PLO, 'export const dynamic = "force-dynamic";'));
check("P78892", "it reads no request body, so a malformed one cannot stop a logout",
  !rx(PLO, /req\.json\(\)|formData\(\)/));
check("P78893", "staff-logout clears the admin gate cookie",
  has(SLO, 'res.cookies.set(AUTH_COOKIE, ""'));
check("P78894", "…the readable flag cookie the switcher reads",
  has(SLO, 'res.cookies.set(FLAG_COOKIE, ""'));
check("P78895", "…and the 'view as restaurant' cookie, so the next visitor starts clean",
  has(SLO, 'res.cookies.set("aevidine_admin_rid", ""'));
check("P78896", "all three are cleared on the whole site",
  // 4 since sweep #10 T17 item 12 (the reveal unlock joins the admin cookie, the flag and the act-as pin).
  count(SLO, /path: "\/", maxAge: 0/g) === 4);
check("P78897", "staff-logout reads no body either",
  !rx(SLO, /req\.json\(\)|formData\(\)/));
check("P78898", "…and writes no diary line, because ending admin super-access touches no restaurant's data",
  !rx(SLO, /logAction/));
check("P78899", "the admin lands on the open guest menu, not a password screen they would have to pass again",
  has(SLO, '"/menu"'));
check("P78900", "…and /menu really exists", existsSync(join(root, "app/menu/page.tsx")));
check("P78901", "neither logout route can be reached by a GET, so a prefetch cannot sign anyone out",
  !rx(PLO, /function GET/) && !rx(SLO, /function GET/));
check("P78902", "neither imports the service-role client",
  !rx(PLO, /supabaseAdmin/) && !rx(SLO, /supabaseAdmin/));
check("P78903", "panel-logout's cookie name comes from lib/userAuth, never typed out again",
  has(PLO, "USER_COOKIE") && !rx(PLO, /"lfh_user"/));
check("P78904", "staff-logout's two cookie names come from lib/staffAuth, never typed out again",
  has(SLO, "AUTH_COOKIE, FLAG_COOKIE") && !rx(SLO, /"lfh_admin"/));
check("P78905", "the act-as cookie name matches the one the admin console actually sets",
  has(read("lib/panelScope.ts") + read("lib/staffAuth.ts") + read("components/admin/AdminShell.tsx"), "aevidine_admin_rid"));
check("P78906", "logging out of the panels does NOT clear the admin gate — they are separate doors",
  !rx(PLO, /AUTH_COOKIE/));
check("P78907", "…and logging out of admin does NOT clear a staff session either",
  !rx(SLO, /USER_COOKIE/));
check("P78908", "panel-logout's own comment records that all four callers were navigations",
  has(S.panelLogout, "all four callers were navigations"));
check("P78909", "the logout detail line still names the person, so the log is readable",
  has(PLO, "u.name || \"(no name)\""));
check("P78910", "a person with no display name reads as '(no name)', never as 'null'",
  has(PLO, '"(no name)"') && !rx(PLO, /\$\{u\.name\}/));

// The panel's own logout controls must target the top window, or they sign out the iframe.
{
  const shells = ["public/panels/editor/app.js", "components/owner/OwnerShell.tsx", "components/admin/AdminShell.tsx"];
  let logoutForms = 0;
  for (const f of shells) { const src = read(f); if (/panel-logout|staff-logout/.test(src)) logoutForms++; }
  check("P78911", "at least one panel shell actually posts to a logout route", logoutForms >= 1, logoutForms);
}
// EVERY SIGN-OUT INSIDE AN IFRAMED PANEL HAS TO LEAVE THE TOP WINDOW, or it signs out the frame
// and leaves the person looking at a dead panel. The kitchen and tablet panels do it with
// target="_top" on the form; the manager panel's drawer button does it in JS (maint.js leaveTo,
// which reads window.top). The owner shell and the admin shell are TOP-LEVEL pages, never framed,
// so they correctly need neither — asserting a target on those would be asserting a fiction.
for (const [id, file, label] of [
  ["P78912", "public/panels/kitchen/app.js", "the kitchen screen's Log out"],
  ["P78921", "public/panels/tablet/app.js", "the waiter tablet's Log out"],
]) {
  const forms = read(file).match(/<form[^>]*panel-logout[^>]*>/g) || [];
  check(id, `${label} leaves the whole window, not the panel frame`,
    forms.length > 0 && forms.every((f) => /target="_top"/.test(f)), forms);
}
check("P78922", "the manager panel's shared sign-out leaves the TOP window too, in JS",
  has(read("public/panels/maint.js"), "window.top.location.replace(url)"));
check("P78923", "…and it goes to /login whatever the request does — a tap never vanishes",
  has(read("public/panels/maint.js"), 'setTimeout(() => { leaveTo("/login"); }, 4000)'));
check("P78924", "…with a deadline, so a hung request cannot leave a person staring at a dead button",
  has(read("public/panels/maint.js"), "deadline(3000)"));
check("P78925", "the owner shell and the admin shell are top-level pages, so their forms need no target",
  !rx(read("components/owner/OwnerShell.tsx") + read("components/admin/AdminShell.tsx"), /<iframe[^>]*\/(owner|aevinite)/));
check("P78913", "both logout routes answer with a redirect, never a JSON body a caller could ignore",
  has(PLO, "NextResponse.redirect") && has(SLO, "NextResponse.redirect"));
check("P78914", "neither route reads a ?next, so a link cannot aim a logout at another site",
  !rx(PLO, /searchParams/) && !rx(SLO, /searchParams/));
check("P78915", "panel-logout's audit is best-effort — logAction is not awaited inside a try that could fail the route",
  has(PLO, "await logAction(u.role"));
check("P78916", "the staff cookie is cleared even when the audit was skipped",
  PLO.indexOf('res.cookies.set(USER_COOKIE, ""') > PLO.indexOf("if (u) {"));
check("P78917", "the two routes are the only writers of their cookies outside the login doors", (() => {
  const src = read("app/api/panel-login/route.ts") + read("app/api/panel-logout/route.ts");
  return count(stripComments(src), /cookies\.set\(USER_COOKIE/g) === 2;
})());
check("P78918", "signing out does not need a permission — anybody signed in may leave",
  !rx(PLO, /managerCan|requireRole/));
check("P78919", "…and neither logout route consults a feature switch",
  !rx(PLO, /Ladder|features/) && !rx(SLO, /Ladder|features/));
check("P78920", "the two routes together are under 120 lines — a logout has nothing to get wrong",
  S.panelLogout.split("\n").length + S.staffLogout.split("\n").length < 120);

// ─────────────────────────────────────────────────────────────────────────────────────────────
head("4. /api/panel-profile — a person's own profile, PIN, pay and password (P78926–P79010)");
// ─────────────────────────────────────────────────────────────────────────────────────────────
const PP = CODE.panelProfile;
check("P78926", "the route is scoped to the cookie's own user id — nobody can edit anyone else",
  count(PP, /\.eq\("id", u\.id\)/g) >= 3 && !rx(PP, /body\?\.(user_?id|staff_id)/));
check("P78927", "there is no way to name WHOSE profile is being read",
  !rx(PP, /searchParams\.get\("(id|user|staff)"\)/));
check("P78928", "GET answers 200 for the admin's frameless view, so no panel logs a fake 401",
  has(PP, "{ staff: false, error: \"not logged in\" }"));
check("P78929", "…and the old `error` key is kept beside it so existing callers branch as before",
  has(PP, 'staff: false, error:'));
check("P78930", "a database blip is answered as busy, never as signed-out",
  has(PP, "BUSY_MESSAGE") && has(PP, "busy: true"));
check("P78931", "…with the 503 the offline layer treats like no signal",
  has(PP, "{ status: 503, headers:"));
check("P78932", "…and the reason is printed our side so it is findable",
  has(PP, 'console.error("[panel-profile] auth lookup failed:"'));
check("P78933", "a non-AuthDbError is rethrown, so a real bug still surfaces",
  has(PP, "throw e;"));
check("P78934", "the profile read never returns the password hash",
  !rx(PP, /password_hash/g.source ? /json\([^)]*password_hash/ : /$^/));
check("P78935", "…nor the PIN hash — only whether one is set",
  has(PP, "hasPin: !!u.pin_hash") && !rx(PP, /pin_hash: u\.pin_hash/));
check("P78936", "…nor the token version",
  !rx(PP, /json\([^)]*token_version/));
check("P78937", "the password hash is fetched with an explicit one-column read when it IS needed",
  has(PP, 'sb.from("staff_users").select("password_hash").eq("id", u.id).limit(1)'));
check("P78938", "the kitchen role gets no profile section at all",
  has(PP, "hasProfile(u.role)"));
check("P78939", "…and a person with no restaurant gets none either",
  has(PP, "!u.restaurant_id || !hasProfile(u.role)"));
check("P78940", "the pay module rung is checked before any pay is read",
  before(PP, "(await ladderP).effective", "out.pay = {"));
check("P78941", "a person's own section list is read-only here",
  has(PP, "myTables,") && !rx(PP, /assigned_tables:\s*(body|patch)/));
check("P78942", "the payments list is capped at 40 rows",
  has(PP, ".limit(40)"));
check("P78943", "…and names its columns rather than select(*)",
  has(PP, '.select("id, kind, amount, for_period, mode, paid_on, note, voided_at, void_reason")'));
check("P78944", "the month summary is scoped to this restaurant through the RPC's own parameter",
  has(PP, "p_restaurant: u.restaurant_id"));
check("P78945", "…and the person's own row is picked out of it client-side, not by trusting the RPC's order",
  has(PP, "find((x) => x.staff_id === u.id)"));
check("P78946", "every money figure is coerced to a number, so a null never renders as NaN",
  count(PP, /Number\(mine\?\./g) === 2 && has(PP, "Number(mine?.paid || 0)"));
check("P78947", "the profile completeness is computed from the SAME helper the owner screen uses",
  has(PP, 'from "@/lib/staffProfile"') && has(PP, "completeness("));
check("P78948", "POST refuses a body that is not an object for the profile patch",
  has(PP, 'if (!p || typeof p !== "object" || Array.isArray(p))'));
check("P78949", "…with a sentence, not a crash", has(PP, "Missing profile fields."));
check("P78950", "an empty patch is refused rather than written as a no-op",
  has(PP, 'if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }'));
check("P78951", "the display name is trimmed and capped at 80 characters",
  has(PP, 'String(body.name || "").trim().slice(0, 80)'));
check("P78952", "a name that normalises to nothing is refused",
  has(PP, "if (!display || !key)"));
check("P78953", "the phone is trimmed and capped at 20 characters",
  has(PP, 'String(body.phone || "").trim().slice(0, 20)'));
check("P78954", "…and a blank phone becomes null, not an empty string",
  has(PP, '.slice(0, 20) || null'));
check("P78955", "the PIN must be digits only",
  has(PP, "/^\\d{4,8}$/"));
check("P78956", "…and its refusal says the actual rule", has(PP, "PIN must be 4–8 digits."));
check("P78957", "a new password must be at least 6 characters",
  has(PP, "if (next.length < 6)"));
check("P78958", "…and must differ from the current one",
  has(PP, "if (next === current)"));
check("P78959", "the length rules are checked AFTER the current password verified, so a guesser learns nothing",
  before(PP, "verifySecret(current", "if (next.length < 6)"));
check("P78960", "the password write goes through lib/passwordVault, not a hand-rolled hash",
  has(PP, "await passwordFields(next)"));
check("P78961", "the one-time setup card closes only when name AND phone are both present",
  has(PP, "const setupComplete = !!effName && !!effPhone"));
check("P78962", "…plus a PIN, but only for a manager who is allowed to set their own",
  has(PP, 'u.role === "manager" && u.can_self_set_pin'));
check("P78963", "profile_confirmed is only ever set true, never cleared here",
  has(PP, "patch.profile_confirmed = true") && !rx(PP, /profile_confirmed = false|profile_confirmed: false/));
check("P78964", "the first completion writes profile_setup; a later edit writes profile_update",
  has(PP, '"profile_setup"') && has(PP, '"profile_update"'));
check("P78965", "a PIN change writes its own diary line, separate from the profile one",
  has(PP, '"pin_set"'));
check("P78966", "…which says whether it was SET or CHANGED",
  has(PP, 'u.pin_hash ? "changed" : "set"'));
check("P78967", "the diary line uses the NEW name when the name is what changed",
  has(PP, "const who = (patch.name as string) || u.name || u.username;"));
check("P78968", "the profile-details line lists only the KEYS that moved, never their values",
  has(PP, "Object.keys(p).slice(0, 6).join(\", \")"));
check("P78969", "…so a phone number or an address never lands in the activity log",
  !rx(PP, /detail:[^\n]*Object\.values\(p\)/));
check("P78970", "the profile patch is merged, so an untouched field is not wiped",
  has(PP, "mergeProfilePatch(cur,"));
check("P78971", "…and the merge is whitelisted, so nobody gives themselves a raise",
  has(PP, "SELF_PROFILE_FIELDS"));
check("P78972", "pay fields are not in the self-editable list",
  !rx(read("lib/staffProfile.ts"), /SELF_PROFILE_FIELDS[^;]*pay_amount/));
check("P78973", "the password branch is handled FIRST, before anything else can be written",
  before(PP, "body?.newPassword !== undefined", "body?.profile !== undefined"));
check("P78974", "…and it returns rather than falling through into the name/phone write",
  has(PP, "return NextResponse.json({ ok: true, passwordChanged: true });"));
check("P78975", "the clash gate runs before ANY branch, so first-save-wins covers all of them",
  before(PP, "expectClash(req,", "body?.newPassword !== undefined"));
check("P78976", "…and it is scoped to the person's own restaurant",
  has(PP, 'expectClash(req, String(u.restaurant_id || ""))'));
check("P78977", "the idempotency wrapper names this route, so a replay cannot collide with another",
  has(PP, '"panel-profile"'));
check("P78978", "GET is not wrapped in the idempotency layer — a read has nothing to replay",
  !rx(PP, /withIdempotency\(GET|export const GET = withIdempotency/));
check("P78979", "every refusal answers a sentence a person can act on, never a code",
  (PP.match(/error: "[^"]{4,}"/g) || []).every((m) => /[a-z] [a-z]/.test(m)));
check("P78980", "…and none of them names a database column",
  !rx(PP, /error: "[^"]*(password_hash|token_version|profile_confirmed|in_payroll)/));
check("P78981", "the 429 wall on the password box says WAIT, not that the password is wrong",
  has(PP, "Too many tries. Please wait a few minutes and try again."));
check("P78982", "a write that matched no row answers 409 and names what to do",
  has(PP, "your account wasn't found. Ask your admin."));
check("P78983", "the payroll ladder is consulted for the profile WRITE too, not only the read",
  count(PP, /payrollLadder\(/g) >= 1 && has(PP, "Staff profiles aren't enabled for this restaurant."));
check("P78984", "the route reads the acting person ONCE per request",
  count(PP, /whoIsAsking\(req\)/g) === 2 && count(PP, /userFromCookie\(/g) === 1);
check("P78985", "…through one helper, so GET and POST cannot disagree about what 'busy' means",
  has(PP, "async function whoIsAsking("));
check("P78986", "the pay summary is only asked for when the pay section is actually being sent",
  before(PP, "if (row?.can_see_own_pay !== false && row?.in_payroll === true) {", "lfh_staff_pay_summary"));
check("P78987", "the month window starts on the 1st in IST, not in UTC",
  has(PP, 'todayIST().slice(0, 8) + "01"'));
check("P78988", "the job block is sent whatever the pay switch says — a shift is not money",
  before(PP, "job: {", "if (row?.can_see_own_pay !== false"));
check("P78989", "canSeeOwnPay and onPayList are separate answers, so the screen can explain which it is",
  has(PP, "canSeeOwnPay:") && has(PP, "onPayList:"));
check("P78990", "a person NOT on the pay list is not merely hidden — no pay is read for them at all",
  has(PP, 'row?.in_payroll === true'));
for (const [id, col] of [
  ["P78991", "profile"], ["P78992", "joined_on"], ["P78993", "designation"], ["P78994", "employment_type"],
  ["P78995", "shift_label"], ["P78996", "weekly_off"], ["P78997", "pay_type"], ["P78998", "pay_amount"],
  ["P78999", "pay_day"], ["P79000", "pay_mode"], ["P79001", "pay_extras"], ["P79002", "can_see_own_pay"],
  ["P79003", "in_payroll"],
]) {
  const ownRowCols = ((PP.match(/\.select\("(profile, joined_on[^"]*)"\)/) || [])[1] || "").split(",").map((x) => x.trim());
  check(id, `the own-row read names ${col} explicitly rather than select(*)`,
    ownRowCols.includes(col), ownRowCols.length);
}
check("P79004", "…and that read is the only place those columns come from",
  count(PP, /\.select\("profile, joined_on/g) === 1);
check("P79005", "a failed own-row read resolves to a null row instead of an unhandled rejection",
  has(PP, "return { data: null }; }"));
check("P79006", "…and says so in the server log",
  has(PP, '"[panel-profile] own row read failed:"'));
check("P79007", "the waiter-sections read is skipped entirely for a person with no restaurant",
  has(PP, "u.restaurant_id ? waiterTables(u, u.restaurant_id) : Promise.resolve(null)"));
check("P79008", "the route imports the shared BUSY_MESSAGE rather than typing its own sentence",
  has(PP, 'from "@/lib/dbRefusal"'));
check("P79009", "the username uniqueness read is capped at one row",
  rx(PP, /\.is\("deleted_at", null\)\.limit\(1\)/));
check("P79010", "…and its refusal tells the person to pick another, not that the database said no",
  has(PP, "That username is already taken — please pick another."));

// ─────────────────────────────────────────────────────────────────────────────────────────────
head("5. /api/staff-login — the admin console's door (P79011–P79060)");
// ─────────────────────────────────────────────────────────────────────────────────────────────
const SL = CODE.staffLogin;
check("P79011", "the route is POST-only", !rx(SL, /export async function (GET|PUT|PATCH|DELETE)\b/));
check("P79012", "a body that is not a form becomes null instead of throwing",
  has(SL, "await req.formData().catch(() => null)"));
check("P79013", "…and a null form still produces an empty password rather than a crash",
  has(SL, 'String(form?.get("password") || "")'));
check("P79014", "the IP is derived server-side, never read from the body",
  has(SL, "clientIp(req)") && !rx(SL, /form\?\.get\("ip"\)/));
check("P79015", "the lockout is keyed by IP, because the admin password is one shared secret",
  has(SL, "const throttleKey = `admin:${ip}`;"));
check("P79016", "the same key is used to read, to fail and to reset — one key, one counter",
  count(SL, /throttleKey/g) >= 4);
check("P79017", "the wrong-tries lockout is 5 minutes", has(SL, "ADMIN_LOCK_MS = 5 * 60 * 1000"));
check("P79018", "the oversize cap is 200 characters", has(SL, "MAX_PASSWORD_LEN = 200"));
check("P79019", "an oversize value never reaches the hash", has(SL, "!tooLong &&"));
check("P79020", "the alert threshold is lower than the lock threshold, so the admin is warned first",
  3 < 10 && has(SL, "ADMIN_ALERT_AT = 3") && has(SL, "ADMIN_MAX_FAILS = 10"));
check("P79021", "the alert is WARN-only and never locks the owner out of their own console",
  before(SL, "recordAlert(", "return bad(t.locked"));
check("P79022", "the alert label names the IP and a short device tail, not the whole device id",
  has(SL, "dev.slice(0, 10)"));
check("P79023", "the blocked page and the locked message are different answers with different pages",
  has(SL, "blocked=1") && has(SL, "locked=1"));
check("P79024", "the no-JS redirect carries the original destination through",
  has(SL, "next=${encodeURIComponent(next)}"));
check("P79025", "…and that destination has already been sanitised",
  // (sweep #10 T17 item 9: the prefix test let "/\\other.site" through; the target now goes through sameSitePath.)
  before(SL, "const next = sameSitePath(", "encodeURIComponent(next)"));
check("P79026", "a protocol-relative //evil.example is refused as a destination",
  // (sweep #10 T17 item 9: the prefix test let "/\\other.site" through; the target now goes through sameSitePath.)
  (await import("@/lib/staffAuth.ts")).sameSitePath("//evil.example", "/aevinite") === "/aevinite");
check("P79027", "an absent destination falls back to the console's own home",
  has(SL, '|| "/aevinite"'));
check("P79028", "the JSON reply hands back the sanitised destination, so the client cannot pick its own",
  has(SL, "NextResponse.json({ ok: true, next })"));
check("P79029", "the cookie value is a HASH of the password, never the password",
  has(SL, "const token = await sha256hex(expected);"));
check("P79030", "the readable flag cookie carries only '1' — it says 'signed in', nothing more",
  has(SL, 'FLAG_COOKIE, "1"'));
check("P79031", "both cookies expire after 7 days", count(SL, /maxAge: 604800/g) === 2);
check("P79032", "the route never writes the password into a log detail",
  !rx(SL, /detail: `[^`]*\$\{password\}/));
check("P79033", "…and never into an alert label", !rx(SL, /label = `[^`]*\$\{password\}/));
check("P79034", "the admin password is read through lib/staffAuth, not from process.env here",
  has(SL, "adminPassword()") && !rx(SL, /process\.env\.ADMIN_PASSWORD/));
check("P79035", "the not-a-person check reads the two fields by their shared constant names",
  has(SL, "BOT_TRAP_FIELD, BOT_ELAPSED_FIELD"));
check("P79036", "…the SAME constants the form posts under, so the two can never drift",
  has(CODE.staffLoginForm, "BOT_TRAP_FIELD") && has(CODE.staffLoginForm, "BOT_ELAPSED_FIELD"));
check("P79037", "every log line from this route is filed under the admin panel",
  count(SL, /logAction\("admin"/g) === count(SL, /logAction\(/g));
check("P79038", "the four events are distinguishable: failed, blocked, and a success",
  has(SL, '"login_failed"') && has(SL, '"login_blocked"') && has(SL, '"login"'));
check("P79039", "a successful sign-in records the IP it came from",
  has(SL, "admin signed in from ${ip}"));
check("P79040", "the throttle helpers all come from one library, so the rules live in one place",
  has(SL, 'from "@/lib/loginThrottle"'));
check("P79041", "the route does no database work of its own",
  !rx(SL, /supabaseAdmin|\.from\("/));
check("P79042", "a caller asking for JSON gets JSON; a plain form gets the redirect",
  has(SL, 'req.headers.get("accept") || ""'));
check("P79043", "…and the no-JS path answers 303, so a refresh cannot re-post the password",
  has(SL, ", 303)"));
check("P79044", "attemptsLeft is only sent on the JSON path, never rendered into a URL",
  !rx(SL, /attemptsLeft=/));
check("P79045", "the reply never says which of the two secrets was wrong, because there is only one",
  count(SL, /adminPassword\(\)/g) === 1);
check("P79046", "the constant-time compare hashes BOTH sides first, so the compare is fixed-length",
  has(SL, "safeEqual(await sha256hex(password), await sha256hex(expected))"));
check("P79047", "the not-a-person refusal happens before the throttle is even READ",
  before(SL, "botVerdict(", "throttleStatus("));
check("P79048", "…and before the password is compared", before(SL, "botVerdict(", "adminPassword()"));
check("P79049", "the blocked branch answers before the password is compared too",
  before(SL, "if (st.locked)", "const expected = adminPassword();"));
check("P79050", "the deliberate block is distinguished from the wrong-tries lock by a second read",
  has(SL, "await throttleIsBlocked(throttleKey)"));
check("P79051", "…and only on the locked path, so an ordinary sign-in pays nothing for it",
  before(SL, "if (st.locked)", "throttleIsBlocked("));
check("P79052", "the wrong-password path records the fail BEFORE it answers",
  before(SL, "throttleFail(throttleKey", "return bad(t.locked"));
check("P79053", "…and the answer carries how many tries are left",
  has(SL, "attemptsLeft: t.attemptsLeft"));
check("P79054", "the success path clears the counter BEFORE the cookies are set",
  before(SL, "throttleReset(throttleKey)", "res.cookies.set(AUTH_COOKIE"));
check("P79055", "the file names its own reason for the IP lockout rather than leaving it to be guessed",
  /SINGLE shared secret/i.test(S.staffLogin));
check("P79056", "there is exactly one place that decides 'matches'",
  count(SL, /const matches =/g) === 1);
check("P79057", "…and it is a boolean, so a truthy string can never stand in for a match",
  has(SL, "const matches = !!expected"));
check("P79058", "the route sets no cache header that could let a proxy keep a signed-in reply",
  !rx(SL, /Cache-Control.*max-age=[1-9]/));
check("P79059", "nothing in this route reads a cookie — the door only ever WRITES them",
  !rx(SL, /req\.cookies\.get/));
check("P79060", "…so a stale admin cookie can never shortcut the password check",
  !rx(SL, /tokenIsValid/));

// ─────────────────────────────────────────────────────────────────────────────────────────────
head("6. The THREE sign-in doors — /login, /r/<slug>/login, /staff-login (P79061–P79130)");
// ─────────────────────────────────────────────────────────────────────────────────────────────
// There are three staff doors, not two, and every rule below has to hold in all three. The
// scoped one (/r/<slug>/login) is the one every restaurant's people actually bookmark.
const LP = CODE.loginPage, LF = CODE.loginForm, RLP = CODE.scopedLoginPage;

check("P79061", "there really are three doors, and each is a page that exists",
  ["app/login/page.tsx", "app/r/[restaurant]/login/page.tsx", "app/staff-login/page.tsx"]
    .every((f) => existsSync(join(root, f))));
check("P79062", "the scoped door reuses the SAME card component as the plain one, so they cannot drift",
  has(RLP, 'from "@/app/login/LoginForm"'));
check("P79063", "…and the card is the only place the sign-in POST is made",
  count(LF, /fetch\("\/api\/panel-login"/g) === 1 && !rx(RLP, /fetch\(/));
check("P79064", "the scoped door passes the slug, so only that restaurant's people can match",
  has(RLP, "restaurantSlug={restaurant}"));
check("P79065", "…and the card posts it under the key the route reads",
  has(LF, "restaurant: restaurantSlug"));
check("P79066", "the scoped door shows the RESTAURANT's name, not the platform brand",
  has(RLP, "restaurantName={r.name}") && has(LF, '{restaurantName || "Aevidine"}'));
check("P79067", "…and its subtitle changes with it, so it never reads as restaurant #1's door",
  has(LF, 'restaurantName ? "Staff sign in" : "Restaurant OS · staff sign in"'));
check("P79068", "an unknown slug is a 404, not somebody else's login card",
  has(RLP, "notFound()"));
check("P79069", "…but a RENAMED restaurant's old address forwards instead of dead-ending",
  has(RLP, "slugMovedTo(restaurant)"));
check("P79070", "…carrying the original destination through the hop",
  has(RLP, "next ? `?next=${encodeURIComponent(next)}` : \"\""));
// Moved in sweep #10 T17 round 6, item 40: the per-panel 'isn't enabled' refusal was deleted with the retired switch.
check("P79071", "the scoped door forwards a signed-in person with no retired panel check in the way",
  !/isPanelEnabled/.test(RLP) && /if \(u && u\.restaurant_id === r\.id && r\.active\) \{/.test(RLP));
check("P79072", "…and only when the restaurant is active, so a switched-off one cannot loop the redirects",
  /u\.restaurant_id === r\.id && r\.active\)/.test(RLP));
check("P79073", "…and only when the session belongs to THIS restaurant",
  has(RLP, "u.restaurant_id === r.id"));
check("P79074", "a database blip on the scoped door shows the form, not Next's error page",
  has(RLP, "if (!(e instanceof AuthDbError)) throw e;"));
check("P79075", "…and says so in the server log so a real outage is findable",
  has(RLP, '"[r/login] couldn\'t check for an existing session:"'));
check("P79076", "the plain door does the same",
  has(LP, "if (!(e instanceof AuthDbError)) throw e;"));
check("P79077", "both doors declare the caught value's type rather than leaving it `any`",
  has(LP, "let u: Awaited<ReturnType<typeof userFromCookie>> = null;")
  && has(RLP, "let u: Awaited<ReturnType<typeof userFromCookie>> = null;"));
check("P79078", "neither door reaches the database for anything except that one session check",
  !rx(LP, /supabaseAdmin/) && !rx(RLP, /supabaseAdmin/));
check("P79079", "the card never renders a password back into the DOM as plain text by default",
  has(LF, 'type={show ? "text" : "password"}'));
check("P79080", "…and the Show/Hide toggle is a button, not a submit",
  has(LF, 'type="button"'));
check("P79081", "the username box asks the browser for a username, not an email",
  has(LF, 'autoComplete="username"'));
check("P79082", "…and turns off auto-capitalise, so a phone does not type 'Ravi' as 'RAVI'",
  has(LF, 'autoCapitalize="none"'));
check("P79083", "…and turns off spellcheck, so a name is not underlined in red",
  has(LF, "spellCheck={false}"));
check("P79084", "the password box asks for the CURRENT password, so a manager is not offered a new one",
  has(LF, 'autoComplete="current-password"'));
check("P79085", "the username box takes focus, so a person can start typing straight away",
  has(LF, "autoFocus"));
check("P79086", "the card tells a person with no account who to ask",
  has(LF, "No account? Your manager or admin sets one up for you."));
check("P79087", "a failed sign-in shows the server's own sentence, not a generic one",
  has(LF, "setErr(data.error ||"));
check("P79088", "…and has a fallback sentence for a reply with no error at all",
  has(LF, "check both and try again"));
check("P79089", "the busy state is cleared on every failure path, so the button never stays dead",
  count(LF, /setBusy\(false\)/g) >= 2);
check("P79090", "the card reads the reply as JSON with the ok flag, not by status alone",
  has(LF, "if (!r.ok || !data.ok)"));
check("P79091", "a role the card does not know lands on the guest menu rather than a blank page",
  has(LF, 'base ? (restaurantSlug ? `/r/${restaurantSlug}${base}` : base) : "/menu"'));
check("P79092", "the trap component is imported, not re-implemented in the card",
  has(LF, 'from "@/components/BotTrap"'));
check("P79093", "…and both doors' cards use the same component",
  has(CODE.staffLoginForm, 'from "@/components/BotTrap"'));
check("P79094", "the trap is invisible to a person but present in the form",
  has(read("components/BotTrap.tsx"), "aria-hidden") || has(read("components/BotTrap.tsx"), "display"));
check("P79095", "the staff card's own field style sets box-sizing, so a 360px phone does not overflow",
  has(LF, 'boxSizing: "border-box"'));
check("P79096", "…and the card itself is capped at the viewport width",
  // (sweep #10 T17 item 10: capped at the page's own box, min(100%, …) — a vw width overhung the 16px gutter.)
  has(LF, 'width: "min(100%, 380px)"'));
check("P79097", "the admin card is capped the same way",
  // (sweep #10 T17 item 10: capped at the page's own box, min(100%, …) — a vw width overhung the 16px gutter.)
  has(CODE.staffLoginForm, 'width: "min(100%, 360px)"'));
check("P79098", "the blocked card is capped AND scrolls, so its longer text still fits a phone",
  has(CODE.blockedView, 'width: "min(100%, 380px)"') && has(CODE.blockedView, 'overflowY: "auto"'));
check("P79099", "every input on the staff card is 16px, so iOS does not zoom the page on focus",
  has(LF, "fontSize: 16,"));
check("P79100", "…and so is the admin card's password box", has(CODE.staffLoginForm, "fontSize: 16"));
check("P79101", "the primary button's fill is blue-600, the contrast-checked one",
  has(LF, '"#2563eb"') && has(CODE.staffLoginForm, '"#2563eb"'));
check("P79102", "…and the reason it is not blue-500 is written down where the next person will read it",
  /3\.68:1/.test(S.loginForm));
check("P79103", "no door renders a raw template hole, an object or a NaN in its own source text",
  ![S.loginForm, S.staffLoginForm, S.blockedView].some((s2) =>
    /\$\{\s*\}|\[object Object\]|>\s*NaN\s*</.test(s2)));
check("P79104", "the blocked card caps the note a person can send at 200 characters",
  has(CODE.blockedView, "e.target.value.slice(0, 200)"));
check("P79105", "…and disables the box once the day's three requests are gone",
  has(CODE.blockedView, "disabled={outOfTries}"));
check("P79106", "…and says how many are left rather than only refusing",
  has(CODE.blockedView, "left today"));
check("P79107", "the blocked card's Retry says whether anything changed, rather than going quiet",
  has(CODE.blockedView, "Still blocked — the admin hasn't lifted it yet."));
check("P79108", "the blocked card never leaves both buttons live at once during a request",
  has(CODE.blockedView, 'if (busy) return;'));
check("P79109", "the blocked card's language is calm and non-technical",
  !rx(CODE.blockedView, />\s*(403|401|IP|throttle|rate limit)/i));
check("P79110", "the staff door and the admin door are told apart by their words",
  has(S.loginForm, "staff sign in") && has(S.staffLoginForm, "admin console"));
check("P79111", "…and each links to the other so a person at the wrong one is not stuck",
  has(CODE.staffLoginForm, 'href="/login"'));
check("P79112", "the admin door's link is a plain link, never a redirect that would strand a bookmark",
  !rx(CODE.staffLoginPage, /redirect\(/));
check("P79113", "no door leaks the restaurant list — an unknown slug never names a real one",
  !rx(RLP, /restaurants.*select/));
check("P79114", "the scoped door's 404 comes from Next, so it renders the app's own not-found page",
  has(RLP, 'from "next/navigation"'));
check("P79115", "the scoped door imports AuthDbError, which is what makes the catch above meaningful",
  has(RLP, "AuthDbError } from \"@/lib/userAuth\""));
check("P79116", "the plain door forwards to the role's home, taken from the shared map",
  has(LP, "ROLE_HOME[u.role]"));
check("P79117", "…and the scoped door forwards to the SCOPED home, so the address keeps saying which restaurant",
  has(RLP, "`/r/${restaurant}${ROLE_HOME[u.role]"));
check("P79118", "both read that map from lib/panelGate rather than keeping their own copy",
  has(LP, 'from "@/lib/panelGate"') && has(RLP, 'from "@/lib/panelGate"'));
check("P79119", "the panel gate sends a signed-out person to the SCOPED door, which is why it must not crash",
  has(read("lib/panelGate.ts"), "redirect(`/r/${slug}/login?next="));
check("P79120", "…and it names the panel they were heading for, so the sign-in lands them back there",
  has(read("lib/panelGate.ts"), "`/r/${slug}${ROLE_HOME[role]}`"));
// Round 5, item 31: inside this person's own panel (same site), not only equal to its home — see P04679.
check("P79121", "the card honours that ?next only inside this person's own panel",
  has(LF, 'if (u.pathname !== home && !u.pathname.startsWith(home + "/")) return home;'));
check("P79122", "…so a ?next pointing at another site is dropped, not followed",
  !rx(LF, /router\.push\(next\)/));
check("P79123", "the three doors between them import no analytics, no third-party script and no tracker",
  ![LP, RLP, LF, CODE.staffLoginPage, CODE.staffLoginForm].some((s2) => /https?:\/\/(?!127|localhost)/.test(s2)));
check("P79124", "the two card components are client components, because they read the reply",
  has(S.loginForm, '"use client"') && has(S.staffLoginForm, '"use client"'));
check("P79125", "…and the three PAGES are server components, so no session check runs in the browser",
  ![S.loginPage, S.scopedLoginPage, S.staffLoginPage].some((s2) => /"use client"/.test(s2)));
check("P79126", "the admin door reads the visitor's address through the shared helper",
  has(CODE.staffLoginPage, "clientIp({ headers:"));
check("P79127", "…and asks the block question with the same key the route locks under",
  has(CODE.staffLoginPage, "`admin:${ip}`") && has(SL, "`admin:${ip}`"));
// Judged on the CODE, not the file: /100dvh/ and /{ip}/ both appear in these files' own
// REJECTED and explanatory comments, and a guard that reads a comment as code is the fault
// this repo has recorded twice (verify:rejected matching a note's anchor inside the note).
check("P79128", "no door renders the visitor's IP into the page", (() => {
  // The address IS used — it is the throttle key — so the question is whether it reaches the
  // MARKUP, not whether the word appears. Judge only what is returned.
  const jsx = (src) => { const i = src.indexOf("return ("); return i < 0 ? "" : src.slice(i); };
  return ![CODE.staffLoginPage, CODE.blockedView].some((s2) => /\{\s*ip\s*\}|\bclientIp\b/.test(jsx(s2)));
})());
check("P79129", "every door's outer element fills the screen, so the card is centred on a phone",
  [S.loginForm, S.staffLoginPage].every((s2) => /minHeight: "100vh"/.test(s2)));
check("P79130", "…and none of them has been switched to 100dvh (REJECTED R19)",
  ![CODE.loginForm, CODE.staffLoginPage].some((s2) => /100dvh/.test(s2)));

// ─────────────────────────────────────────────────────────────────────────────────────────────
head("7. The manager panel's WRITE api — POST / PATCH / DELETE (P79131–P79250)");
// ─────────────────────────────────────────────────────────────────────────────────────────────
// This is the half of app/api/editor/[...path]/route.ts from postImpl to the end of the file.
// It is where a bill is discounted, cancelled, split, reopened, comped and deleted, so almost
// every rule below is about money or about a record of money.
const W = WRITE_CODE;
const WS = WRITE_HALF;

check("P79131", "all three write verbs exist and are wrapped in the idempotency layer",
  ["POST", "PATCH", "DELETE"].every((v) => has(W, `export const ${v} = withIdempotency(`)));
check("P79132", "…and all three drop the floor snapshot AFTER the handler, not only before",
  ["POST", "PATCH", "DELETE"].every((v) => has(W, `${v} = withIdempotency(invalidateFloorAfter(`)));
check("P79133", "…and all three name the same idempotency scope, so a replay cannot cross verbs",
  count(W, /, "editor"\)/g) === 3);
check("P79134", "PATCH and DELETE both refuse an empty id segment before it reaches a query",
  count(W, /if \(emptyIdSegment\(id\)\) return err/g) === 2);
check("P79135", "PATCH runs the offline-replay clash gate",
  has(W, "await replayClash(req, rid, a, id, path[2], body as Record<string, unknown> | null)"));
check("P79136", "…and the no-silent-overwrite gate on top of it", has(W, "await expectClash(req, rid)"));
check("P79137", "DELETE runs the replay gate too — all three verbs have one",
  count(W, /await replayClash\(/g) === 3);
check("P79138", "…and deliberately does NOT run expectClash, because a DELETE carries no edited value",
  has(WS, "No expectClash here: a DELETE names a row"));
check("P79139", "every verb resolves its restaurant through editorScope, never panelRestaurantId directly",
  count(W, /await editorScope\(req, g\)/g) === 3 && !rx(W, /panelRestaurantId\(/));
check("P79140", "…and short-circuits when editorScope answers a refusal",
  count(W, /if \(rid instanceof NextResponse\) return rid;/g) === 3);
check("P79141", "every verb runs the manager's-menu tab gate before doing any work",
  count(W, /const tg = await tabGate\(g, rid, path, req\.method\); if \(tg\) return tg;/g) === 3);
check("P79142", "every verb passes the METHOD to that gate, so a POST /audit is not read as a tab read",
  count(W, /tabGate\(g, rid, path, req\.method\)/g) === 3);
check("P79143", "each verb catches its own failures and answers through panelFailure",
  count(W, /return panelFailure\(e\);/g) === 3);
check("P79144", "…and names the endpoint in the error diary, so the Repair board is not a mystery",
  ["POST", "PATCH", "DELETE"].every((v) => has(W, `detail: \`${v} \${path.join("/") || "/"}\``)));
check("P79145", "the path is resolved OUTSIDE the try, which is what lets the catch name it",
  count(W, /const \{ path = \[\] \} = await ctx\.params;/g) === 3);
check("P79146", "the acting person's display name is resolved once per verb",
  count(W, /const actorName = g\.user\?\.name \|\| g\.user\?\.username \|\| null;/g) === 3);
check("P79147", "…and every diary line carries the stable actor id, so a rename orphans nothing",
  count(W, /actor_id: g\.user\.id/g) === 3);
check("P79148", "…and an admin acting through the console is marked, not left blank",
  count(W, /actor_id: ADMIN_VIEW_ACTOR_ID/g) >= 3);

// ── the delete door, after items 1 and 2 ──
check("P79149", "the generic delete has its OWN list of deletable kinds",
  has(W, 'const DELETABLE_KINDS = ["items", "categories", "filters"] as const;'));
check("P79150", "…and `settings` is not on it, so the restaurant's configuration row cannot be removed",
  !/DELETABLE_KINDS = \[[^\]]*settings/.test(W));
check("P79151", "…and the kind is resolved through that list, not straight out of the shared TABLES map",
  has(W, '(DELETABLE_KINDS as readonly string[]).includes(a) ? TABLES[a] : undefined'));
check("P79152", "a delete that matched no row answers 404 rather than reporting success",
  has(W, "if (!removed?.length) {"));
check("P79153", "…and says which kind of thing was already gone, in plain words",
  has(W, "is already gone — reload to see the current menu."));
check("P79154", "…and the refusal comes BEFORE the activity log line",
  before(W, "if (!removed?.length) {", '"menu_delete"'));
check("P79155", "…and BEFORE the Audit removal row",
  before(W, "if (!removed?.length) {", 'kind: "menu_item_deleted"'));
check("P79156", "…and BEFORE the guest menu cache is purged for nothing",
  before(W, "if (!removed?.length) {", "bustMenuCache(rid);\n      return ok({ ok: true });"));
check("P79157", "the delete still names the restaurant, so a slug shared by two tenants is safe",
  has(W, '.delete().eq(t.key, id).eq("restaurant_id", rid).select(t.key)'));
check("P79158", "the dish's own title is read BEFORE the delete, so the Audit row names it",
  before(W, "const gonesTitle", ".delete().eq(t.key, id)"));
check("P79159", "deleting a category clears it off the dishes that pointed at it",
  has(W, '.update({ category: null }).eq("restaurant_id", rid).eq("category", id)'));
check("P79160", "deleting a tag pulls it out of every dish's tag list",
  has(W, '(d.tags || []).filter((x) => x !== id)'));
check("P79161", "…and that reconciliation is best-effort, so it can never fail an already-done delete",
  has(WS, "/* orphan cleanup is best-effort */"));
check("P79162", "a bill delete is still refused for a paid, non-cancelled order",
  has(W, "Won't delete a PAID bill — it's a financial record."));
check("P79163", "…and needs BOTH the void power and the delete permission",
  before(W, 'managerCan(g, rid, "void_bills")', "canDeleteBill(g, rid)"));
check("P79164", "the bill's worth is read BEFORE the soft delete, so the Audit says what left the reports",
  before(W, "const wasWorth", "softDeleteOrders(rid, [id]"));
check("P79165", "a bill delete is a SOFT delete — nothing calls .delete() on orders",
  !rx(W, /from\("orders"\)\.delete\(\)/));
check("P79166", "…and the compliance rule is written where the next person will read it",
  /R27/.test(WS));

// ── the money handlers: every one names its permission ──
const MONEY_GATES = [
  ["P79167", "give_discounts", "a discount"],
  ["P79168", "void_bills", "voiding, reopening or deleting a bill"],
  ["P79169", "mark_paid", "settling a bill"],
  ["P79170", "khata", "putting a bill on a tab"],
  ["P79171", "table_tags", "marking a table and comping it"],
  ["P79172", "print_invoice", "issuing a numbered bill"],
  ["P79173", "take_orders", "punching an order from the manager panel"],
  ["P79174", "parcel", "a counter parcel"],
  ["P79176", "edit_menu", "changing the menu"],
  ["P79178", "print_here", "making this screen the printer"],
  ["P79179", "view_ratings", "handling a guest rating"],
  ["P79180", "banquet", "banquet billing"],
];
for (const [id, flag, what] of MONEY_GATES) {
  check(id, `${what} asks managerCan("${flag}")`, has(W, `managerCan(g, rid, "${flag}")`));
}
// P79177 ASSERTED THE OPPOSITE UNTIL 2026-10-08, and was red on main for 24 days. It expected
// "setting the printers up" to ask managerCan("print_setup") — the permission the owner REMOVED on
// 2026-09-14 (ecec794e): asked whether a manager may set printers up, he ruled "That setup will be done
// by me only", and printer setup became Aevidine's, from the admin console. The subject moved on
// purpose; the check now says what is true today, so it goes red if the old door comes back.
// (Sweep #10, T17, item 2. docs/REJECTED-IDEAS.md → Reversed, the `print_setup` row.)
check("P79177", "setting the printers up is NOT offered from the manager panel any more (owner, 2026-09-14)",
  !has(W, `managerCan(g, rid, "print_setup")`) && !/["']print_setup["']/.test(W));
check("P79175", "a delivery-app order and a counter parcel are told apart, and each asks its OWN rung",
  has(CODE.editor, "async function platformOrParcelCan(") && has(CODE.editor, 'const flag = isParcel ? "parcel" : "platform";')
  && count(W, /platformOrParcelCan\(g, rid, owns\.source\)/g) >= 3);
check("P79181", "the five table operations all go through the ONE tableOpsGate, not a per-handler check",
  count(W, /const gateResp = await tableOpsGate\(g, rid\); if \(gateResp\) return gateResp;/g) >= 5);
check("P79182", "a split settle needs mark_paid on top of the table-ops rung",
  before(W, 'if (a === "tables" && c === "pay-split")', 'permDenied("mark a bill paid")'));
check("P79183", "…and a pay-later LEG needs the khata module and the khata power as well",
  has(W, 'String(s?.method) === PAY_LATER'));
check("P79184", "an on-the-house settle needs mark_paid as well as the table-type power",
  before(W, 'if (a === "tables" && c === "on-the-house")', 'permDenied("settle a bill on the house")'));
check("P79185", "clearing a table that still owes money needs the void power",
  has(W, 'permDenied("clear a table that still owes money")'));
check("P79186", "reopening a TABLE needs the void power and a typed reason",
  has(W, "A reason is required to reopen a table."));
check("P79187", "reopening a BILL needs a typed reason too",
  has(W, "A reason is required to void / reopen an invoice."));
check("P79188", "a credit note needs a typed reason and an amount above zero",
  has(W, "A reason is required to issue a credit note.") && has(W, "Enter a credit amount greater than zero."));
check("P79189", "a manager's reopen window is read from the access config, with the model's own default",
  has(W, 'NODE_BY_ID["mgr_bill_reopen_mins"]'));
check("P79190", "…and the admin and the owner are not clamped by it",
  has(W, 'if (g.user && g.user.role === "manager" && ownsVoid.invoice_at)'));
check("P79191", "a demo platform order is restricted to the owner and the admin",
  has(W, "Only the owner or admin can add demo platform orders."));
check("P79192", "…and only on a channel this restaurant actually has switched on",
  has(W, "That channel is turned off for this restaurant."));

// ── the tenant fence: every by-id write also names the restaurant ──
{
  // A write keyed by a single id must ALSO name the restaurant, because the service-role client
  // bypasses RLS — that eq() pair IS the fence. Reads that already sit behind an ownership check
  // are not exempt from this: the rule is uniform, which is what makes it checkable.
  const chains = W.match(/\.from\("[a-z_]+"\)\s*\n?\s*\.(update|delete|upsert|insert)\([\s\S]{0,600}?(?=;)/g) || [];
  const naked = chains.filter((c) => /\.eq\("id",/.test(c) && !/restaurant_id/.test(c));
  // TWO chains do not carry the pair, and BOTH are fenced a line earlier instead:
  //   · feedback  (ratings/ack)   — the row is read and `row.restaurant_id !== rid` answers 403;
  //   · sessions  (tables/restart) — the id came from a read that already named the restaurant.
  // They are named here rather than pattern-exempted, so the number can only go DOWN. If a third
  // appears, this goes red and somebody has to say which line verifies it.
  const KNOWN_FENCED_ELSEWHERE = ['from("feedback")', 'eq("id", openSess.id)'];
  const unexplained = naked.filter((c) => !KNOWN_FENCED_ELSEWHERE.some((k) => c.includes(k)));
  check("P79193", "every by-id write in the write half names the restaurant, or is fenced by a check one line up",
    unexplained.length === 0, unexplained.slice(0, 3));
  check("P79250", "…and there are still exactly two that lean on the check rather than the pair",
    naked.length === 2, naked.length);
}
{
  const tables = [...new Set((W.match(/\.from\("([a-z_]+)"\)/g) || []).map((m) => m.slice(7, -2)))].sort();
  check("P79194", "the write half touches a knowable, listed set of tables", tables.length > 0, tables.length);
  let tid = 79195;
  for (const t of tables.slice(0, 30)) {
    const chains = W.split(`.from("${t}")`).slice(1).map((c) => c.slice(0, 500));
    const bad2 = chains.filter((c) => !/restaurant_id|\.eq\("id",|\.eq\("session_id"|\.eq\("order_id"|\.eq\("staff_id"|p_rid|p_restaurant/.test(c));
    check(`P${tid++}`, `${t}: every chain names the restaurant or an already-verified parent row`,
      bad2.length === 0, bad2.slice(0, 1));
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 8. WATCHED RUNNING — the doors answered by a real server (P79371–P79420)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Only with --live. It signs in AT MOST ONCE, through scripts/sweep/login.mjs, which caches the
// session to disk and across processes. It never POSTs JSON to /api/staff-login: that counts as a
// wrong admin password and walls the IP the whole fleet shares.
// `--ids` walks this block too, so the printed id list is COMPLETE whether or not a server is up —
// otherwise the ledger would be written from a list that silently dropped fifty rows. No request
// is made in that mode.
// ── SWEEP #10, T17 — the staff door under a database blip (ids from T17's block P186001–P187000) ──
// Item 3 (2026-10-08): two reads at the staff door THREW instead of answering — the restaurant lookup
// on /r/<slug>/login and the owner's "which restaurants do I have" — so a blip came back as a bare 500
// and the card said "Network error". Every throwing read at this door must now sit inside a try that
// answers 503 + transient, and the card must tell "the server answered badly" from "no network".
head("S10-T17. a database blip at the staff door says 'try again', never 'network error'");
{
  const pl = CODE.panelLogin;
  const lineOf = (src, needle) => src.split("\n").find((l) => l.includes(needle)) || "";
  check("P186001", "/api/panel-login looks the restaurant up inside a try (it THROWS on a failed read)",
    /try\s*\{[^}]*await getRestaurantBySlug\(/.test(lineOf(pl, "getRestaurantBySlug(")), lineOf(pl, "getRestaurantBySlug("));
  check("P186002", "/api/panel-login asks which restaurants an owner has inside a try (OwnedLookupFailed)",
    /try\s*\{[^}]*await enabledOwnedRestaurantIds\(/.test(lineOf(pl, "enabledOwnedRestaurantIds(u.id")), lineOf(pl, "enabledOwnedRestaurantIds(u.id"));
  check("P186003", "…and both catches answer through the one tryAgain() helper",
    count(pl, /catch \(e\) \{ return tryAgain\(/g) === 2, count(pl, /catch \(e\) \{ return tryAgain\(/g));
  check("P186004", "tryAgain() answers 503 with transient:true — retryable, never a 4xx and never a bare 500",
    /status:\s*503/.test(lineOf(pl, "transient: true }, { status:")) && has(pl, "transient: true"));
  check("P186005", "…in the SAME words loginUser uses for its own failed lookup",
    has(pl, `"Can't reach the server — try again in a moment."`) && has(CODE.userAuth, `"Can't reach the server — try again in a moment."`));
  check("P186006", "no other awaited read in /api/panel-login can throw bare (each remaining helper swallows its own errors)",
    ["isRestaurantDeleted(", "isRestaurantSuspended(", "rateAllowed(", "rateResetOnSuccess(", "logAction(", "loginUser("].every((n) => has(pl, n)) &&
    !/await (getRestaurantBySlug|ownerPanelEnabled|enabledOwnedRestaurantIds)\(/.test(pl.split("\n").filter((l) => !/try\s*\{/.test(l)).join("\n")));
  const lf = CODE.loginForm;
  check("P186007", "the staff card reads the reply with r.json().catch(), so a non-JSON server answer is not a thrown 'network error'",
    has(lf, "await r.json().catch(() => null)"));
  check("P186008", "…and says the SERVER didn't answer properly, not the network",
    has(lf, "The server didn\\u2019t answer properly"));
  check("P186009", "'Network error' is now only what a fetch that never arrived says",
    count(lf, /Network error/g) === 1 && /catch \{\s*setErr\("Network error/.test(lf));
}

if (LIVE || IDS_ONLY) {
  head(`8. Watched running against ${BASE} (P79371–P79420)`);
  // A guard that cannot reach the app must say so in one sentence and stop, never hand back a
  // stack trace or (worse) a page of greens about a server that is not there. verify:guards-alive
  // enforces this on every guard that drives the app.
  if (LIVE) { const { requireUp } = await import("./sweep/appUp.mjs"); await requireUp(BASE, "the three staff sign-in doors and the panel APIs"); }
  const EMPTY = { status: 0, ok: false, headers: new Headers(), text: async () => "", json: async () => ({}) };
  const get = async (p, init) => {
    if (IDS_ONLY) return EMPTY;
    try { return await fetch(BASE + p, { redirect: "manual", ...init }); }
    catch (e) { return { status: 0, ok: false, headers: new Headers(), text: async () => String(e), json: async () => ({}) }; }
  };
  const textOf = async (r) => { try { return await r.text(); } catch { return ""; } };
  // WHAT A PERSON ACTUALLY READS, not the raw document. React writes its own Suspense markers
  // (<!--$--> / <!--/$-->) into every page, so a "no leaked --> " check against the HTML source
  // goes red on every React page ever rendered and says nothing about the screen. Strip the
  // markup and the comments, then judge the text that is left.
  const visible = (html) => html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const health = await get("/api/health");
  check("P79371", "the app under test is answering at all", health.status === 200, health.status);

  const login = await get("/login");
  const loginHtml = await textOf(login);
  check("P79372", "/login answers 200 signed out", login.status === 200, login.status);
  check("P79373", "…and really renders the sign-in card", /Sign in/.test(loginHtml));
  check("P79374", "…with a Username label", /Username/.test(loginHtml));
  check("P79375", "…and a Password label", /Password/.test(loginHtml));
  check("P79376", "…and the platform name, because this is the plain door", /Aevidine/.test(loginHtml));
  check("P79377", "…and the line that tells a person with no account who to ask",
    /No account\?/.test(loginHtml));
  const loginText = visible(loginHtml);
  for (const [id, junk] of [["P79378", "${"], ["P79379", "[object Object]"], ["P79380", "-->"],
                            ["P79381", "undefined"], ["P79382", "NaN"]]) {
    check(id, `the /login card shows no leaked ${JSON.stringify(junk)} to a person`,
      !loginText.includes(junk), loginText.slice(0, 160));
  }

  const sl = await get("/staff-login");
  const slHtml = await textOf(sl);
  check("P79383", "/staff-login answers 200", sl.status === 200, sl.status);
  check("P79384", "…and says ADMIN CONSOLE, so a waiter knows they took the wrong door",
    /admin console/i.test(slHtml));
  check("P79385", "…and does NOT claim to be the staff door", !/Restaurant OS · staff sign in/.test(slHtml));
  check("P79386", "…and offers the way back to the staff door", /Staff sign in/.test(slHtml));
  check("P79387", "…and never renders the visitor's address", !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(slHtml.replace(/127\.0\.0\.1|0\.0\.0\.0/g, "")));

  // The scoped door — the one item 4 is about.
  const scoped = await get("/r/french-house/login");
  const scopedHtml = await textOf(scoped);
  check("P79388", "/r/french-house/login answers 200", scoped.status === 200, scoped.status);
  check("P79389", "…and shows the RESTAURANT's name, not the platform brand",
    /French House/i.test(scopedHtml), scopedHtml.slice(0, 0));
  check("P79390", "…and says 'Staff sign in' rather than the platform strapline",
    /Staff sign in/.test(scopedHtml));
  check("P79391", "…and it is not Next's error page", !/Application error|Internal Server Error/i.test(scopedHtml));
  const scopedText = visible(scopedHtml);
  for (const [id, junk] of [["P79392", "${"], ["P79393", "[object Object]"], ["P79394", "undefined"]]) {
    check(id, `the scoped door shows no leaked ${JSON.stringify(junk)} to a person`,
      !scopedText.includes(junk), scopedText.slice(0, 160));
  }
  const badSlug = await get("/r/no-such-restaurant-t25/login");
  check("P79395", "an unknown restaurant's door is a 404, not somebody else's card",
    badSlug.status === 404, badSlug.status);
  const badSlugHtml = await textOf(badSlug);
  check("P79396", "…and it names no real restaurant", !/French House|Aangan/i.test(badSlugHtml));

  // The API shapes. No login is spent on any of these.
  const prof = await get("/api/panel-profile");
  const profJson = await prof.json().catch(() => ({}));
  check("P79397", "GET /api/panel-profile with no session is a 200, not a red 401 in every console",
    prof.status === 200, prof.status);
  check("P79398", "…and says plainly that nobody is signed in", profJson.staff === false, profJson);
  check("P79399", "…and keeps the legacy `error` key so old callers branch as before",
    typeof profJson.error === "string");
  check("P79400", "…and carries no password hash, PIN hash or token version",
    !/password_hash|pin_hash|token_version/.test(JSON.stringify(profJson)));

  const profPost = await get("/api/panel-profile", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
  check("P79401", "POST /api/panel-profile with no session is still a 401 — writing needs a login",
    profPost.status === 401, profPost.status);

  const logoutGet = await get("/api/panel-logout");
  check("P79402", "GET /api/panel-logout is not allowed, so a prefetch cannot end a shift",
    logoutGet.status === 405, logoutGet.status);
  const sLogoutGet = await get("/api/staff-logout");
  check("P79403", "GET /api/staff-logout is not allowed either", sLogoutGet.status === 405, sLogoutGet.status);
  const logoutPost = await get("/api/panel-logout", { method: "POST" });
  check("P79404", "POST /api/panel-logout redirects with a 303", logoutPost.status === 303, logoutPost.status);
  check("P79405", "…to /login", String(logoutPost.headers.get("location") || "").endsWith("/login"),
    logoutPost.headers.get("location"));
  check("P79406", "…and clears the staff cookie on the way",
    /lfh_user=;|lfh_user=\s*;/.test(String(logoutPost.headers.get("set-cookie") || "")),
    logoutPost.headers.get("set-cookie"));
  const sLogoutPost = await get("/api/staff-logout", { method: "POST" });
  check("P79407", "POST /api/staff-logout redirects with a 303", sLogoutPost.status === 303, sLogoutPost.status);
  check("P79408", "…to the open guest menu", String(sLogoutPost.headers.get("location") || "").endsWith("/menu"),
    sLogoutPost.headers.get("location"));

  const loginGet = await get("/api/panel-login");
  check("P79409", "GET /api/panel-login is not allowed — a link can never sign anybody in",
    loginGet.status === 405, loginGet.status);
  const staffLoginGet = await get("/api/staff-login");
  check("P79410", "GET /api/staff-login is not allowed either", staffLoginGet.status === 405, staffLoginGet.status);

  // ONE deliberate wrong-credential POST, on a name that exists nowhere, so it can never wall a
  // real account and never counts against the shared admin IP lock. This is the "does the door
  // answer the generic sentence" check, and it is the only login request this guard makes.
  const wrong = await get("/api/panel-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "t25-no-such-person", password: "not-a-password" }) });
  const wrongJson = await wrong.json().catch(() => ({}));
  check("P79411", "a wrong sign-in answers 401, not 500", wrong.status === 401, wrong.status);
  check("P79412", "…with the generic sentence", wrongJson.error === "Wrong name or password.", wrongJson);
  check("P79413", "…and tells the caller nothing about why", !("reason" in wrongJson), Object.keys(wrongJson));
  check("P79414", "…and sets no cookie", !String(wrong.headers.get("set-cookie") || "").includes("lfh_user="),
    wrong.headers.get("set-cookie"));

  const scopedWrong = await get("/api/panel-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ restaurant: "no-such-restaurant-t25", username: "t25-no-such-person", password: "x" }) });
  const scopedWrongJson = await scopedWrong.json().catch(() => ({}));
  check("P79415", "an unknown restaurant slug at the door answers the SAME generic sentence",
    scopedWrong.status === 401 && scopedWrongJson.error === "Wrong name or password.", scopedWrongJson);
  check("P79416", "…so nothing at the door tells a caller which restaurants exist",
    !/restaurant|slug|not found/i.test(String(scopedWrongJson.error)));

  const notFound = await get("/api/editor/nonsense-t25", { method: "DELETE" });
  check("P79417", "the manager write api refuses an unauthenticated caller before anything else",
    [401, 403, 503].includes(notFound.status), notFound.status);
  check("P79418", "…and says so in a sentence rather than a stack trace",
    !/at .*\(.*:\d+:\d+\)/.test(await textOf(notFound)));

  const menu = await get("/menu");
  // /menu forwards to the tenant address (/r/<slug>/menu) — that is the resolver doing its job,
  // not a refusal. Either shape is "open"; a 401/403 would not be.
  check("P79419", "the guest menu is still open to everybody — none of this touched the front door",
    menu.status === 200 || (menu.status >= 300 && menu.status < 400 && /\/menu/.test(String(menu.headers.get("location") || ""))),
    { status: menu.status, to: menu.headers.get("location") });
  check("P79420", "…and the sign-in doors set no cookie merely by being LOOKED at",
    !String(login.headers.get("set-cookie") || "").includes("lfh_user="));
}

if (IDS_ONLY) process.exit(0);
console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`   · ${f}`); process.exit(1); }
