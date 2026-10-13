// Block G — conformance to the rules CLAUDE.md sets for this territory, and per-file hygiene, read from
// today's code with comments stripped (P173376…). A rule about CODE is checked against code, never
// against the comment that describes it.
import { check, band, FILES, SRC, CODE, rd, count, bodyOf } from "./lib.mjs";
import { execSync } from "node:child_process";
const HOW = "SRC — today's file, comments stripped";
band(173376);
const all = Object.entries(FILES);
const tree = execSync("git ls-files 'app/**/*.ts' 'app/**/*.tsx' 'components/*.tsx' 'lib/*.ts' 'lib/*.tsx' 'public/panels/**/*.js'", { cwd: new URL("../../..", import.meta.url).pathname, encoding: "utf8" }).split("\n").filter(Boolean);
const corpus = tree.map((f) => [f, rd(f)]);
// ── per-file hygiene: one row per file (re-runs the merge-marker / debugger / console.log / uuid / secret / TODO rows)
for (const [k, f] of all) {
  check(f, "hygiene: no merge marker, no debugger, no console.log in a shipped path, no hard-coded restaurant id, no secret-looking literal, no TODO/FIXME", HOW, () => {
    const s = SRC[k], c = CODE[k];
    const bad = [];
    if (/^(<<<<<<<|=======$|>>>>>>>)/m.test(s)) bad.push("merge marker");
    if (/\bdebugger\b/.test(c)) bad.push("debugger");
    if (/console\.log\(/.test(c)) bad.push("console.log");
    if (/['"`][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"`]/i.test(c)) bad.push("uuid literal");
    if (/(sbp_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}\.|sk_live_)/.test(c)) bad.push("secret-shaped literal");
    if (/\b(TODO|FIXME|XXX)\b/.test(c)) bad.push("TODO");
    return { ok: bad.length === 0, note: bad.join(", ") || `${s.split("\n").length} lines` };
  });
}
// ── timers: no repeating timer faster than a third of a second, anywhere in the territory
for (const [k, f] of all) {
  const ivs = [...CODE[k].matchAll(/setInterval\(/g)].length;
  if (!ivs) continue;
  check(f, `timers: every repeating timer (${ivs}) is a shared/named constant or ≥ 333 ms — no fast poll`, HOW, () => {
    const c = CODE[k]; const delays = [];
    for (const m of c.matchAll(/setInterval\(/g)) {
      let depth = 0, i = m.index + "setInterval(".length, lastComma = -1;
      for (; i < c.length; i++) { const ch = c[i]; if ("([{".includes(ch)) depth++; else if (")]}".includes(ch)) { if (depth === 0) break; depth--; } else if (ch === "," && depth === 0) lastComma = i; }
      delays.push(c.slice(lastComma + 1, i).trim());
    }
    const ok = delays.every((d) => /^[A-Z_]+$/.test(d) || Number(d.replace(/_/g, "")) >= 333);
    return { ok, note: delays.join(", ") };
  });
}
// ── reads: every multi-row read names its columns and is bounded; the territory reads few tables directly
check(FILES.blocked, "reads: every statement names one column (id) — the count, the pending check and the insert's return — and both reads are this device's address", HOW, () => count(CODE.blocked, /\.select\("id"/g) === 3 && count(CODE.blocked, /\.eq\("ip", ip\)/g) === 2 && /\.limit\(1\)/.test(CODE.blocked));
check(FILES.close, "reads: every read on orders names its columns and is bounded at 500 (one table's bill)", HOW, () => { const r = [...CODE.close.matchAll(/from\("orders"\)\.select\("([^"]+)"\)[\s\S]{0,260}?\.limit\((\d+)\)/g)]; return { ok: r.length === 2 && r.every((m) => m[2] === "500" && !/\*/.test(m[1])), note: r.map((m) => m[1]).join(" | ") }; });
check(FILES.close, "writes: every write is error-checked (must) — the only best-effort ones are the table-signal clean-up", HOW, () => count(CODE.close, /must\(await sb\.from\(/g) === 6 && /catch \{/.test(bodyOf(CODE.close, "export async function clearTableSignals(")));
check(FILES.assign, "reads: the section's floor size is ONE column, one row, scoped (twice — waiterTables and fullFloorFor)", HOW, () => count(CODE.assign, /from\("settings"\)\.select\("table_count"\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\)/g) === 2);
check(FILES.merge, "reads: the merge lookup is one column, one live row, for this restaurant", HOW, () => /select\("parent_table"\)\s*\.eq\("restaurant_id", rid\)\.eq\("child_table", t\)\.is\("ended_at", null\)\.limit\(1\)/.test(CODE.merge));
// Re-aimed 2026-10-13 (item 9 fixed): the read was select("*"); it now names its columns.
check(FILES.open, "reads: openSession reads ONE row (limit 1), naming its columns — never select('*') (item 9)", HOW, () => !/select\("\*"\)/.test(CODE.open) && /select\(OPENED_SESSION_COLS\)\s*\.eq\("restaurant_id", rid\)\.eq\("table_number", tableNumber\)\.neq\("status", "closed"\)\s*\.limit\(1\)/.test(CODE.open));
check(FILES.sess, "the guest session library talks to NO table directly — every call is a named database function", HOW, () => !/\.from\(/.test(CODE.sess) && count(CODE.sess, /rpc\("lfh_/g) === 19);
for (const k of ["gate", "card", "owner", "cartSync", "tbill", "ban", "ctx", "conn", "table", "ts", "gname", "gdev"]) {
  check(FILES[k], "guest code reads no table straight out of the database (no .from / supabase.from)", HOW, () => !/\b(supabase|sb)\.from\(/.test(CODE[k]));
}
// ── the restaurant is never guessed
for (const k of ["gate", "card", "owner", "cartSync", "tbill", "ban"]) {
  check(FILES[k], "no line turns 'we don't know which restaurant' back into restaurant #1 (`|| DEFAULT_RESTAURANT_ID`)", HOW, () => !/\|\|\s*DEFAULT_RESTAURANT_ID/.test(CODE[k]));
}
check(FILES.ban, "BanGate asks nothing until the restaurant is settled (`if (!ready) return;`)", HOW, () => /if \(!ready\) return;/.test(CODE.ban));
check(FILES.card, "the table card asks nothing until the restaurant is settled", HOW, () => /if \(!restaurantReady \|\| !restaurantId\) return;/.test(CODE.card));
for (const k of ["owner", "cartSync", "tbill"]) check(FILES[k], "…and this widget waits too: useRestaurantId() is '' until settled, and the effect returns on ''", HOW, () => /const restaurantId = useRestaurantId\(\);/.test(CODE[k]) && /if \(!restaurantId\) return;/.test(CODE[k]));
check(FILES.ctx, "useRestaurantId() itself refuses to hand out an unsettled id", HOW, () => /return ready \? id : "";/.test(CODE.ctx));
check(FILES.ctx, "a FAILED lookup answers id '' with ready false — never restaurant #1", HOW, () => { const c = bodyOf(CODE.ctx, ".catch(() => {"); return /setId\(""\)/.test(c) && /setReady\(false\)/.test(c) && !/DEFAULT_RESTAURANT_ID/.test(c); });
check(FILES.ctx, "…retries on a widening jittered wait (2/5/12/25 s), tells the diner once, and stops with an instruction", HOW, () => /RETRY_WAITS_MS = \[2_000, 5_000, 12_000, 25_000\]/.test(CODE.ctx) && /if \(!toldOnce\)/.test(CODE.ctx) && /0\.75 \+ Math\.random\(\) \* 0\.5/.test(CODE.ctx) && /please reload the page, or ask a member of staff", 6000/.test(CODE.ctx));
check(FILES.ctx, "the rule for 'which restaurant is this tab on' is IMPORTED from lib/tenantStorage, not written twice", HOW, () => /import \{ tenantSlug \} from "\.\/tenantStorage";/.test(CODE.ctx) && /const s = tenantSlug\(\);/.test(CODE.ctx));
// ── tenant-scoped storage
check(FILES.gate, "every per-restaurant key the sheet keeps (consent, nickname, table name) goes through tget/tset", HOW, () => !/localStorage\./.test(CODE.gate) && count(CODE.gate, /\bt(get|set)\(/g) >= 6);
check(FILES.card, "the card's clean-up of basket and live orders is tenant-scoped; only the drag spot and collapsed flag are device-wide, on purpose", HOW, () => /tremove\("lfh_cart"\)/.test(CODE.card) && /tremove\("lfh_active_orders"\)/.test(CODE.card) && [...CODE.card.matchAll(/localStorage\.(get|set)Item\(([A-Z_]+)/g)].every((m) => ["POS_KEY", "COLLAPSED_KEY"].includes(m[2])));
check(FILES.cartSync, "the shared basket reads and writes the tenant-scoped cart only", HOW, () => !/localStorage\./.test(CODE.cartSync) && /tget\(CART_KEY\)/.test(CODE.cartSync) && /tset\(CART_KEY,/.test(CODE.cartSync));
check(FILES.sess, "the saved session is tenant-scoped (lfh_session:<slug>)", HOW, () => /const KEY = "lfh_session";/.test(CODE.sess) && /tget\(KEY\)/.test(CODE.sess) && /tset\(KEY,/.test(CODE.sess) && /tremove\(KEY\)/.test(CODE.sess));
// ── the back button
check(FILES.gate, "the table sheet registers with the back-button manager", HOW, () => /useBackClose\("session-gate", open, close\)/.test(CODE.gate));
check(FILES.card, "both of the card's popups register with it", HOW, () => /useBackClose\("ssw-blocked", blocked,/.test(CODE.card) && /useBackClose\("ssw-confirm-leave", confirming,/.test(CODE.card));
check(FILES.owner, "the host's approve prompt registers with it, above its early return (rules of hooks)", HOW, () => CODE.owner.indexOf('useBackClose("session-owner"') > -1 && CODE.owner.indexOf('useBackClose("session-owner"') < CODE.owner.indexOf("if (!visible) return null;"));
for (const k of ["gate", "card", "owner", "ban", "tbill", "cartSync"]) check(FILES[k], "nothing touches browser history directly (only lib/backStack does)", HOW, () => !/history\.(pushState|replaceState|back|go)\(/.test(CODE[k]));
check(FILES.ban, "the ban wall is a full-screen modal dialog with no close (nothing to register — a ban has no way out but staff)", HOW, () => /role="dialog" aria-modal="true" aria-label="Access blocked"/.test(CODE.ban) && !/useBackClose/.test(CODE.ban));
// ── offline / outbox
check(FILES.gate, "a seated party's order and waiter call go through the phone's queue when there is no signal", HOW, () => /enqueueGuestOrder\(\{ mode: "session"/.test(CODE.gate) && /enqueueGuestCall\(\{ mode: "session"/.test(CODE.gate));
check(FILES.card, "leaving a table the restaurant did not hear is carried by the phone's queue", HOW, () => count(CODE.card, /enqueueGuestLeave\(\{ token, restaurantId, restaurantSlug \}\)/g) === 2);
check(FILES.gate, "every promise of 'we'll send it' is made only when the phone really kept it (q.persisted)", HOW, () => count(CODE.gate, /q\.persisted\s*\?/g) === 2);
check(FILES.gate, "the order carries ONE at-most-once id for the live try and anything saved", HOW, () => /orderKeyRef\.current = \{ sig, id:/.test(CODE.gate) && /placeSessionOrderSafe\(s\.token, pl\.items, pl\.allergies \|\| \[\], rid, actionId\)/.test(CODE.gate));
// ── wording rules
for (const k of ["gate", "card", "owner", "ban", "tbill", "blocked", "media", "menuData", "rt", "close", "assign"]) {
  check(FILES[k], "no refusal hands a person our schema (relation / column / constraint / violates / PGRST in a string)", HOW, () => !/["'`][^"'`\n]*(relation "|column "|violates|constraint "|PGRST)[^"'`\n]*["'`]/.test(CODE[k]));
  check(FILES[k], "nothing decides by matching a message's prose (.includes / .test on a reason or error text)", HOW, () => !/(reason|message|error)\??\.(includes|startsWith)\(/.test(CODE[k]));
}
check(FILES.gate, "every sentence telling a diner to check their internet sits behind a 'was it us?' test (item 1)", HOW, () => [...CODE.gate.matchAll(/check your internet/gi)].every((m) => /fault === "phone"/.test(CODE.gate.slice(Math.max(0, m.index - 420), m.index))));
check(FILES.gate, "every result the sheet reports carries WHICH action it was (12 fireDone calls)", HOW, () => { const n = count(CODE.gate, /fireDone\(\{/g); const a = count(CODE.gate, /fireDone\(\{[^}]*action/g); return { ok: n === a && n >= 12, note: `${a}/${n}` }; });
// ── access and gates on the four routes
check(FILES.media, "issue-media AWAITS the admin check (an un-awaited promise is always truthy)", HOW, () => /const isAdmin = await tokenIsValid\(/.test(CODE.media) && /if \(!staff && !isAdmin\) return bad\(/.test(CODE.media));
check(FILES.media, "issue-media takes the restaurant from the session (panelRestaurantId), never the body", HOW, () => /const rid = panelRestaurantId\(req, \{ user: staff \}\);/.test(CODE.media) && !/body\.(rid|restaurant)/.test(CODE.media));
check(FILES.rt, "rt-config reads only the two NEXT_PUBLIC_ values — never the service-role key", HOW, () => { const envs = [...CODE.rt.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]); return { ok: envs.length === 2 && envs.every((e) => e.startsWith("NEXT_PUBLIC_")), note: envs.join(",") }; });
check(FILES.blocked, "/api/blocked takes the address from OUR side (clientIp), never the body", HOW, () => count(CODE.blocked, /clientIp\(req\)/g) === 2 && !/b\.ip|body\.ip/.test(CODE.blocked));
for (const k of ["blocked", "media", "rt"]) check(FILES[k], "the route is never cached by Next (dynamic = force-dynamic)", HOW, () => /export const dynamic = "force-dynamic";/.test(CODE[k]));
check(FILES.menuData, "menu-data's three reads each answer for themselves (transient), and the last resort never shows a diner our words", HOW, () => count(CODE.menuData, /catch \{ return transient\(\); \}/g) === 3 && /console\.error\("\[menu-data\] unexpected failure:"/.test(CODE.menuData));
const pub = rd("docs/CLAUDE-DETAIL.md");
for (const r of ["/api/blocked", "/api/r/<slug>/menu-data", "/api/rt-config"]) check(r === "/api/blocked" ? FILES.blocked : r.includes("menu-data") ? FILES.menuData : FILES.rt, `${r} is on the deliberately-public list in docs/CLAUDE-DETAIL.md (so having no login is a decision, not a gap)`, "SRC — docs/CLAUDE-DETAIL.md", () => pub.includes(r));
check(FILES.media, "/api/issue-media is listed WITH its gate in docs/CLAUDE-DETAIL.md", "SRC — docs/CLAUDE-DETAIL.md", () => /\*\*`\/api\/issue-media`\*\* — the staff cookie first, then the admin cookie/.test(pub));
// ── exports: every export is used, or the report says why not
// Used = named by another file, or used inside its own file beyond its declaration (comments stripped).
const unused = (k) => [...SRC[k].matchAll(/^export (?:async )?(?:function|const|let|type|interface|class) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1])
  .filter((e) => !corpus.some(([p, t]) => p !== FILES[k] && new RegExp(`\\b${e}\\b`).test(t)) && count(CODE[k], new RegExp(`\\b${e}\\b`, "g")) < 2);
for (const k of ["sess", "table", "conn", "ts", "gname", "gdev", "chan", "open", "close", "merge", "assign", "ctx"]) {
  check(FILES[k], "every export has a caller somewhere in the app", HOW, () => { const u = unused(k).filter((e) => !(k === "conn" && e === "getTableConnection")); return { ok: u.length === 0, note: u.join(",") || "all used" }; });
}
check(FILES.conn, "getTableConnection() has no caller in the app — kept as the read half of setTableConnection for checks like this one (harmless)", HOW, () => unused("conn").join() === "getTableConnection");
check(FILES.bot, "turnstileSiteKey() has NO caller: no login form renders the Cloudflare box — so the keys must not be set until one does (item 8 corrected the instruction; building it is Part 4)", HOW, () => ({ ok: unused("bot").join() === "turnstileSiteKey" && /NOT a keys-only switch yet/.test(SRC.bot), note: "the header now says so" }));
check(FILES.sess, "sendOtp / verifyOtp have no caller today and that is deliberate — OTP is shelved behind verification (mig 360), not dead code", HOW, () => ["sendOtp", "verifyOtp"].every((e) => !corpus.some(([p, t]) => p !== FILES.sess && new RegExp(`\\b${e}\\(`).test(t))));
// ── money and sales
check(FILES.tbill, "the guest's live bill computes no money of its own — only the server's figures, converted for display", HOW, () => { const c = bodyOf(CODE.tbill, "const show = "); return /toMinor\(n \* currency\.rate, currency\)/.test(c) && !/subtotal\s*[-+*]/.test(CODE.tbill); });
for (const k of ["gate", "card", "owner", "cartSync", "tbill", "close"]) check(FILES[k], "nothing here can erase or hide a sale (no delete on orders/bills)", HOW, () => !/from\("(orders|bills|invoices)"\)[\s\S]{0,40}\.delete\(/.test(CODE[k]) && !/\.delete\(\)[\s\S]{0,40}orders/.test(CODE[k]));
check(FILES.close, "a written-off bill is a VISIBLE cancelled record (status cancelled + an audit row per order), never a delete", HOW, () => /status: "cancelled", archived: true/.test(CODE.close) && /recordRemoval\(\{/.test(CODE.close) && !/\.delete\(/.test(CODE.close));
// ── comments that describe timing must be true (the 3-second-poll lesson)
for (const k of ["cartSync", "card", "conn", "owner", "tbill"]) check(FILES[k], "no comment claims a fast poll the code does not run (every 2s / 3-second / 1.5s)", "SRC — today's file WITH its comments", () => !/(every 2s\)|every 2 seconds|three-second poll[^"]|3-second poll[^"]|every 1\.5 ?s)/.test(SRC[k].replace(/it said "every\s*\n?\/\/\s*2s"[^\n]*|claimed a three-second poll[^\n]*|NOT the 3-second poll[^\n]*/g, "")));
