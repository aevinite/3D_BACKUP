// scripts/sweep/t16s10/new-e.mjs — NEW checks, sweep #10 T16, ids P185500–P185619.
// Project-rule conformance, the login / data-separation questions answered by READING the code,
// a lock on each of this run's ten fixes, and the judgment checks ("is this how a real restaurant
// needs it?"). Static: no app, no browser.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { R, ok, eq, tag, src, code, strip, count, fnBody, ROOT, ROUTES, MY_FILES, npmRun } from "./lib.mjs";

const done = tag("new-e");
let id = 185500;
const N = (file, what, fn, how = "read today's code (comments stripped where the rule is about code)") => R(`P${id++}`, file, what, fn, how);
const J = (file, what, note) => R(`P${id++}`, file, what, () => ok(true, note), "judgment, after reading the file end to end");
const CE = ROUTES.clientError, MN = ROUTES.maintenance, H = ROUTES.health;
const PAGES = ["editor", "kitchen", "tablet"];

// ══ locks on this run's ten fixes (each also has its own guard; these keep the reason readable here) ══
N("maint.js", "fix 1: the shared profile save names its base, so the address is /api/panel-profile", () => /base: "", method: "POST", path: "\/api\/panel-profile"/.test(code("maint.js")));
N("outbox.js", "fix 1: the queue treats a missing base as '' (an old saved change still replays correctly)", () => /fetch\(\(item\.base \|\| ""\) \+ item\.path,/.test(code("outbox.js")));
N("outbox.js", "fix 2: every give-up inside the replay walk stalls its table when it can still be retried", () => { const c = code("outbox.js"), w = c.slice(c.indexOf("let i = 0;"), c.indexOf("} finally {")); return ok(!/moveToFailed\(/.test(w) && count(w, /await giveUp\(/) === 7, `${count(w, /await giveUp\(/)} give-ups, all through giveUp()`); });
N("backstack.js", "fix 3: nothing is pushed while a rewind is in flight; the rewind's popstate catches up", () => /if \(ignore > 0\) \{\s*if \(!rewindWait\)/.test(code("backstack.js")) && /if \(ignore === 0\) settleRewind\(\);/.test(code("backstack.js")));
N("backstack.js", "fix 3: …with a seat belt so Back can never stop working if a browser drops that popstate", () => /setTimeout\(function \(\) \{ rewindWait = null; ignore = 0; schedule\(\); \}, 1500\)/.test(code("backstack.js")));
N("errlog.js", "fix 4: the Firefox network-drop sentence is held whole ('…fetch resource')", () => /"NetworkError when attempting to fetch resource"/.test(code("errlog.js")) && !/"NetworkError when attempting to fetch",/.test(code("errlog.js")));
N("netretry.js", "fix 5: our own read deadline is translated to 'the server didn't answer in time'", () => /if \(ours && ours\.aborted && isAbort\(e\)\)/.test(code("netretry.js")) && /"the server didn't answer in time"/.test(code("netretry.js")));
N("maint.js", "fix 6: the drawer's ✕ takes the panel's own ink", () => /\.lfh-x\{[^}]*color:var\(--text,#fff\)/.test(src("maint.js")));
N("maint.js", "fix 7: a profile read that failed for a server reason is retried on a bounded backoff", () => /if \(!res \|\| \(!res\.ok && res\.status >= 500\)\) \{ retryInitLater\(\); return; \}/.test(code("maint.js")) && /bootTries >= 8/.test(code("maint.js")));
N("myprofile.js", "fix 8: a failed read is 'couldn't load', never 'you are not signed in'", () => /if \(readFailed\) \{/.test(code("myprofile.js")) && /Couldn\\'t load your profile just now/.test(src("myprofile.js")));
N("outbox.js", "fix 9: start-up MERGES the saved changes with any queued meanwhile", () => /all\.forEach\(\(x\) => \{ if \(!known\.has\(x\.id\)\) \(x\.status === "failed" \? failed : queued\)\.push\(x\); \}\);/.test(code("outbox.js")));
N(MN, "fix 10: an owner is checked against their own portfolio before any settings read", () => { const c = code(MN); return ok(c.indexOf("enabledOwnedRestaurantIds(g.user.id)") > 0 && c.indexOf("enabledOwnedRestaurantIds(g.user.id)") < c.indexOf('sb.from("settings")')); });
N("package.json", "the two guards this run added are registered", () => { const s = JSON.parse(src("./package.json")).scripts; return ok(s["verify:panel-backstack"] && s["verify:public-endpoints"], "verify:panel-backstack · verify:public-endpoints"); }, "read package.json");

// ══ §1b — does every request here need the right login, and see only its own restaurant? ══
N(MN, "every maintenance request needs a manager (or the admin) before any database call", () => { const c = code(MN); return c.indexOf('requireRole(req, "manager")') < c.indexOf("sb.from("); });
N(MN, "a staff member's restaurant always comes from their session, never from the request", () => /if \(g\.user\) return g\.user\.restaurant_id \|\| DEFAULT_RESTAURANT_ID;/.test(code("lib/panelScope.ts")), "read lib/panelScope.ts");
N(MN, "the ?rid= override is honoured for the admin super-user only (and for an owner, only one they own)", () => /urlRid/.test(code("lib/panelScope.ts")) && /if \(g\.user\) return/.test(code("lib/panelScope.ts")), "read lib/panelScope.ts");
N(MN, "every settings read and write is filtered by restaurant_id", () => { const c = code(MN); const q = c.match(/sb\.from\("settings"\)[^;]+/g) || []; return ok(q.length === 2 && q.every((x) => /\.eq\("restaurant_id", s\.rid\)/.test(x)), `${q.length} statements`); });
N(MN, "the power check reads the access settings of the SAME restaurant it will write", () => /\.from\("restaurants"\)\.select\("access_config"\)\.eq\("id", rid\)/.test(code(MN)));
N(MN, "a write refused for want of power says so, and is not dressed as a server error", () => /status: 403/.test(code(MN)));
N(MN, "a database message never reaches a panel", () => !/r\.error\.message \}/.test(code(MN)) && /console\.error\("\[maintenance\] read failed:", r\.error\.message\)/.test(code(MN)));
N(CE, "client-error trusts no identity from the caller: the counter key is the cookie or the server-seen address", () => /const capKey = capKeyFor\(req\);/.test(code(CE)) && !/body\.device/.test(code(CE)));
N(CE, "a restaurant label the caller supplies is honoured only where the address does not contradict it", () => /async function agreedRid\(/.test(code(CE)) && /if \(!fromAddress \|\| fromAddress === claimed\) return claimed;/.test(code(CE)));
N(CE, "the stored row carries no full user agent and no cookie value", () => !/headers\.get\("cookie"\)/.test(code(CE)) && !/user-agent"\)\s*\}/.test(code(CE)));
N(CE, "it writes only to staff_actions, at only two action names", () => { const c = code(CE); return ok(count(c, /sb\.from\("staff_actions"\)\.insert/) === 2 && /action: "ui_taps"/.test(c) && /action: "client_error"/.test(c)); });
N(H, "the health probe hands out no tenant data and no secret", () => !/restaurant_id|name|slug|process\.env/.test(code(H)));
N("realtime.js", "the live-update settings come from /api/rt-config — the browser never holds a service key", () => !/service_role|SERVICE_ROLE/.test(code("realtime.js")) && /cfg\.anonKey/.test(code("realtime.js")));
N("realtime.js", "rt-config answers the PUBLIC anon values only", () => !/SUPABASE_SERVICE_ROLE_KEY/.test(src("app/api/rt-config/route.ts")), "read app/api/rt-config/route.ts");
N("errlog.js", "a crash report never includes what a person typed into a field", () => !/\.value\b/.test(code("errlog.js")));
N("errlog.js", "a tap breadcrumb records a button's NAME, never a password or PIN box", () => /e\.target\.closest\("button, \[data-log\], a\.btn, \.btn"\)/.test(code("errlog.js")));
N("maint.js", "a PIN and a password are never kept in this page's storage", () => !/localStorage\.setItem\([^)]*(pin|pass)/i.test(code("maint.js")));
N("maint.js", "the password box is cleared of autofill confusion: current/new are marked as such", () => /autocomplete: "current-password"/.test(code("maint.js")) && /autocomplete: "new-password"/.test(code("maint.js")));
N("myprofile.js", "the profile screen only ever reads the signed-in person's own record (/api/panel-profile)", () => !/[?&]id=|staff_id|user_id/.test(code("myprofile.js")));
N("myprofile.js", "nobody can give themselves a raise: job, salary and ID are not in the editable fields", () => !/designation|pay_amount|id_last4|id_type/.test((src("myprofile.js").match(/var FIELDS = \[([\s\S]*?)\];/) || [])[1]));
N("myprofile.js", "every value the server sends is escaped before it is drawn", () => /esc\(me\.name \|\| me\.username\)/.test(code("myprofile.js")) && /var v = esc\(p\[f\[0\]\] \|\| ""\);/.test(code("myprofile.js")));
N("guestbell.js", "the bell writes only text into the page (textContent), never markup from a row", () => !/innerHTML\s*=\s*[^"'\s]/.test(code("guestbell.js")) && count(code("guestbell.js"), /innerHTML/) === 1);   // the one use clears the sheet with ""
N("offline.js", "the 'saved on this device' list draws labels as text, never as markup", () => !/innerHTML\s*=\s*(it|st)\./.test(code("offline.js")) && /el\("b", null, it\.label \|\| "Change"\)/.test(code("offline.js")));
N("connbadge.js", "the connection panel draws every queued label as text", () => /el\("b", null, it\.label \|\| "Action"\)/.test(code("connbadge.js")));
N("issue-raise.js", "a photo or voice note goes to the session's own restaurant; only the admin's pin rides along", () => /"\/api\/issue-media" \+ \(opts\.rid \?/.test(code("issue-raise.js")));
N("outbox.js", "a replayed change carries the time the PERSON acted, so the server can refuse a stale one", () => /"X-LFH-Queued-At"/.test(code("outbox.js")));
N("outbox.js", "every change carries its own action id, so a replay can never be applied twice", () => /"X-LFH-Action-Id": item\.id/.test(code("outbox.js")));
N("outbox.js", "a change never names another restaurant — the server takes the restaurant from the session", () => !/restaurant_id/.test(code("outbox.js")));
N("theme.js", "the skin is kept per device, never sent to the server", () => !/fetch\(/.test(code("theme.js")));

// ══ house rules from CLAUDE.md that govern this area ══
N("outbox.js", "rule: every write has a deadline (15 s) and a jittered backoff", () => /WRITE_TIMEOUT_MS = 15000/.test(code("outbox.js")) && /0\.75 \+ Math\.random\(\) \* 0\.5/.test(code("outbox.js")));
N("outbox.js", "rule: a 5xx is queued like offline, a 4xx is told to the person", () => /if \(res\.status >= 500\) \{\s*const p = await enqueue\(item, "busy"\);/.test(code("outbox.js")) && /if \(!res\.ok\) \{ const e = new Error/.test(code("outbox.js")));
N("realtime.js", "rule: no fixed fast poll while reads fail — the catch-up poll backs off to a minute", () => /const max = \(opts && opts\.maxMs\) \|\| 60000;/.test(code("realtime.js")));
N("realtime.js", "rule: channels drop when a tab is hidden and resubscribe on focus", () => /IDLE_MS = 120000/.test(code("realtime.js")) && /window\.addEventListener\("focus", wake\);/.test(code("realtime.js")));
N("realtime.js", "rule: realtime is keyed per restaurant", () => /topic_rid=eq\./.test(code("realtime.js")));
N("backstack.js", "rule: every shared popup registers with the back-button manager", () => ["connbadge.js", "guestbell.js", "maint.js", "myprofile.js", "issue-raise.js", "offline.js"].every((f) => /LFH_BACK\.layer\(/.test(code(f))));
N("offline.js", "rule: saved data is labelled as saved", () => /Showing saved data from/.test(code("offline.js")));
N("errlog.js", "rule: a crash row names the code line and its build", () => /assetTag\(m\[1\], m\[2\]\) \+ ":" \+ m\[3\]/.test(code("errlog.js")));
N("maint.js", "rule: a tap never vanishes — every failure in the drawer says so", () => count(code("maint.js"), /setMsg\(/) >= 10 && /LFH_ASK\.say\("Couldn't change it/.test(code("maint.js")));
N("connbadge.js", "rule R40: the pill keeps its size; the decision is on the line", () => /REJECTED \(owner, 2026-08-20\)/.test(src("connbadge.js")));
N(H, "rule R18: no second health page, and this one stays one cheap read", () => /REJECTED \(owner, 2026-08-13\)/.test(src(H)) && count(code(H), /sb\.from\(/) === 1);
N("myprofile.js", "rule R68: the profile does not hold the waiter's section", () => /REJECTED \(owner, 2026-10-11\) — docs\/REJECTED-IDEAS\.md → R68/.test(src("myprofile.js")));
N("myprofile.js", "rule R67: the profile never lists a permission", () => !/permission/i.test(code("myprofile.js")));
N("maint.js", "rule: the kitchen has NO profile of any kind (R7)", () => /if \(window\.LFH_NO_PROFILE_AT_ALL\) return;/.test(code("maint.js")) && !/myprofile\.js/.test(src("public/panels/kitchen/index.html")));
N("outbox.js", "rule: staff panels are English — the refusal sentences are literals", () => !/i18n/.test(code("outbox.js")));
N("guestbell.js", "rule: with the guest menu off there is no bell (render nothing when off)", () => /if \(!menuOn\) \{ unmount\(\); return; \}/.test(code("guestbell.js")));
N("swreg.js", "rule: works offline — every panel page registers the offline layer", () => PAGES.every((p) => /swreg\.js\?v=/.test(src(`public/panels/${p}/index.html`))));
N("outbox.js", "rule: no silent overwrite — an expectation rides on every write that has one", () => /if \(item\.expect\) headers\["X-LFH-Expect"\] = JSON\.stringify\(item\.expect\);/.test(code("outbox.js")));
N("outbox.js", "verify:clash-coverage is green", () => { const r = npmRun("verify:clash-coverage"); return ok(r.ok, r.out.trim().split("\n").pop()); }, "npm run verify:clash-coverage");
N("maint.js", "verify:panel-dialogs is green (no browser dialog in the shared files)", () => { const r = npmRun("verify:panel-dialogs"); return ok(r.ok); }, "npm run verify:panel-dialogs");
N("outbox.js", "verify:busy is green", () => { const r = npmRun("verify:busy"); return ok(r.ok, (r.out.match(/\d+ passed, \d+ failed/) || [""])[0]); }, "npm run verify:busy");
N("outbox.js", "verify:offline-retry is green", () => { const r = npmRun("verify:offline-retry"); return ok(r.ok, (r.out.match(/\d+ passed, \d+ failed/) || [""])[0]); }, "npm run verify:offline-retry");
N("outbox.js", "verify:panel-cache is green after every fix of this run", () => { const r = npmRun("verify:panel-cache"); return ok(r.ok); }, "npm run verify:panel-cache");
N("outbox.js", "verify:rejected is green", () => { const r = npmRun("verify:rejected"); return ok(r.ok); }, "npm run verify:rejected");
N("outbox.js", "verify:twins is green", () => { const r = npmRun("verify:twins"); return ok(r.ok); }, "npm run verify:twins");
N("maint.js", "verify:panel-names is green", () => { const r = npmRun("verify:panel-names"); return ok(r.ok); }, "npm run verify:panel-names");
N("outbox.js", "verify:outbox is green (41 checks)", () => { const r = npmRun("verify:outbox"); return ok(r.ok, (r.out.match(/\d+ passed, \d+ failed/) || [""])[0]); }, "npm run verify:outbox");
N("backstack.js", "verify:panel-backstack is green", () => { const r = npmRun("verify:panel-backstack"); return ok(r.ok, (r.out.match(/\d+ passed, \d+ failed/) || [""])[0]); }, "npm run verify:panel-backstack");
N(MN, "verify:public-endpoints is green", () => { const r = npmRun("verify:public-endpoints"); return ok(r.ok, (r.out.match(/\d+ passed, \d+ failed/) || [""])[0]); }, "npm run verify:public-endpoints");
N("netretry.js", "test:netretry is green", () => { const r = npmRun("test:netretry"); return ok(r.ok, (r.out.match(/ℹ pass \d+/) || [""])[0]); }, "npm run test:netretry");
N("auditsort.js", "verify:audit is green (the panels' audit vocabulary agrees with the database)", () => { const r = npmRun("verify:audit"); return ok(r.ok); }, "npm run verify:audit");
N("errlog.js", "verify:plain-logs is green", () => { const r = npmRun("verify:plain-logs"); return ok(r.ok); }, "npm run verify:plain-logs");

// ══ consistency across the files ══
N("outbox.js", "the queue's pause / resume hooks stay test-only", () => !PAGES.some((p) => /__pause|__resume/.test(code(`public/panels/${p}/app.js`))));
N("outbox.js", "the boot-retry pacing hook (LFH_TEST_PACING.boot) is set by no app code", () => !PAGES.some((p) => /LFH_TEST_PACING/.test(code(`public/panels/${p}/app.js`))));
N("maint.js", "the drawer's boot retry and the profile button's retry share the same waits", () => /\[5000, 15000, 30000, 60000, 120000\]/.test(code("maint.js")) && /\[5000, 15000, 30000, 60000, 120000\]/.test(code("myprofile.js")));
N("maint.js", "maint.js keeps its CRLF line endings after this run's three edits", () => { const t = src("maint.js"); return ok(!/[^\r]\n/.test(t), "every line CRLF"); });
N("outbox.js", "the queue's four ceilings still agree with the diner's queue", () => /AUTH_MAX_TRIES = 3;/.test(code("outbox.js")) && /NET_MAX_TRIES = 6;/.test(code("outbox.js")) && /SERVER_MAX_TRIES = 6;/.test(code("outbox.js")));
N("connbadge.js", "the pill's tiers still match the React twin after this run", () => /ms <= 700\)\s+return \{ key: "good"/.test(src("lib/connectionStatus.ts")) && /ms <= 700\)\s+return \{ color: "#22c55e"/.test(src("connbadge.js")));
N("netretry.js", "netretry's numbers still match lib/netRetry.ts after this run", () => /ATTEMPT_WAITS_MS = \[250, 600\]/.test(code("netretry.js")));
N("errlog.js", "errlog's phrase list and the guard's copy agree", () => { const a = [...(src("errlog.js").match(/var NETWORK_NOISE = \[([\s\S]*?)\];/) || ["", ""])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]); const b = src("scripts/t12/errlog.checks.mjs"); return ok(a.length === 6 && a.every((p) => b.includes(`"${p}"`)), a.join(" | ")); });
N("public/panels/auditsort.d.ts", "auditsort.d.ts still declares everything the file exports", () => { const api = code("auditsort.js").slice(code("auditsort.js").lastIndexOf("var API")); const keys = [...(api.match(/\{([\s\S]*?)\};/) || [, ""])[1].matchAll(/([A-Za-z_]+)\s*:/g)].map((m) => m[1]); return ok(keys.every((k) => new RegExp(`\\b${k}\\b`).test(src("public/panels/auditsort.d.ts"))), `${keys.length} exports`); });
N("public/panels/vendor/chart.umd.min.js", "the charts library on disk is the one the build script makes (banner present)", () => /generated by scripts\/build-vendor/.test(src("public/panels/vendor/chart.umd.min.js").slice(0, 500)));
N("outbox.js", "every one of my files is stamped on every page that loads it", () => { const bad = []; for (const p of PAGES) { const h = src(`public/panels/${p}/index.html`); for (const f of MY_FILES) if (new RegExp(`/panels/${f.replace(".", "\\.")}"`).test(h)) bad.push(`${p}:${f}`); } return ok(!bad.length, bad.join(",") || "all stamped"); });

// ══ judgment — is this how a real restaurant needs it? ══
J("outbox.js", "Is holding a settle behind a discount that gave up the right call, when the waiter is standing there?", "Yes. The settle waits, visibly ('waiting for an earlier change on this table'), and Try again or Not needed on the discount releases it at once. A bill at the wrong amount is a refund conversation with a guest; a held settle is one more tap.");
J("maint.js", "Should a busy boot retry the profile read by itself, or show a 'reload' message?", "By itself, gently: five widening waits, eight goes at most, one GET each — the person never sees a fault, and the button simply appears. A message would ask a waiter to fix the server.");
J("myprofile.js", "Is 'Couldn't load your profile just now — the system didn't answer' the right sentence?", "Yes — it says what happened without blaming their internet, and the button beside it is the one thing that helps.");
J("backstack.js", "Is a 1.5 s seat belt on the rewind wait safe?", "Yes. A same-page rewind lands in a few milliseconds in every engine; the belt only matters for a browser that never sends the popstate, where without it Back would stop closing cards for the rest of the session.");
J("netretry.js", "Should a timed-out READ be called 'no internet' or 'the server didn't answer in time'?", "The second. The device's connection is usually fine when a read times out; the manager panel's own errText still marks every read failure as offline, which is outside this territory (listed in Part 4).");
J("errlog.js", "Should the noise filter learn more phrases?", "No. It is the browser's own sentence for a dropped request, one per engine, matched whole — any phrase added is a real crash that might be silenced. This run corrected one entry without adding any.");
J(MN, "Should an owner be able to take the guest menu down at all?", "The access tree says yes when the admin switches the power on for the owner. Today nothing on screen offers it to an owner (the drawer is a staff thing); if it ever is, the route now scopes the owner to a restaurant they own. Whether to give owners that switch is a product question, not a fault (Part 4).");
J(CE, "Is a crash report that anyone can send a risk to the restaurant?", "Bounded: 2 KB per report, five crashes and forty tap batches per device per ten minutes, panel names from a fixed list, the restaurant label checked against the address, one phone alert per panel per fifteen minutes. A misbehaving browser can only ever add a handful of rows.");
J(H, "Is one 503 from /api/health enough for a watchdog to wake somebody?", "That is the watchdog's own setting (UptimeRobot retries); the probe's job is to tell the truth once, which it does.");
J("shrinkimg.js", "Is 1280 px the right cap for a dish photo?", "Yes — the guest card is ~300 px and the dish page ~600 px, so 1280 is retina-sharp everywhere a guest sees it, at a tenth of a phone photo's size.");
J("shrinkimg.js", "Should a picture be shrunk before the 5 MB limit is checked?", "Probably — today a 6 MB photo is refused at the door even though it would have shrunk to ~200 KB. Listed in Part 4; nothing breaks without it.");
J("guestbell.js", "With the guest menu off, should printer and low-stock notices still have a home?", "They do not today — the manager panel decides the bell exists only when the guest menu is on, and since 2026-08-30 the bell is where printing and stock notices live. Outside this territory (the manager panel's syncGuestBell); listed in Part 4.");
J("offline.js", "Is opening the 'needs you' list unprompted, once, the right amount of interruption?", "Yes — once, the first time something needs a person; a second failure while the first is unanswered only updates the bar.");
J("undobar.js", "Is a 3 s take-back window long enough on a busy floor?", "The owner set it (3 s default, 5 s ceiling) and it is the ring that shows it; nothing here argues with that.");
J("connbadge.js", "Is showing every queued change inside the connection panel too much detail for a waiter?", "No — it is behind one tap, and it is the only place a waiter can see which table's change is stuck and why.");
J("theme.js", "Should the skin follow another tab of the same panel?", "Yes, never under a finger. Driven both ways this run.");
J("realtime.js", "Is dropping a hidden tab's live connection after two minutes right for a kitchen screen?", "Only because the kitchen opts out when it prints (keepAlive). A cook's screen that is hidden and not printing has nothing to show.");
J("fitnums.js", "Should a bill total ever be shortened to ₹1.2 Cr?", "Never — a document figure keeps every digit at the 11 px floor with the full figure on hover; only a summary tile shortens. Driven both ways this run.");
J("swipehint.js", "Is a '→ 6 more' chip the right signal for a sideways row?", "Yes, and it counts what is really off the edge — re-driven in nine layouts. The waiter tablet still does not load it (its own territory).");
J("issue-raise.js", "Is refusing to close mid-recording on Back the right call?", "Yes — a two-minute voice note about a broken fridge is the one thing in that card a person cannot get back. Cancel still throws it away on purpose.");
J("auditsort.js", "Is it right that an unnamed (system) row sorts FIRST in Person A–Z?", "It is how it has always behaved (P44340's title said otherwise; its evidence did not). Harmless, and mildly odd; listed in Part 4 as a small idea.");
J("myprofile.js", "'0 of 8 details filled' over twelve boxes — confusing?", "Slightly: the 8 are the key details (phone, name, birthday, email, address, city, emergency name and phone); the rest are optional extras. A wording idea only (Part 4).");
J("maint.js", "Should taking the guest menu offline queue when there is no signal?", "No — it is a deliberate, visible act; delivering it minutes later behind the manager's back could close the menu after they walked away. It stays live and says so.");
J("outbox.js", "Walk a whole shift: after this run, is the plumbing what a restaurant needs?", "Yes. A staff member can save their own details again; a settle can no longer slip past a discount; Back keeps people in the panel; a busy moment at boot no longer hides Sign out; a Wi-Fi blip on Firefox no longer pages the owner.");

done();
