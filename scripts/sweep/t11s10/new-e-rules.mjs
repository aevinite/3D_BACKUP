// SWEEP #10 · T11 · block E — THE PROJECT'S OWN RULES, READ OFF TODAY'S SOURCE. P180501–P180560.
//
// Each row is one rule from CLAUDE.md, docs/REJECTED-IDEAS.md or .claude/rules/ that governs the
// kitchen screen, checked against the code with its comments stripped (a sentence ABOUT the rule can
// never satisfy it). The source of each rule is named in the row.
import { check, SRC, CODE, F, branch } from "./lib.mjs";

const S = "SRC — today's file, comments stripped";
const A = CODE.app, R = CODE.route, Hh = CODE.html, PG = CODE.page, RP = CODE.rpage, LY = CODE.layout;
const has = (t, re) => re.test(t);

// ── rulings the owner already made — P180501–P180512 ─────────────────────────────────────────
check("P180501", F.app, "R7: the kitchen has NO profile — both opt-out flags are set before maint.js runs", S, () => has(A, /window\.LFH_SUPPRESS_SETTINGS_BTN = true;\s*window\.LFH_NO_PROFILE_AT_ALL = true;/));
check("P180502", F.app, "R7: no 'Profile' button, profile page or pay record is drawn anywhere on this screen", S, () => !/["'>]\s*(👤\s*)?Profile\b|myprofile|payslip|salary/i.test(A));
check("P180503", F.html, "R7: the kitchen page never loads the profile script (myprofile.js)", S, () => !/myprofile\.js/.test(Hh));
check("P180504", F.app, "R3: an empty lane is never hidden or collapsed (no code hides a .col)", S, () => !/col-(new|cooking|ready)"\)\.hidden\s*=\s*true|\.col[^;\n]*display\s*=\s*"none"/.test(A));
check("P180505", F.app, "R5: no 'ready for N minutes' signal on the Ready lane (ageClass has no ready branch)", S, () => !/ready[^;\n]{0,40}age-|age-ready|readyAge/i.test(A));
check("P180506", F.app, "R21: no errText() treatment on the kitchen — refusals stay 'Failed: <message>'", S, () => !/errText\(/.test(A) && /toast\("Failed: " \+ e\.message\)/.test(A));
check("P180507", F.route, "R48: 'No restaurant scope — open this panel from the admin console.' is kept, on both handlers", S, () => (R.match(/No restaurant scope — open this panel from the admin console\./g) || []).length === 2);
check("P180508", F.route, "R56: an admin's forced print at a shop is audited as print_sent_by_admin (not hidden)", S, () => (R.match(/g\.user \? "kot_reprint_sent" : "print_sent_by_admin"/g) || []).length === 2);
check("P180509", F.app, "the reversed 2026-08-31 rule: the 'Set this screen up to print' guide is on the 🖨 sheet", S, () => has(SRC.app, /href="\/print-setup\.html#station"/));
check("P180510", F.app, "mig 372: there is NO printing mode toggle on this screen (no stored print mode)", S, () => !/localStorage\.(get|set)Item\("[^"]*print[_-]?mode/i.test(A) && !/data-kstation/.test(A));
check("P180511", F.app, "R62: the kitchen never stamps a 'Reprint' on a guest BILL (it prints KOTs only)", S, () => !/bill_printed_at|billDocHtml|LFH_BILLDOC\.bill/.test(A));
check("P180512", F.app, "R67: nothing on the kitchen screen is greyed out with 'ask your owner'", S, () => !/ask (your|the) owner|ask your manager to (enable|turn)/i.test(A));

// ── auto-print is a QUEUE — P180513–P180518 ──────────────────────────────────────────────────
check("P180513", F.app, "the queue's printer never refuses because the window is hidden (no document.hidden in processPrintJobs)", S, () => { const i = A.indexOf("function processPrintJobs("), j = A.indexOf("let kdsDrawerOff"); return i > 0 && j > i && !/document\.hidden/.test(A.slice(i, j)); });
check("P180514", F.app, "a job is CLAIMED before it is printed (the atomic claim stops a double print)", S, () => /claimPrintJobs\(fresh\.map\(\(j\) => j\.id\)\)\.then\(\(wonIds\) =>/.test(A));
check("P180515", F.app, "every printed or failed job is REPORTED back through the outbox", S, () => /api\("POST", `\/print-jobs\/\$\{j\.id\}\/done`/.test(A));
check("P180516", F.app, "the self-healing net waits 20 seconds and stands down without the server's queuedFor", S, () => /const NET_AFTER_MS = 20000;/.test(A) && /if \(!Array\.isArray\(queuedFor\)\) return;/.test(A));
check("P180517", F.route, "the screen keeps its live socket only while it is the printer (keepAlive reads autoPrintKot)", S, () => /keepAlive: \(\) => !!state\.autoPrintKot/.test(A));
check("P180518", F.route, "who prints is decided in ONE place (screenMayPrint) on the board, the claim and 'print here'", S, () => (R.match(/screenMayPrint\(/g) || []).length === 3);

// ── the back button, offline, no silent overwrite — P180519–P180530 ───────────────────────────
for (const [id, name] of [["P180519", "86-board"], ["P180520", "printer-problem"], ["P180521", "kitchen-menu"], ["P180522", "kitchen-settings"], ["P180523", "kds-more"]])
  check(id, F.app, `back-button manager: the "${name}" overlay registers its own layer`, S, () => new RegExp(`LFH_BACK\\.layer\\("${name}",`).test(A));
check("P180524", F.html, "backstack.js is loaded on the kitchen page", S, () => /\/panels\/backstack\.js\?v=[0-9a-f]{8}/.test(Hh));
check("P180525", F.app, "offline: every write goes through the panel outbox", S, () => /if \(method !== "GET" && window\.LFH_OUTBOX\) \{\s*return window\.LFH_OUTBOX\.send\(/.test(A));
check("P180526", F.html, "offline: outbox.js and offline.js load BEFORE app.js, offline.js after outbox.js", S, () => { const o = Hh.indexOf("/panels/outbox.js"), f = Hh.indexOf("/panels/offline.js"), a = Hh.indexOf('src="app.js'); return o > 0 && f > o && a > f; });
check("P180527", F.app, "offline: the board opens from the device's saved copy on a first visit (LFH_WARM hand-off)", S, () => /window\.LFH_WARM\.data\(/.test(A));
check("P180528", F.app, "offline: a saved-not-sent write says so ('Saved on this device')", S, () => (A.match(/Saved on this device ✓ — it will send by itself\./g) || []).length >= 4);
check("P180529", F.app, "no silent overwrite: the api() still carries the `expect` door for a future value edit (lib/clash)", S, () => /expect: opts && opts\.expect/.test(A));
check("P180530", F.route, "no silent overwrite: every POST passes the replay clash AND the expect clash before acting", S, () => { const i = R.indexOf("const clash = await replayClash("), j = R.indexOf("const overwrite = await expectClash("), k = R.indexOf('if (a === "issue")'); return i > 0 && j > i && k > j; });

// ── egress and the rush — P180531–P180542 ────────────────────────────────────────────────────
check("P180531", F.route, "no `select(\"*\")` anywhere on this route", S, () => !/\.select\("\*"\)/.test(R));
check("P180532", F.route, "the delivery read leaves out the two big JSON columns (payload, status_history)", S, () => { const m = R.match(/from\("aggregator_orders"\)\.select\("([^"]+)"\)\.eq\("restaurant_id", rid\)\.in\("status"/); return !!m && !/payload|status_history/.test(m[1]); });
check("P180533", F.route, "every list read that can grow carries a .limit()", S, () => { const lists = [/from\("menu_items"\)[^;]*?\.limit\(2000\)/, /from\("aggregator_orders"\)[^;]*?\.limit\(500\)/, /from\("table_tags"\)[^;]*?\.limit\(500\)/]; return lists.every((re) => re.test(R.replace(/\n\s*/g, " "))); });
check("P180534", F.route, "the device-block check on the hot board read is memoised 30s and bounded", S, () => /const BLOCK_TTL_MS = 30_000;/.test(R) && /if \(blockMemo\.size > 500\)/.test(R));
check("P180535", F.route, "every write drops the shared floor snapshot before AND after (invalidateFloor)", S, () => /export const POST = withIdempotency\(invalidateFloorAfter\(postImpl\), "kitchen"\);/.test(R) && /if \(rid\) \{ invalidateFloor\(rid\); writeRid\.set\(req, rid\); \}/.test(R));
check("P180536", F.route, "every write runs at most once on an offline replay (withIdempotency)", S, () => /withIdempotency\(/.test(R));
check("P180537", F.app, "no fixed fast poll: the only setIntervals are the clock (1s, display-only), the 60s backstop and the black wall", S, () => { const ivs = [...A.matchAll(/setInterval\([\s\S]*?\}, (\d+)\)/g)].map((m) => +m[1]).sort((x, y) => x - y); return { ok: JSON.stringify(ivs) === "[1000,3000,60000]", note: JSON.stringify(ivs) }; });
check("P180538", F.app, "the 60s backstop stands down while hidden unless this screen is the printer", S, () => /setInterval\(\(\) => \{ if \(!document\.hidden \|\| state\.autoPrintKot\) load\(\)\.catch\(\(\) => \{\}\); \}, 60000\);/.test(A));
check("P180539", F.app, "with no realtime at all, the fallback poll backs off on failure with jitter (never a flat 2s)", S, () => /function backoffPoll\(baseMs\)/.test(A) && /0\.8 \+ Math\.random\(\) \* 0\.4/.test(A) && !/setInterval\(load, 2000\)/.test(A));
check("P180540", F.app, "a breadcrumb naming tables fetches only those tables (targeted refetch)", S, () => /ops: \(detail\) => \(detail && !detail\.full && detail\.tables && detail\.tables\.length\) \? loadTables\(detail\.tables\) : fullSoon\(\)/.test(A));
check("P180541", F.app, "whole-board reloads are collapsed to one per 4 seconds, and a read in flight absorbs the event", S, () => /lastFullAt \+ 4000 - Date\.now\(\)/.test(A) && /if \(loadInFlight\) \{ loadQueued = true; return; \}/.test(A));
check("P180542", F.app, "concurrent board reads share one fetch plus at most one trailing refresh", S, () => /function load\(\) \{\s*if \(loadInFlight\) \{ loadQueued = true; return loadInFlight; \}/.test(A));

// ── logins, scope and the pages — P180543–P180552 ────────────────────────────────────────────
check("P180543", F.layout, "/kitchen is gated by requirePanel('kitchen') before anything renders", S, () => /await requirePanel\("kitchen", "\/kitchen"\);\s*return <>\{children\}<\/>;/.test(LY));
check("P180544", F.page, "the /kitchen page awaits its searchParams (Next 16) and lets only the admin pin a restaurant", S, () => /const \{ rid, as, view \} = await searchParams;/.test(PG) && /await panelAdminRid\("kitchen", rid\)/.test(PG));
check("P180545", F.rpage, "/r/<slug>/kitchen resolves the restaurant from the SLUG and gates on requirePanelAt", S, () => /const \{ restaurant \} = await params;/.test(RP) && /await requirePanelAt\("kitchen", restaurant\)/.test(RP));
check("P180546", F.rpage, "…and passes a restaurant pin into the iframe only for the admin", S, () => /panelIframeSrc\("\/panels\/kitchen\/index\.html", admin \? restaurantId : null, \{ as, view \}\)/.test(RP));
check("P180547", F.page, "both kitchen addresses build the iframe through the ONE builder (panelIframeSrc)", S, () => /panelIframeSrc\(/.test(PG) && /panelIframeSrc\(/.test(RP));
check("P180548", F.page, "both kitchen addresses name the browser tab 'Kitchen — Aevidine'", S, () => /title: "Kitchen — Aevidine"/.test(PG) && /title: "Kitchen — Aevidine"/.test(RP));
check("P180549", F.route, "the restaurant on every staff request comes from the session (panelRestaurantId), never the body", S, () => (R.match(/const rid = panelRestaurantId\(req, g\);/g) || []).length === 2 && !/body\??\.(restaurant_id|rid)\b/.test(R));
check("P180550", F.route, "every by-id write on orders / order_items / menu_items names the restaurant", S, () => { const writes = [...R.matchAll(/from\("(orders|order_items|menu_items)"\)\.update\([^;]*?;/gs)].map((m) => m[0]); return { ok: writes.length >= 8 && writes.every((w) => /\.eq\("restaurant_id", rid\)/.test(w)), note: `${writes.length} writes` }; });
check("P180551", F.route, "the one database function this route calls has no tenant scope, and is fenced by an ownership read", S, () => { const rpcs = [...R.matchAll(/sb\.rpc\("(\w+)"/g)].map((m) => m[1]); const b = branch('if (a === "platform" && c === "status")'); return rpcs.join() === "lfh_platform_set_status" && b.indexOf('.eq("restaurant_id", rid).maybeSingle()') < b.indexOf("sb.rpc("); });
check("P180552", F.route, "the gate is in the route, not a middleware (CLAUDE.md: the gate stays per-route)", S, () => !/middleware/.test(R) && /async function gate\(req: NextRequest\)/.test(R));

// ── money, branding, secrets — P180553–P180560 ───────────────────────────────────────────────
check("P180553", F.route, "billing compliance: the kitchen never deletes an order or a dish row", S, () => !/from\("(orders|order_items)"\)[^;]*\.delete\(/s.test(R));
check("P180554", F.route, "billing compliance: the kitchen never writes a money column", S, () => { const ups = [...R.matchAll(/from\("orders"\)\.update\(\{([^}]*)\}/g)].map((m) => m[1]); return { ok: ups.every((u) => !/total|subtotal|tax|discount|net_amount|payment|paid/.test(u)), note: ups.map((u) => u.trim()).join(" | ") }; });
check("P180555", F.app, "the kitchen screen shows no money at all (no ₹, no price, no total)", S, () => !/₹|\.price\b|\.total\b|net_amount|subtotal/.test(A));
check("P180556", F.app, "multi-tenant: no restaurant's name or colour is hard-coded on the screen", S, () => !/French House|Aangan|little French|#c00\b/.test(A) && !/French House|Aangan/.test(Hh));
check("P180557", F.app, "multi-tenant: the header name comes from the board's restaurant row only", S, () => /setRestName\(data\.restaurant\);/.test(A));
check("P180558", F.route, "no environment value or key is ever put in a reply", S, () => !/process\.env/.test(R));
check("P180559", F.app, "the panel holds no key, token or secret of its own", S, () => !/sb_secret|service_role|eyJhbGci|SUPABASE_/.test(A));
check("P180560", F.html, "every script and the stylesheet on the kitchen page carries its own content hash (no stale skin)", S, () => { const tags = [...SRC.html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))(\?v=[0-9a-f]{8})?"/g)]; return { ok: tags.length >= 15 && tags.every((t) => !!t[2]), note: `${tags.length} assets` }; });
