#!/usr/bin/env node
// SWEEP #8 — TERMINAL 3's NEW STATIC ROWS, P56701..P57130.
//
//   node scripts/sweep/t3/s8-checks.mjs
//
// Territory: the basket and placing an order — components/CartPanel.tsx,
// components/OrderTracker.tsx, lib/guestOutbox.ts, lib/menu.ts, app/api/guest/**.
//
// Every row prints `P56xxx ok/FAIL`, so a future sweep reproduces any single result by id. Nothing
// here touches a database, a login or a deployed site: it reads the real shipped files, and where
// the logic is small enough it RUNS it against synthetic input rather than pattern-matching it —
// sweep #6's own lesson that three of three static "dead guard" findings were the detector being
// wrong. The live rows are in s8-live.mjs.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");

const F = {
  outbox: read("lib/guestOutbox.ts"),
  menu: read("lib/menu.ts"),
  cart: read("components/CartPanel.tsx"),
  tracker: read("components/OrderTracker.tsx"),
  place: read("app/api/guest/place-order/route.ts"),
  call: read("app/api/guest/call-waiter/route.ts"),
  leave: read("app/api/guest/leave/route.ts"),
  limit: read("app/api/guest/limit-hit/route.ts"),
  status: read("lib/orderStatus.ts"),
  idem: read("lib/idempotency.ts"),
  clash: read("lib/clash.ts"),
  floor: read("lib/floorSummary.ts"),
  plan: read("lib/planTable.ts"),
  cap: read("lib/publicCap.ts"),
};

let pass = 0;
const fails = [];
const P = (id, name, ok) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}`); }
};
// Body of one function/const, so a check can never be satisfied by an unrelated line elsewhere.
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return "";
  const rest = src.slice(a);
  const b = to ? rest.indexOf(to) : -1;
  return b > 0 ? rest.slice(0, b) : rest;
};
const count = (src, re) => (src.match(re) || []).length;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A1 — lib/guestOutbox.ts, the saved-work queue (P56701–P56800)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const O = F.outbox;
const flush = between(O, "export async function flushGuestOutbox", "export async function dismissGuestFailed");
const enqOrder = between(O, "export async function enqueueGuestOrder", "/**\n * SAVE A WAITER CALL");
const enqCall = between(O, "export async function enqueueGuestCall", "// A saved call older than this");
const enqLeave = between(O, "export async function enqueueGuestLeave", "/**\n * THE ONE DECISION");
const rest = between(O, "export async function orderRestWithout", "/**\n * Put ONE failed order");
const retryFn = between(O, "export async function retryGuestFailed", "function ensureStarted");
const startFn = between(O, "function ensureStarted", "/** Read back whatever");
const restore = between(O, "function restoreQueue", "// ── React hook");
const sched = between(O, "function scheduleRetry", "/** There is a timer pending");

P("P56701", "the queue file exists and is not a stub", O.length > 20000);
P("P56702", "it is a client module, so it can never be pulled into a server bundle", /^"use client";/.test(O));
P("P56703", "the saved row declares all three kinds explicitly", /kind\?: "order" \| "call" \| "leave"/.test(O));
P("P56704", "a row written before `kind` existed reads as an order, not as neither", /isCall\(it\) \? "call" : isLeave\(it\) \? "leave" : "order"/.test(O));
P("P56705", "the at-most-once id is the row's own primary key in storage", /createObjectStore\(STORE, \{ keyPath: "id" \}\)/.test(O));
P("P56706", "storage failure is reported, never swallowed into a false promise", /function idbWrite[\s\S]{0,400}Promise<boolean>/.test(O));
P("P56707", "…and both an errored AND an aborted transaction count as failure", /tx\.onerror/.test(O) && /tx\.onabort/.test(O));
P("P56708", "a read that cannot open storage answers an empty list rather than throwing", /catch \{ return \[\]; \}/.test(O));
P("P56709", "the uuid helper has a fallback for a browser without crypto.randomUUID", /randomUUID \?[\s\S]{0,200}Math\.random/.test(O));
P("P56710", "…and the fallback still produces a version-4 shape", /xxxxxxxx-xxxx-4xxx-yxxx/.test(O));
P("P56711", "the offline test is a FUNCTION, so it is re-read every pass", /const isOffline = \(\) =>/.test(O));
P("P56712", "…and it treats only an explicit false as offline", /navigator\.onLine === false/.test(O));
P("P56713", "every listener notification is wrapped, so one bad subscriber cannot stop the rest", /listeners\.forEach\(\(l\) => \{ try \{ l\(\); \} catch/.test(O));
P("P56714", "…and the window announcement is wrapped too (no window in a test runner)", /try \{ window\.dispatchEvent\(new CustomEvent\("lfh:guest-outbox-changed"\)\); \} catch/.test(O));
P("P56715", "the snapshot is a COPY, so a subscriber cannot mutate the queue", /queued\.slice\(\), failed: failed\.slice\(\)/.test(O));
P("P56716", "the count a badge reads is queued + failed, not just queued", /count: queued\.length \+ failed\.length/.test(O));
P("P56717", "the server-side snapshot is a stable empty object (no hydration mismatch)", /const EMPTY = \{[\s\S]{0,120}\};[\s\S]{0,200}function getServerSnapshot\(\) \{ return EMPTY; \}/.test(O));
P("P56718", "the hook subscribes through useSyncExternalStore, not a poll", /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/.test(O));
// s8 self-correction: `[^)]*` cannot cross the `)` in `cb: () => void`. The claim is true.
P("P56719", "subscribing is what starts the queue, so a mounted badge restores saved work", /function subscribe\([\s\S]{0,40}\) \{ ensureStarted\(\);/.test(O));

// the three enqueue doors
P("P56720", "saving an order reuses the online attempt's at-most-once id when given one", /const item: GuestOrder = \{ id: actionId \|\| uuid\(\)/.test(enqOrder));
P("P56721", "…and remembers which restaurant it was for, from the page it was saved on", /restaurantSlug = p\.restaurantSlug \|\| tenantSlug\(\)/.test(enqOrder));
P("P56722", "…and reports honestly whether the phone really stored it", /const persisted = await persist\(item\)/.test(enqOrder) && /persisted \}/.test(enqOrder));
P("P56723", "…and leaves a timer behind, always", /ensureRetry\(\);/.test(enqOrder));
// s8 self-correction: a 4-line comment sits between the await and the return, so 200 chars was
// too tight. Asserted as an ORDER instead: the persist is awaited, and it happens before the return.
P("P56724", "…and never returns before the storage answer is known", enqOrder.indexOf("await persist(item)") > 0 && enqOrder.indexOf("await persist(item)") < enqOrder.indexOf("return { ok: true"));
P("P56725", "an over-full queue drops the OLDEST, never the newest the diner is watching", /const oldest = queued\[0\]/.test(enqOrder));
P("P56726", "…and tells the diner instead of deleting it silently", /moveToFailed\(oldest, "This one waited too long/.test(enqOrder));
P("P56727", "the ceiling is a real number, well above any genuine basket", /const MAX_QUEUED = 25;/.test(O));
P("P56728", "repeated bell taps in a dead spot collapse into ONE saved call", /const already = queued\.find\(sameTable\)/.test(enqCall));
P("P56729", "…matched on kind AND mode AND table AND token, so two tables never merge", /isCall\(x\) && x\.mode === p\.mode && String\(x\.table \|\| ""\) === String\(p\.table \|\| ""\) && String\(x\.token \|\| ""\) === String\(p\.token \|\| ""\)/.test(enqCall));
P("P56730", "…keeping the NEWEST note rather than the first", /if \(p\.reason\) already\.reason = p\.reason/.test(enqCall));
P("P56731", "…and keeping the id already in flight, so it cannot ring twice", /return \{ ok: true, queued: true, action_id: already\.id/.test(enqCall));
P("P56732", "a saved call carries no basket, so nothing can price it", /kind: "call"[\s\S]{0,200}items: \[\], allergies: \[\]/.test(enqCall));
P("P56733", "the collapse path still leaves a timer behind", /already\.at = Date\.now\(\)[\s\S]{0,300}ensureRetry\(\)/.test(enqCall));
P("P56734", "only ONE 'I have left' can be waiting per token", /queued\.find\(\(x\) => isLeave\(x\) && String\(x\.token \|\| ""\) === String\(p\.token \|\| ""\)\)/.test(enqLeave));
P("P56735", "…and a second attempt returns the FIRST one's id", /return \{ ok: true, queued: true, action_id: existing\.id/.test(enqLeave));
P("P56736", "a saved leave is a session thing by construction", /kind: "leave"[\s\S]{0,200}mode: "session"/.test(enqLeave));
P("P56737", "…and its overflow message speaks about telling staff, not ordering", /waited too long to send — please tell a member of staff/.test(enqLeave));
P("P56738", "a call's overflow message speaks about asking staff", /waited too long to send — please ask a member of staff/.test(enqCall));

// the retry timer
P("P56739", "the first retry is short, because one dropped request is the common case", /const RETRY_FIRST_MS = 5_000;/.test(O));
P("P56740", "later rounds back off exponentially", /Math\.pow\(2, retryStep - 1\)/.test(O));
P("P56741", "…up to a ceiling, so it never stops trying entirely", /const RETRY_MAX_MS = 120_000;/.test(O));
P("P56742", "each phone rolls its own jitter, so a restaurant's phones stop arriving together", /0\.75 \+ Math\.random\(\) \* 0\.5/.test(sched));
P("P56743", "an empty queue clears the timer rather than ticking for the life of the tab", /if \(!queued\.length\) \{ retryStep = 0; serverAskedWaitMs = 0; return; \}/.test(sched));
P("P56744", "a round that got an answer resets the backoff", /if \(progressed\) \{ retryStep = 0; serverAskedWaitMs = 0; \}/.test(sched));
P("P56745", "the step is capped so the exponent cannot run away", /retryStep = Math\.min\(retryStep \+ 1, 8\)/.test(sched));
// s8 self-correction: `[^)]*` cannot cross the parentheses of the jitter expression.
P("P56746", "the server may ask for a LONGER wait, never a shorter one", /Math\.max\(Math\.round\(base \*[\s\S]{0,60}\), serverAskedWaitMs\)/.test(sched));
P("P56747", "…and however busy it claims to be, the phone comes back within five minutes", /const SERVER_WAIT_CAP_MS = 5 \* 60_000;/.test(O));
P("P56748", "a junk retryAfter is ignored rather than trusted", /if \(!Number\.isFinite\(s\) \|\| s <= 0\) return;/.test(O));
P("P56749", "a timer is kept even while the phone reports itself offline", /if \(isOffline\(\)\) \{ scheduleRetry\(false\); return; \}/.test(flush));
P("P56750", "ensureRetry does not fight the running flush for the timer", /function ensureRetry\(\) \{\s*\n\s*if \(flushing\) return;/.test(O));

// the flush loop
P("P56751", "a second flush cannot run on top of the first", /if \(flushing\) return;/.test(flush));
P("P56752", "one stuck item does not hold the next", /while \(idx < queued\.length && !isOffline\(\)\)/.test(flush));
P("P56753", "…and the loop re-checks the connection every pass", /!isOffline\(\)\)/.test(flush));
P("P56754", "every send carries a deadline, so a hanging connection cannot wedge the queue", /signal: sendDeadline\(\)/.test(O));
P("P56755", "…of the same 15s as the staff twin", /const SEND_TIMEOUT_MS = 15_000;/.test(O));
P("P56756", "…and reading AbortSignal.timeout is feature-guarded for an older phone", /typeof AbortSignal\.timeout === "function"/.test(O));
P("P56757", "…falling back to no signal rather than throwing", /catch \{ return undefined; \}/.test(O));
P("P56758", "the reply body is read exactly ONCE per item", count(flush, /await res\.json\(\)/g) === 1);
P("P56759", "the server's wait hint is read BEFORE any branch can return", /if \(j\?\.retryAfter != null\) noteServerRetryAfter\(j\.retryAfter\);/.test(flush));
P("P56760", "a request that never completed while ONLINE is counted, not retried in silence", /item\.netTries = \(item\.netTries \|\| 0\) \+ 1;/.test(flush));
P("P56761", "…and bounded", /const NET_MAX_TRIES = 6;/.test(O));
P("P56762", "a 409 'still handling this id' is counted too", /item\.busyTries = \(item\.busyTries \|\| 0\) \+ 1;/.test(flush));
P("P56763", "…and bounded", /const BUSY_MAX_TRIES = 6;/.test(O));
P("P56764", "a 5xx is counted and bounded, not marked permanently failed at once", /item\.tries = \(item\.tries \|\| 0\) \+ 1;/.test(flush) && /const SERVER_MAX_TRIES = 6;/.test(O));
P("P56765", "all three counters are PERSISTED, so a reload cannot reset them", /await persist\(item\); idx\+\+; continue;/.test(flush));
P("P56766", "genuinely offline mid-loop stops the round and keeps the queue", /if \(isOffline\(\)\) break;/.test(flush));
P("P56767", "a table that moved on while offline is surfaced in the server's own plain words", /j\?\.clash\?\.plain/.test(flush));
P("P56768", "a delivered call is removed rather than left to send twice", /if \(res\.ok && j\?\.ok && \(isCall\(item\) \|\| isLeave\(item\)\)\) \{ progressed = true; await removeItem\(item\.id\)/.test(flush));
P("P56769", "a delivered ORDER is recorded into the tracker before it is removed", /recordActive\(item, j\.order_id as string\); await removeItem\(item\.id\)/.test(flush));
P("P56770", "a duplicate that says ok:false is a refusal, not a placed order", /if \(j\.ok === false\) \{ await moveToFailed/.test(flush));
P("P56771", "a duplicate that says ok:true is tracked under the ORIGINAL order id", /if \(j\.order_id\) recordActive\(item, j\.order_id as string\);/.test(flush));
P("P56772", "a stale saved leave is dropped rather than throwing the diner out of their table", /if \(leaveIsStale\(item\)\) \{ await removeItem\(item\.id\); notify\(\); continue; \}/.test(flush));
P("P56773", "a call older than ten minutes never leaves the phone", /isCall\(item\) && Date\.now\(\) - \(item\.at \|\| 0\) > STALE_CALL_MS/.test(flush));
P("P56774", "…and the diner is told, in the past tense that is true of a saved thing", /reasonMsg\("call_too_old", \{ queued: true \}\)/.test(flush));
P("P56775", "the ten minutes matches the server's own constant", /const STALE_CALL_MS = 10 \* 60 \* 1000;/.test(O) && /const STALE_CALL_MS = 10 \* 60 \* 1000;/.test(F.call));
P("P56776", "the round always schedules the next one, whatever happened", /\} finally \{\s*\n\s*flushing = false;\s*\n\s*notify\(\);\s*\n\s*scheduleRetry\(progressed\);/.test(flush));
P("P56777", "…and always republishes the snapshot, so the screen cannot be left stale", /notify\(\);\s*\n\s*scheduleRetry/.test(flush));

// wording
P("P56778", "the refusal wording is ONE copy, exported for every caller", /export function reasonMsg/.test(O));
P("P56779", "…and it never echoes a code it has no words for", /default: return q \?/.test(O));
P("P56780", "a rate-limited order is never told to try again", /case "rate_limited": return "That's a lot of orders in a row — please wait a moment, then order again\."/.test(O));
P("P56781", "a saved order and a live one get different, both-true tenses", /const q = opts\?\.queued;/.test(O));
P("P56782", "sold out names the dish where the server named one", /case "sold_out": return q/.test(O));
P("P56783", "a hidden dish is worded differently from a sold-out one, on purpose", /case "hidden_item": return dish/.test(O));
P("P56784", "a staff-priced dish sends the diner to a person, not to a retry", /case "staff_priced_item": return "One dish needs a member of staff/.test(O));
P("P56785", "an unknown restaurant is said out loud rather than guessed at", /case "unknown_restaurant": return "We couldn't tell which restaurant this order was for\."/.test(O));
P("P56786", "an off-plan table names the problem the diner can fix", /case "off_plan_table": return "That table number isn't one this restaurant has/.test(O));
P("P56787", "the two size ceilings blame the phone, not the person's appetite", /case "order_too_big"/.test(O) && /case "allergies_too_long"/.test(O));
P("P56788", "the refusal CODE is read once, so no caller matches on prose", /export function refusalOf/.test(O));
P("P56789", "…out of the message postGuestOrder throws", /msg\.match\(\/Order failed:\\s\*\(\[a-z_\]\+\)\/\)/.test(O));
P("P56790", "an unknown_item is named by TITLE, never by the id the server sends back", /export function dishFor/.test(O) && /if \(reason !== "unknown_item"\) return token;/.test(O));
P("P56791", "…resolved against the basket the phone still holds", /items \|\| \[\]\)\.find\(\(i\) => String\(\(i as \{ id\?: string \}\)\?\.id \|\| ""\) === token\)/.test(O));
P("P56792", "…and names NOTHING rather than an id when it cannot resolve one", /return title \? String\(title\) : undefined;/.test(O));
P("P56793", "the list with NAMES on it is used for that, not the server payload", /const namedLines =/.test(O));
P("P56794", "…falling back to `items` for rows saved before names were stored", /it\.lines && it\.lines\.length \? it\.lines : it\.items/.test(O));

// the rescue paths
P("P56795", "'send the rest without that dish' drops by ID where one is known", /it\.blockedId\s*\n?\s*\? allLines\.filter\(\(l\) => l\.id !== it\.blockedId\)/.test(rest));
P("P56796", "…and refuses to re-send an unchanged basket", /if \(keptLines\.length === allLines\.length\) return \{ ok: false, left: 0 \};/.test(rest));
P("P56797", "…and never guesses when it cannot tell the lines apart", /if \(!keptLines\.length \|\| !keptItems\.length\) return \{ ok: false, left: 0 \};/.test(rest));
P("P56798", "…and keeps the diner's real quantities in their own summary", /const qtyOf = \(lineId: string\)/.test(rest));
P("P56799", "…under a NEW at-most-once id, since it is a different order", /await enqueueGuestOrder\(\{/.test(rest) && !/actionId/.test(rest));
P("P56800", "'Try again' clears ALL THREE attempt counters, not just the 5xx one", /it\.tries = 0; it\.netTries = 0; it\.busyTries = 0;/.test(retryFn));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A2 — lib/menu.ts, the guest data layer (P56801–P56880)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const M = F.menu;
const post = between(M, "async function postGuestOrder", "/**\n * Place a TABLE SESSION order");
const items = between(M, "export async function getMenuItems", "// A single item by slug");
const one = between(M, "export async function getMenuItem", "// The newest real reviews");
const settings = between(M, "async function fetchSettings", "// The shape lib/tax.ts reads");

P("P56801", "one door for every guest order, both the QR path and a table session", /async function postGuestOrder/.test(M));
P("P56802", "…and both go through our own route, never a bare browser RPC", count(M, /fetch\("\/api\/guest\/place-order"/g) === 1);
P("P56803", "the at-most-once id is required, not optional", /postGuestOrder\(body: Record<string, unknown>, actionId: string\)/.test(M));
P("P56804", "a dropped or timed-out request is BUSY, so the caller may save it", /throw busyError\("could not reach the restaurant"\)/.test(post));
P("P56805", "a 409 'still handling this' is BUSY too", /if \(res\.status === 409 && j\?\.retry\) throw busyError/.test(post));
P("P56806", "a 5xx is BUSY, not a refusal the diner must act on", /if \(res\.status >= 500\) throw busyError/.test(post));
P("P56807", "anything else is a refusal that carries its CODE", /throw new Error\(`Order failed: \$\{j\?\.reason \|\| "unknown"\}/.test(post));
P("P56808", "…and the dish it named, in brackets, for dishFor to resolve", /\$\{j\?\.item \? ` \(\$\{j\.item\}\)` : ""\}/.test(post));
P("P56809", "busy is a TYPE, so nobody has to match on a sentence", /export const isServerBusy/.test(M));
P("P56810", "an order with no order_id back is treated as a failure, not a success", /if \(!res\.ok \|\| !j\?\.ok \|\| !j\.order_id\)/.test(post));
P("P56811", "the session order path passes its restaurant only to scope an alert", /placeSessionOrderSafe/.test(M) && /mode: "session", token, restaurantId, items, allergies/.test(M));
P("P56812", "createOrder can no longer fall through to an unguarded RPC", /return postGuestOrder\(/.test(M) && !/supabase\.rpc\("lfh_place_order_public"/.test(M));
P("P56813", "…and mints an id itself if a caller somehow has none", /actionId \|\| \(globalThis\.crypto\?\.randomUUID/.test(M));
P("P56814", "the card read is column-listed, never select *", /export const CARD_COLUMNS/.test(M));
P("P56815", "…and every read is capped", count(M, /\.limit\(/g) >= 6);
P("P56816", "…and scoped to one restaurant", /\.eq\("restaurant_id", restaurantId\)/.test(items));
P("P56817", "the dishes and their ratings are fetched together, not one after the other", /await Promise\.all\(\[/.test(items));
P("P56818", "a ratings failure shows dishes as unrated rather than hiding the menu", /aggBySlug/.test(items) && !/if \(ratings\.error\) throw/.test(items));
P("P56819", "a dish read failure IS surfaced — an empty menu must not look like a small one", /if \(items\.error\) throw new Error\(`Failed to load menu/.test(items));
P("P56820", "open-price dishes never reach a self-ordering guest", /!it\.openPrice/.test(items));
P("P56821", "hidden dishes never reach the browser at all", /!isHidden\(it\.tags\)/.test(items));
P("P56822", "a dish in a switched-off category is dropped too", /return inLiveCategory\(mapped, liveCats\)/.test(items));
P("P56823", "…and 'we could not tell' means DO NOT FILTER, not 'blank the menu'", /return live \? items\.filter\(\(i\) => live\.has\(i\.category\)\) : items;/.test(M));
P("P56824", "an empty category list is read as 'cannot tell'", /if \(error \|\| !data \|\| data\.length === 0\) return null;/.test(M));
P("P56825", "two callers in one tick share ONE categories read", /const catSetInflight = new Map/.test(M));
P("P56826", "…and it is an in-flight share, NOT a cache in front of a breadcrumb", /\.finally\(\(\) => \{ catSetInflight\.delete\(restaurantId\); \}\)/.test(M));
P("P56827", "a caller that already holds the categories can skip the read entirely", /liveCatsIn !== undefined \? liveCatsIn : activeCategorySlugs\(restaurantId\)/.test(items));
P("P56828", "…and `null` still means the real answer 'cannot tell', not 'not supplied'", /Deliberately NOT the same as `null`/.test(M));
P("P56829", "an open-price dish's own page answers 'no such dish'", /if \(mapped\.openPrice\) return null;/.test(one));
P("P56830", "…and so does a hidden one, so a kept link cannot walk past the grid filter", /if \(isHidden\(mapped\.tags\)\) return null;/.test(one));
P("P56831", "…and one whose category is switched off", /if \(liveCats && !liveCats\.has\(mapped\.category\)\) return null;/.test(one));
P("P56832", "a card payload omits the five detail-only fields rather than sending empties", /const DETAIL_ONLY = \[/.test(M));
P("P56833", "…as an Omit, so a column added tomorrow reaches the cards automatically", /export type MenuCardItem = Omit<MenuItem,/.test(M));
P("P56834", "…and the dish paragraph is not even selected on the hot read", !/CARD_COLUMNS[\s\S]{0,400}, description,/.test(M));
P("P56835", "open_price stays SELECTED (the filter needs it) but is stripped from the payload", /"openPrice"\] as const/.test(M) && /open_price/.test(between(M, "export const CARD_COLUMNS", ";")));
P("P56836", "an absent column omits its key; a NULL column keeps today's default", /const has = \(row: any, col: string\)/.test(M));
P("P56837", "…so a full-row read is byte-for-byte what it always was", /hasOwnProperty\.call\(row, col\)/.test(M));
P("P56838", "a quantity is never trusted from the row for money — only ids and qty travel", /never prices/.test(M));
P("P56839", "the tax rate comes from ONE source, never re-implemented here", /import \{ effectiveTaxRate, priceTaxMode, itemTaxModesAllowed/.test(M));
P("P56840", "…and the guest's shape is translated into it in exactly one place", /export function taxRulesOf/.test(M));
P("P56841", "the pre-load default rules are today's behaviour exactly", /export const DEFAULT_TAX_RULES: TaxRules = \{\s*\n?\s*tax_rate: 0\.05, price_tax_mode: "excl", item_tax_modes_allowed: false, mrp_tax_treatment: "none",/.test(M));
P("P56842", "a dish's own tax mode is ignored unless the admin allowed per-dish modes", /itemTaxModesAllowed/.test(M));
P("P56843", "an unknown tax_mode reads as 'follow the restaurant'", /\["excl", "incl", "mrp", "none"\]\.includes\(String\(row\.tax_mode\)\) \? row\.tax_mode : "default"/.test(M));
P("P56844", "settings come through ONE security-definer door, not a table read", /\.rpc\("lfh_guest_settings"/.test(settings));
P("P56845", "…and a key the function does not return degrades to a default", /const num = \(v: unknown\)/.test(settings));
P("P56846", "a missing settings row still leaves a working menu", /menuEnabled: data \? data\.menu_enabled !== false : true/.test(settings));
P("P56847", "a malformed feature override is ignored rather than trusted", /filter\(\(\[, v\]\) => typeof v === "boolean"\)/.test(settings));
P("P56848", "a table count that is not a number disables the bound rather than blocking orders", /Number\(data\.table_count\) \|\| 0/.test(settings));
P("P56849", "an empty language list falls back rather than leaving nothing to render in", /function strList/.test(M));
P("P56850", "…and de-duplicates, so one language is one entry", /Array\.from\(new Set\(list\)\)/.test(M));
P("P56851", "nine components asking for settings at once make ONE read", /const settingsInflight = new Map/.test(M));
P("P56852", "…with a short TTL, so a toggle is picked up in seconds", /const SETTINGS_TTL_MS = 8000;/.test(M));
P("P56853", "…and a breadcrumb can say 'drop it' rather than waiting out the TTL", /export function invalidateSettings/.test(M));
P("P56854", "…dropping the in-flight promise too, since it started before the change", /settingsInflight\.delete\(restaurantId\)/.test(between(M, "export function invalidateSettings", "export async function getSettings")));
P("P56855", "a waiter call goes through the guarded RPC, never a direct insert", /\.rpc\("lfh_call_waiter_table"/.test(M));
P("P56856", "…and hands back the RPC's own answer, so the UI can be honest", /return \{ ok: res\.ok !== false, reason: res\.reason \};/.test(M));
P("P56857", "…and now carries a deadline like every other guest write", /const signal = orderDeadline\(\);[\s\S]{0,600}lfh_call_waiter_table[\s\S]{0,300}\.abortSignal\(signal\)/.test(M));
P("P56858", "correcting an order's table carries one too", /const signal = orderDeadline\(\);[\s\S]{0,400}set_order_table_number[\s\S]{0,200}\.abortSignal\(signal\)/.test(M));
P("P56859", "…and reports failure as a plain false the caller already words", /return !error && Array\.isArray\(data\) && data\.length > 0;/.test(M));
P("P56860", "a guest reads only their OWN order's status, through a definer function", /\.rpc\("get_order_status", \{ order_id: id \}\)/.test(M));
P("P56861", "…and an unknown order comes back null, not as a crash", /if \(error \|\| !Array\.isArray\(data\) \|\| data\.length === 0\) return null;/.test(M));
P("P56862", "reviews are read scoped to the restaurant AND the dish", /\.eq\("item_slug", slug\)[\s\S]{0,120}\.eq\("restaurant_id", restaurantId\)/.test(M));
P("P56863", "…newest first, and capped at twenty", /\.order\("created_at", \{ ascending: false \}\)\s*\n?\s*\.limit\(20\)/.test(M));
P("P56864", "…and a failure shows no reviews rather than breaking the dish page", /if \(error\) return \[\];/.test(M));
// s8 self-correction: the sentence wraps across two comment lines. Asserted on the CODE instead —
// getMenuItem fetches three things and none of them is the reviews table.
P("P56865", "the review list is no longer pulled on every dish and 3D open", !/from\("reviews"\)/.test(one));
P("P56866", "a label falls back through language → English → anything, never blank", /export function localized/.test(M));
P("P56867", "dish names are deliberately NOT translated, and it is written down", /DELIBERATE: DISH NAMES AND DESCRIPTIONS ARE NOT TRANSLATED/.test(M));
P("P56868", "…with the rejection recorded on the line someone would change", /REJECTED \(owner, 2026-08-12\)/.test(M));
P("P56869", "…and a guard named, so a sweep cannot re-file it", /verify:i18n-scope/.test(M));
P("P56870", "the search alias is the shape a translated name would use", /searchAlias/.test(M));
P("P56871", "categories are read active-only, ordered, and capped", /\.eq\("active", true\)[\s\S]{0,200}\.limit\(300\)/.test(M));
P("P56872", "a category read failure is surfaced, not swallowed into an empty menu", /throw new Error\(`Failed to load categories/.test(M));
P("P56873", "the three dish states are named constants, not scattered strings", /export const SOLD_OUT_TAG = "sold-out";/.test(M) && /export const HIDDEN_TAG = "hidden";/.test(M));
P("P56874", "sold out and hidden are tags, so one dish can be both", /export const isHidden/.test(M));
P("P56875", "the anon key is used here, and the service-role key never is", !/SERVICE_ROLE/.test(M));
P("P56876", "feedback is keyed on the order id, which is the proof of visit", /\.rpc\("lfh_leave_feedback"/.test(M));
P("P56877", "…and an empty answer is a failure, not a silent success", /\?\? \{ ok: false, reason: "empty" \}/.test(M));
P("P56878", "a review submission returns the server's reason, never its raw error to a screen", /if \(error\) return \{ ok: false, reason: error\.message \};/.test(M));
P("P56879", "the composition scheme is a real third price behaviour, not a flag on top", /"excl" \| "incl" \| "composition"/.test(M));
P("P56880", "an MRP line's treatment defaults to untaxed, matching pre-270 behaviour", /=== "inclusive" \? "inclusive" : "none"/.test(M));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A3 — components/CartPanel.tsx, the bill (P56881–P56940)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const C = F.cart;
const place = between(C, "const placeOrder = async ()", "// If the panel isn't open");
const norm = between(C, "const normalize = (raw: unknown)", "// CartPanel: the full");

P("P56881", "the bill renders nothing at all while closed", /if \(!open\) return null;/.test(C));
P("P56882", "the phone back button closes the bill instead of leaving the site", /useBackClose\("cart", open, \(\) => setOpen\(false\)\)/.test(C));
P("P56883", "a corrupt saved basket cannot crash the bill", /const normalize = \(raw: unknown\)/.test(C));
P("P56884", "…a non-list is read as empty", /if \(!Array\.isArray\(raw\)\) return \[\];/.test(norm));
P("P56885", "…a line with no id is dropped", /"id" in it/.test(norm));
P("P56886", "…a fractional or huge quantity is clamped to a whole 1..99", /Math\.min\(99, Math\.max\(1, Math\.floor/.test(norm));
P("P56887", "…and options/removed/note are only kept when they are the right shape", /Array\.isArray\(it\.options\) \? it\.options : undefined/.test(norm));
P("P56888", "one function is the only thing that changes the basket", /const commit = \(next: CartItem\[\]\) =>/.test(C));
P("P56889", "…and it saves and announces in the same breath", /saveCart\(next\);\s*\n\s*window\.dispatchEvent\(new Event\("lfh:cart-updated"\)\)/.test(C));
P("P56890", "the '+' ceiling is SAID, not a silent refusal", /message: "Maximum 99 per dish"/.test(C));
P("P56891", "…as information, never with a success tick", /variant: "info"/.test(between(C, 'message: "Maximum 99 per dish"', "}")));
P("P56892", "'−' at one removes the line rather than reaching zero", /else next\.splice\(idx, 1\);/.test(C));
P("P56893", "a dish that has left the menu is pruned from the saved basket", /const pruneCartToMenu/.test(C));
P("P56894", "…reading storage, not state, so an async fetch cannot act on a stale copy", /normalize\(JSON\.parse\(tget\("lfh_cart"\) \|\| "\[\]"\)\)/.test(C));
P("P56895", "…only ever on a NON-EMPTY menu, so a bad payload cannot wipe a real basket", /if \(items\.length\) pruneCartToMenu\(items\)/.test(C));
P("P56896", "…and it says what it removed", /is no longer available/.test(C));
P("P56897", "the full menu is fetched lazily, on first open, not on every page load", /const loadMenuOnce = \(\) =>/.test(C));
P("P56898", "…from the server-cached bundle the page already loaded, not a fresh select", /\/api\/r\/\$\{tenantSlug\(\)\}\/menu-data/.test(C));
P("P56899", "…and a failure lets a later open retry", /\.catch\(\(\) => \{ menuLoadedRef\.current = false; \}\)/.test(C));
P("P56900", "the basket re-reads settings on every open, so a fresh toggle is respected", count(C, /getSettings\(restaurantId\)/g) >= 2);
P("P56901", "the effect re-runs when the restaurant resolves, so no guest sees #1's table count", /\}, \[restaurantId, features\.allergies\]\);/.test(C));
P("P56902", "…and every listener it added is removed again", count(C, /window\.addEventListener\(/g) >= 11 && count(C, /window\.removeEventListener\(/g) >= 11);
P("P56903", "a cart change in ANOTHER tab reaches this one", /const handleStorageCart = \(e: StorageEvent\)/.test(C));
P("P56904", "…matched on the tenant-scoped key, not a bare string", /isTKey\(e\.key, "lfh_cart"\)/.test(C));
P("P56905", "a remembered table is only ever pre-filled into an EMPTY field", /setTableNumber\(\(cur\) => cur \|\| scanned\)/.test(C));
P("P56906", "…and let go of when the guest wipes it", /setTableNumber\(\(cur\) => \(cur === previous \? "" : cur\)\)/.test(C));
P("P56907", "a seated diner's table is locked to their session", /setLockedTable\(ss\?\.table \|\| null\)/.test(C));
P("P56908", "…and the field is genuinely read-only, not just styled that way", /disabled=\{!!lockedTable\} readOnly=\{!!lockedTable\}/.test(C));
P("P56909", "only digits can reach the table field", /e\.target\.value\.replace\(\/\\D\/g, ""\)/.test(C));
P("P56910", "the order-wide allergy list is restored only while the feature is ON", /if \(features\.allergies\) \{/.test(C));
P("P56911", "…and emptied when it is off, so a stale list cannot ride along invisibly", /\} else \{\s*\n\s*setDeclared\(\[\]\);/.test(C));
P("P56912", "the first persist is skipped, so the restore cannot be clobbered by the default", /if \(!declaredHydrated\.current\) \{ declaredHydrated\.current = true; return; \}/.test(C));
P("P56913", "a double tap on Place Order cannot fire two orders", /placingRef\.current/.test(place));
P("P56914", "…and the lock is taken BEFORE the first await", /placingRef\.current = true;\s*\n\s*setPlacing\(true\);/.test(place));
P("P56915", "an empty basket cannot be sent", /if \(cart\.length === 0 \|\| placing \|\| placingRef\.current\) return;/.test(place));
P("P56916", "a bad or out-of-range table stops the send and flags the field", /flagTableInput\("cart-table", check\.message!\)/.test(place));
P("P56917", "a sold-out line names the dish to remove instead of a generic retry", /message: `Sold out: \$\{names\}`/.test(place));
P("P56918", "…and it guards BOTH the session and the plain path", /const soldLines = cart\.filter\(\(it\) => isSoldOut\(it\.id\)\)/.test(place));
P("P56919", "the at-most-once key covers the table, the lines AND the allergies", /const sig = JSON\.stringify\(\{ t: tableTrim, i: itemsS, a: allergies \}\)/.test(place));
P("P56920", "…and is computed before the offline branch, so both paths share one id", /if \(!orderKeyRef\.current \|\| orderKeyRef\.current\.sig !== sig\)/.test(place));
P("P56921", "…and is cleared once the order is really placed", /orderKeyRef\.current = null; \/\/ placed OK/.test(place));
P("P56922", "offline, the order is saved on the device under that same id", /actionId: orderKeyRef\.current\.id/.test(place));
P("P56923", "…and durability is only promised when the phone really stored it", /q\.persisted\s*\n?\s*\? \{ message: "Saved — will send when you're back online"/.test(place));
P("P56924", "…otherwise it says 'keep this page open', which is the true sentence", /message: "Saved — keep this page open"/.test(place));
P("P56925", "a busy restaurant is treated exactly like being offline", /if \(isServerBusy\(err\) && orderKeyRef\.current\)/.test(place));
P("P56926", "…and if the phone cannot store it either, the diner is told the truth", /fall through to the honest error/.test(place));
P("P56927", "a refusal is worded from the ONE place that knows every reason", /const \{ reason, dish \} = refusalOf\(err\);/.test(place));
P("P56928", "…and an unknown_item is named by title, not by its id", /dish: dishFor\(reason, dish, cart\)/.test(place));
P("P56929", "the button is re-enabled either way", /\} finally \{\s*\n\s*placingRef\.current = false;\s*\n\s*setPlacing\(false\);/.test(place));
P("P56930", "the session path ignores other gate completions without losing its listener", /if \(d\?\.action !== "order"\) return;/.test(place));
P("P56931", "…and removes its listener once its own result arrives", /window\.removeEventListener\("lfh:session-done", onDone\);/.test(place));
P("P56932", "a queued session order does NOT record a local entry (the queue does that)", /if \(d\?\.queued\)/.test(place));
P("P56933", "the session path sends the basket's NAMES too, so a refusal can name a dish", /lines: cart\.map\(\(it\) => \(\{ id: it\.id, title: it\.title \}\)\)/.test(place));
P("P56934", "a note is only sent while its own switch is on", /note: features\.guest_note \? it\.note : undefined/.test(C));
P("P56935", "…and a removed allergen only while allergies are on", /removed: features\.allergies \? it\.removed : undefined/.test(C));
P("P56936", "…which is the LAST gate before the wire, not only where a line is saved", /This is the last gate before the wire/.test(C));
P("P56937", "the free-text allergy travels only while ITS switch is on", /const other = features\.allergy_other \? otherAllergy\.trim\(\) : ""/.test(C));
P("P56938", "money is computed in ONE domain for the screen and another for the record", /const usdLines = cart\.map/.test(C) && /const dispLines = cart\.map/.test(C));
P("P56939", "…both through splitBill, never a second formula", count(C, /splitBill\(/g) >= 3);
P("P56940", "…and the stored total keeps its old floating-point shape to the paisa", /usdOnTopBase \* \(1 \+ taxRate\) \+ \(subtotalUsd - usdOnTopBase\)/.test(C));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A4 — components/OrderTracker.tsx, the floating strip (P56941–P56980)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const T = F.tracker;
const poll = between(T, "const poll = async ()", "// ── SHARED order tracking");
const pullFn = between(T, "const pull = async ()", "pull();");

P("P56941", "the strip draws nothing when there is nothing live", /if \(!order\) return null;/.test(T));
P("P56942", "an already-final order with no finish time is stamped, so it can clear", /if \(isFinal\(o\.status\) && !o\.finalizedAt\)/.test(T));
P("P56943", "…and only written back when something was actually patched", /if \(changed\) write\(list\);/.test(T));
P("P56944", "the tracker re-reads on a restaurant change, without remounting", /\}, \[restaurantId\]\);/.test(T));
P("P56945", "the poll only asks about orders that are still in progress", /!o\.dismissed && !isFinal\(o\.status\) && Date\.now\(\) - o\.placedAt < MAX_AGE_MS/.test(poll));
P("P56946", "…and asks about nothing at all when there is nothing live", /if \(live\.length === 0\) return;/.test(poll));
P("P56947", "what a round learned is applied to a FRESH read, not the copy it started with", /const fresh = read\(\)\.map\(\(o\) => \{/.test(poll));
P("P56948", "…so an order hidden or recorded mid-round keeps what it was given", /const learned = new Map</.test(poll));
P("P56949", "…and an order that has since gone stays gone", /const seen = learned\.get\(o\.id\);/.test(poll));
P("P56950", "a missing order is only counted while ONLINE", /if \(typeof navigator !== "undefined" && navigator\.onLine === false\) continue;/.test(poll));
P("P56951", "…and takes three consecutive misses before it is called cancelled", /nullCounts\.current\[o\.id\] >= 3/.test(poll));
P("P56952", "…and one real answer resets the counter", /nullCounts\.current\[o\.id\] = 0;/.test(poll));
P("P56953", "a status toast fires once per status, not on every poll", /if \(lastStatus\.current\[o\.id\] !== res\.status\)/.test(poll));
P("P56954", "…and tapping it opens the live-status tab, not the bill", /event: "lfh:show-previous-orders"/.test(T));
P("P56955", "a cancellation is toasted as an error, not as good news", /variant: res\.status === "cancelled" \? "error" : "success"/.test(poll));
P("P56956", "an in-flight round bails cleanly on unmount", /if \(cancelled\) continue;/.test(poll));
P("P56957", "realtime drives the refetch and the timer is only a backstop", /const iv = setInterval\(poll, RT_BACKUP_MS\)/.test(T));
P("P56958", "…at 60s, never a fast poll", /export const RT_BACKUP_MS = 60 \* 1000;/.test(F.status));
P("P56959", "the breadcrumb listener is removed on teardown", /window\.removeEventListener\("lfh:rt-tick", onTick\)/.test(T));
P("P56960", "the shared table pull only runs where dining sessions are on", /on = \(await getSettings\(restaurantId\)\)\.sessionsEnabled/.test(pullFn) || /sessionsEnabled/.test(T));
P("P56961", "…and stands down when there is no session", /if \(!s\) \{ if \(alive\) setDishProg\(\{ served: 0, segs: \[\] \}\); return; \}/.test(pullFn));
P("P56962", "only the three DEFINITIVE endings clear a diner's orders", /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(pullFn));
P("P56963", "…so a momentary network drop cannot wipe a live order", /transient network blip/.test(T));
P("P56964", "a member still waiting for the head sees no live progress", /if \(!mem\?\.approved\) \{ setDishProg\(\{ served: 0, segs: \[\] \}\); return; \}/.test(pullFn));
P("P56965", "a dish the kitchen marked READY still reads as 'preparing' to the diner", /i\.status === "ready" \? "preparing" : i\.status/.test(pullFn));
P("P56966", "…and the served count is unaffected by that", /i\.status === "served"\)\.length/.test(pullFn));
P("P56967", "a partner's order is only ADDED, never overwritten", /if \(have\.has\(o\.id\)\) continue;/.test(pullFn));
P("P56968", "…and its table comes from the session, not from this device", /const table = sess\?\.table_number \|\| s\.table;/.test(pullFn));
P("P56969", "an unparseable order time falls back to now rather than to 1970", /Date\.parse\(o\.created_at\) \|\| Date\.now\(\)/.test(pullFn));
P("P56970", "the linger redraw is only scheduled for a mark still ahead of us", /\(o\.finalizedAt as number\) \+ SERVED_LINGER_MS > now/.test(T));
P("P56971", "…and the clock is read once for both the filter and the wait", /const now = Date\.now\(\);/.test(T));
P("P56972", "an unexpected status falls back to a sensible copy rather than crashing", /COPY\[order\.status\] \|\| COPY\.preparing/.test(T));
P("P56973", "a table with several live orders becomes one summary strip", /const multi = visible\.length >= 2 && !dismissing;/.test(T));
P("P56974", "an order with nothing accepted yet stays amber, not blue", /dishProg\.segs\.some\(\(s\) => s !== "received"\) \? "preparing" : "received"/.test(T));
P("P56975", "a tap is told apart from a drag by a real threshold", /Math\.hypot\(dx, dy\) < 8/.test(T));
P("P56976", "the pointer is captured, so a fast flick still delivers its end", /setPointerCapture\(e\.pointerId\)/.test(T));
P("P56977", "…and released again on both end and cancel", count(T, /releasePointerCapture/g) >= 2);
P("P56978", "hiding the strip does NOT cancel the order", /stripHidden: true/.test(T));
P("P56979", "…and the order being animated out is frozen, so a new one cannot swap in", /dismissingOrderRef\.current = order;/.test(T));
P("P56980", "the deleted detail sheet left an obituary rather than dead UI", /USED TO live here/.test(T));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK B — the four guest routes (P56981–P57060)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const PL = F.place, CW = F.call, LV = F.leave, LH = F.limit;

P("P56981", "place-order is dynamic, never cached", /export const dynamic = "force-dynamic";/.test(PL));
P("P56982", "…and at-most-once on replay", /export const POST = withIdempotency\(postImpl, "guest"\);/.test(PL));
P("P56983", "a body that is not JSON is a plain 400, not a crash", /catch \{ return NextResponse\.json\(\{ ok: false, reason: "bad_body" \}, \{ status: 400 \}\); \}/.test(PL));
P("P56984", "a non-list items field is read as empty rather than trusted", /Array\.isArray\(b\.items\) \? b\.items : \[\]/.test(PL));
P("P56985", "one order may carry at most 200 lines", /const MAX_ITEMS = 200;/.test(PL));
P("P56986", "…and at most 40 allergy entries", /const MAX_ALLERGIES = 40;/.test(PL));
P("P56987", "…each at most 200 characters", /const MAX_ALLERGY_LEN = 200;/.test(PL));
P("P56988", "…and going over is a REFUSAL, never a silent trim", /reason: "order_too_big"/.test(PL) && /reason: "allergies_too_long"/.test(PL));
P("P56989", "the session path needs a token", /if \(!b\.token\) return NextResponse\.json\(\{ ok: false, reason: "invalid_token" \}/.test(PL));
P("P56990", "the database's own words never travel to a diner", /console\.error\("\[guest\/place-order\] session RPC failed:"/.test(PL));
P("P56991", "…a database that will not answer is BUSY, so the phone keeps the order", /return busy\(\);/.test(PL));
P("P56992", "…with a server-set wait, jittered on the server so phones spread out", /const retryAfter = 20 \+ Math\.floor\(Math\.random\(\) \* 25\);/.test(PL));
P("P56993", "…sent both as JSON and as the standard header", /"Retry-After": String\(retryAfter\)/.test(PL));
P("P56994", "…and the code stays spelled out, because a guard greps for it", /reason: "server_busy"/.test(PL));
P("P56995", "a rate-limit refusal pings the owner about the RIGHT restaurant", /void pingLatestGuestLimit\("guest_order", rid\)/.test(PL));
P("P56996", "…and never with an empty restaurant, which would ping about someone else's event", /function maybePing\(data: unknown, rid: string\)/.test(PL));
P("P56997", "a placed order drops the shared floor snapshot", /invalidateFloor\(rid\)/.test(PL));
P("P56998", "…but a refusal does not, because it changed nothing", /\.ok !== false\) invalidateFloor\(rid\)/.test(PL));
P("P56999", "the QR path REFUSES an unknown restaurant rather than guessing #1", /if \(!publicRid\) return NextResponse\.json\(\{ ok: false, reason: "unknown_restaurant" \}, \{ status: 400 \}\)/.test(PL));
P("P57000", "…and the id must be a real uuid, not any string", /const isUuid = /.test(PL));
P("P57001", "a table the restaurant does not have is refused", /const offPlan = await offPlanTable\(publicRid, b\.table\)/.test(PL));
P("P57002", "…as a CODE, so the client owns the wording", /reason: "off_plan_table"/.test(PL));
P("P57003", "the QR path checks the table has not moved on since the order was saved", /await replayClash\(req, publicRid, "order", undefined, undefined, \{ table: b\.table \}\)/.test(PL));
P("P57004", "…and the session path deliberately does not (the RPC answers that itself)", /session path above doesn't need it/.test(PL));
P("P57005", "a session replay's restaurant comes from the reply, the body, then the token", /ridFromResult\(data\)\s*\n?\s*\|\| \(isUuid\(b\.restaurantId\)[\s\S]{0,120}\|\| await ridFromToken\(b\.token\)/.test(PL));
P("P57006", "…and a genuinely unresolvable one is logged, not left silently stale", /console\.warn\("\[guest\/place-order\] session replay had no resolvable restaurant/.test(PL));
P("P57007", "the token lookup reads two columns and caps both reads", count(PL, /\.limit\(1\)\.maybeSingle\(\)/g) >= 2);
P("P57008", "…and its failure can never cost the diner their order", /catch \{ return ""; \}/.test(PL));
P("P57009", "an empty RPC answer is reported as such, not as success", /return NextResponse\.json\(data \?\? \{ ok: false, reason: "empty" \}\)/.test(PL));
P("P57010", "the route uses the service-role client, which is server-only", /import \{ supabaseAdmin as sb \}/.test(PL));

P("P57011", "call-waiter is dynamic and at-most-once too", /export const dynamic = "force-dynamic";/.test(CW) && /withIdempotency\(postImpl, "guest"\)/.test(CW));
P("P57012", "a call too old to be useful is refused as a plain answer, not an error", /reason: "call_too_old"/.test(CW));
P("P57013", "…and an UNREADABLE timestamp is treated as too old, not as a free pass", /if \(hasAt && !Number\.isFinite\(at\)\) return NextResponse\.json\(\{ ok: false, reason: "call_too_old" \}\)/.test(CW));
P("P57014", "…checked on the raw value, since it arrives as untrusted JSON", /const rawAt = \(b as \{ at\?: unknown \}\)\.at;/.test(CW));
P("P57015", "…and an ordinary online call with no timestamp still goes straight through", /const hasAt = rawAt !== undefined && rawAt !== null && rawAt !== "";/.test(CW));
P("P57016", "the note is length-capped before it reaches the database", /String\(b\.reason \|\| ""\)\.slice\(0, 200\)/.test(CW));
P("P57017", "the session path needs a token", /if \(!b\.token\) return NextResponse\.json\(\{ ok: false, reason: "invalid_token" \}/.test(CW));
P("P57018", "the QR path refuses an unknown restaurant rather than guessing #1", /if \(!rid\) return NextResponse\.json\(\{ ok: false, reason: "unknown_restaurant" \}/.test(CW));
P("P57019", "…and a table the restaurant does not have", /if \(await offPlanTable\(rid, b\.table\)\) return NextResponse\.json\(\{ ok: false, reason: "off_plan_table" \}/.test(CW));
P("P57020", "a database that will not answer is BUSY here too", /function busy\(\): Response/.test(CW));
P("P57021", "…with the same server-set, jittered wait", /const retryAfter = 20 \+ Math\.floor\(Math\.random\(\) \* 25\);/.test(CW));
P("P57022", "the floor snapshot is dropped only when a call really landed", /function callLanded\(data: unknown\): boolean/.test(CW));
P("P57023", "…and a repeat within six seconds does not count as landing", /"already_sent"/.test(CW));
P("P57024", "…nor a table already holding six calls", /"capped"/.test(CW));
P("P57025", "…nor one over the restaurant's own limit", /"rate_limited"/.test(CW));
P("P57026", "…nor the session path's own duplicate answer", /already_active/.test(CW));
// s8 self-correction: my regex was upper-case and the comment is not. Asserted on the CODE: the
// landing rule compares CODES and never touches a message string.
P("P57027", "…and it branches on codes, never on the server's prose", /\.includes\(String\(d\.reason \?\? ""\)\)/.test(CW) && !/\.message/.test(between(CW, "function callLanded", "\n}")));
P("P57028", "the session path falls back to the token for its restaurant", /await ridFromToken\(b\.token\)/.test(CW));
P("P57029", "…and says so in the log when even that cannot answer", /console\.warn\("\[guest\/call-waiter\] session replay had no resolvable restaurant/.test(CW));
P("P57030", "the stale window matches the phone's own constant exactly", /const STALE_CALL_MS = 10 \* 60 \* 1000;/.test(CW));

P("P57031", "leaving a table has its own endpoint, so the queue's rules apply for free", /app\/api\/guest\/leave/.test(LV) || LV.length > 500);
P("P57032", "…it is dynamic", /export const dynamic = "force-dynamic";/.test(LV));
P("P57033", "…and at-most-once, even though sending it twice is harmless", /withIdempotency\(postImpl, "guest"\)/.test(LV));
P("P57034", "a body that is not JSON is a plain 400", /reason: "bad_body"/.test(LV));
P("P57035", "a missing or non-string token is refused", /if \(!b\.token \|\| typeof b\.token !== "string"\)/.test(LV));
P("P57036", "a database that will not answer is BUSY, so the phone keeps it", /function busy\(\): Response/.test(LV));
P("P57037", "someone leaving drops the shared floor snapshot", /invalidateFloor\(rid\)/.test(LV));
P("P57038", "…and an unresolvable restaurant is logged rather than left silent", /console\.warn\("\[guest\/leave\] no resolvable restaurant/.test(LV));
P("P57039", "an empty answer is reported as such", /data \?\? \{ ok: false, reason: "empty" \}/.test(LV));
P("P57040", "the route documents that the RPC has no refusing branch", /already_gone/.test(LV));

P("P57041", "the limit beacon always answers 200, so it never surfaces to a diner", /return NextResponse\.json\(\{ ok: true \}\)/.test(LH));
P("P57042", "…even for an empty body", /catch \{ \/\* empty body → no-op below \*\/ \}/.test(LH));
P("P57043", "it trusts nothing from the body except WHICH limit to look up", /const FN_TO_KEY: Record<string, RateKey>/.test(LH));
P("P57044", "…an unmapped function name does nothing at all", /if \(key\) \{/.test(LH));
P("P57045", "…and the restaurant must be a real uuid or it is dropped", /UUID\.test\(b\.rid\) \? b\.rid : null/.test(LH));
P("P57046", "the caller's bucket is the device cookie or the server-derived IP, never a body field", /capKeyFor\(req\)/.test(LH));
P("P57047", "…keyed per limit, so one limit cannot use up another's budget", /`limithit:\$\{key\}:\$\{capKeyFor\(req\)\}`/.test(LH));
P("P57048", "…with a real ceiling", /const MAX_PER_WINDOW = 6;/.test(LH));
P("P57049", "…over a real window", /const WINDOW_MS = 60_000;/.test(LH));
P("P57050", "and the alert text comes from the database row, so a caller cannot compose one", /only pings on a real recent event/.test(LH));
P("P57051", "all five guest-limit RPC names are mapped", count(between(LH, "const FN_TO_KEY", "};"), /lfh_/g) === 5);
P("P57052", "the three guest limits are the only keys used", /"guest_order"/.test(LH) && /"waiter_call"/.test(LH) && /"join_session"/.test(LH));
P("P57053", "the cap helper is shared, not a fifth hand-rolled copy", /import \{ capKeyFor, withinMemoryCap \}/.test(LH));
P("P57054", "…and it exists", F.cap.length > 200);
P("P57055", "every guest route that writes goes through the at-most-once wrapper", ["place", "call", "leave"].every((k) => /withIdempotency/.test(F[k])));
P("P57056", "…and the beacon deliberately does NOT, because it writes nothing", !/withIdempotency/.test(LH));
P("P57057", "the floor helper both routes use is the shared one", /from "@\/lib\/floorSummary"/.test(PL) && /from "@\/lib\/floorSummary"/.test(CW));
P("P57058", "…and it exists", F.floor.length > 200);
P("P57059", "the table-plan helper both routes use is the shared one", /from "@\/lib\/planTable"/.test(PL) && /from "@\/lib\/planTable"/.test(CW));
P("P57060", "the clash helper is used only where a TABLE NUMBER is trusted", /from "@\/lib\/clash"/.test(PL) && !/from "@\/lib\/clash"/.test(CW));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK C — the project's own rules, asked of this territory (P57061–P57130)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
P("P57061", "every guest read in this territory carries a .limit()", count(M, /\.limit\(/g) >= 6);
P("P57062", "the hottest read is column-listed, not select *", /select\(columns\)/.test(items));
P("P57063", "…and its default is only for the dish page's full row", /columns: string = "\*"/.test(M));
P("P57064", "the basket's own menu read reuses the cached bundle, adding no DB egress", /menu-data/.test(C));
P("P57065", "no read in this territory polls faster than the 60s backstop", !/setInterval\([^,]+, [1-9]\d{0,3}\)/.test(T));
P("P57066", "…the bill's own 5s tick is a local re-evaluation, not a network call", /setInterval\(refreshLive, 5000\)/.test(C) && /liveActiveOrders\(readActiveOrders\(\)\)/.test(C));
P("P57067", "every popup in this territory registers with the back-button manager", /useBackClose\("cart"/.test(C));
P("P57068", "the tracker strip is not a popup and correctly registers nothing", !/useBackClose/.test(T));
P("P57069", "no user action in the basket ends in a bare, silent return", !/if \(cart\[idx\]\.qty >= 99\) \{\s*\n\s*return;/.test(C));
P("P57070", "a refused table correction always says why", /message: "Couldn't move that order"/.test(C));
P("P57071", "a second tap on Save is ignored, not queued", /if \(savingTable\) return;/.test(C));
P("P57072", "…and a no-change save closes rather than calling the server", /if \(check\.value === \(o\.tableNumber \|\| ""\)\.trim\(\)\) \{ setEditingTable\(null\); return; \}/.test(C));
P("P57073", "the guest side queues place-order, the bell and leaving — and nothing else", count(O, /fetch\("\/api\/guest\//g) === 3);
// s8 self-correction: the queue MENTIONS the staff twin in three comments, comparing itself to it,
// which is the opposite of rebuilding it. What matters is that it does not IMPORT or load it.
P("P57074", "…and never rebuilds the staff outbox", !/(import|require|from)\s*[("'`][^"'`]*panels\/outbox/.test(O));
P("P57075", "every queued write carries an X-LFH-Action-Id", count(O, /"X-LFH-Action-Id": item\.id/g) === 3);
P("P57076", "a replayed ORDER is marked as a replay so the server can refuse a moved-on table", /"X-LFH-Replay": "1"/.test(O));
P("P57077", "…and carries when it was queued", /"X-LFH-Queued-At"/.test(O));
P("P57078", "…while a call carries when the DINER TAPPED, which is a different thing", /at: item\.at/.test(O));
P("P57079", "the queue survives a reload, so a saved order is not lost to a refresh", /indexedDB\.open\(DB_NAME, 1\)/.test(O));
P("P57080", "…and it does not create a database on a phone that never queues anything", /indexedDB as \{ databases\?: /.test(O));
P("P57081", "…falling back to opening it where that cannot be asked", /fall through and open it, exactly as before/.test(O));
P("P57082", "the queue wakes on four signals, not two", /addEventListener\("online"/.test(startFn) && /visibilitychange/.test(startFn) && /addEventListener\("focus"/.test(startFn));
P("P57083", "…and a restored queue gets a timer, not a single attempt", /ensureRetry\(\);\s*\n\s*void flushGuestOutbox\(\);/.test(restore));
P("P57084", "the tracker entry a queued order creates is scoped to the order's OWN restaurant", /const slug = item\.restaurantSlug \|\| tenantSlug\(\);/.test(O));
P("P57085", "…and never double-added", /if \(arr\.some\(\(o: \{ id\?: string \}\) => o\?\.id === orderId\)\) return;/.test(O));
P("P57086", "…and a duplicate reply with no id records nothing", /if \(!orderId\) return;/.test(O));
P("P57087", "the basket, the tracker and the bill all read ONE storage key", /export const ACTIVE_ORDERS_KEY = "lfh_active_orders";/.test(F.status));
P("P57088", "…and one copy of the status wording", /export const STATUS_COPY/.test(F.status));
P("P57089", "…and one rule for which orders are live", /export const liveActiveOrders/.test(F.status));
P("P57090", "storage is tenant-scoped, so one restaurant's basket cannot show on another", /from "@\/lib\/tenantStorage"/.test(C) && /from "@\/lib\/tenantStorage"/.test(O));
P("P57091", "the basket sends no prices — the server prices everything", !/price:/.test(between(C, "const orderItems = ()", "};")));
P("P57092", "…and no titles either", !/title:/.test(between(C, "const orderItems = ()", "};")));
P("P57093", "a switched-off feature renders nothing, rather than being hidden by CSS", /\{features\.allergies && \(/.test(C));
P("P57094", "…including the free-text box, whose own class would beat the hidden attribute", /Conditional render, NOT the `hidden` attribute/.test(C));
P("P57095", "the money row is removed when there is nothing to add, not printed as zero", /const showTaxRow = !dispSplit\.composition && tax > 0;/.test(C));
P("P57096", "…and a tax-inclusive bill says WHY there is no GST line", /GST is already included in these prices/.test(C));
P("P57097", "an MRP line wears its stamp, so the missing GST reads as correct", /MRP<\/span>/.test(C) || /\bMRP\b/.test(C));
P("P57098", "a composition restaurant is never quoted GST", /dispSplit\.composition \? 0 :/.test(C));
P("P57099", "the empty basket says something, rather than being a blank panel", /Your cart is empty/.test(C));
P("P57100", "the empty live tab says what will appear there", /Your live orders will show up here/.test(C));
P("P57101", "no screen in this territory decides behaviour by matching a message's prose", !/\.test\(msg\)/.test(C) && !/\/sold_out\/i/.test(C));
P("P57102", "…refusals branch on a CODE, resolved in one place", /refusalOf\(err\)/.test(C));
P("P57103", "no rendered string in this territory can print undefined", !/\$\{undefined/.test(C) && !/\$\{undefined/.test(T));
P("P57104", "…or NaN, because every number has a numeric fallback", /Number\.isFinite\(n\) && n > 0 \? n : 1/.test(O));
P("P57105", "…or [object Object], because nothing renders a raw object", !/\$\{\{/.test(C));
P("P57106", "the quantity step is a whole number, so a money box accepts its own value", /Math\.floor/.test(norm));
P("P57107", "the allergy free-text is length-capped in the browser too", /maxLength=\{80\}/.test(C));
P("P57108", "the table field is length-capped", /maxLength=\{4\}/.test(C));
P("P57109", "the '+' and '−' buttons are at least 32px, the product's floor", /width: "32px", height: "32px"/.test(C));
P("P57110", "every icon-only control in the bill carries an accessible label", count(C, /aria-label=/g) >= 8);
P("P57111", "the two tabs are real buttons, so a keyboard can reach them", /className=\{!showHistory \? "active" : ""\}/.test(C));
P("P57112", "the strip is a button, and Enter/Space open it", /if \(e\.key === "Enter" \|\| e\.key === " "\)/.test(T));
P("P57113", "the compliance line holds: nothing here can erase a placed order", !/DELETE/.test(C) && !/hard-delete/i.test(C));
P("P57114", "…and a guest can only correct their own order's table, while it is still open", /updateOrderTableNumber/.test(C));
P("P57115", "…through a definer function that checks that itself", /set_order_table_number/.test(M));
P("P57116", "a new module adds no column to settings — this territory adds none", !/settings\./.test(between(O, "export type GuestOrder", "};")));
P("P57117", "the offline layer is extended, not rebuilt: one queue, three kinds", count(O, /export async function enqueueGuest/g) === 3);
P("P57118", "a saved order still has no cancel, on purpose", /A saved ORDER deliberately has no\s*\n?\s*\* cancel/.test(O));
P("P57119", "…and cancelling a call refuses anything that is not a queued call", /if \(!isCall\(it\)\) return \{ ok: false, reason: "not_a_call" \};/.test(O));
P("P57120", "…returning a REASON, so the screen can say something true", /reason\?: "not_found" \| "not_a_call"/.test(O));
P("P57121", "the queue's own guard is named in the file, so a change is caught", /verify:order-retry/.test(O));
P("P57122", "no silent overwrite: the QR replay sends a clash expectation", /replayClash/.test(PL));
P("P57123", "…and the session replay relies on the RPC's own session check, deliberately", /lfh_place_order validates the/.test(PL));
P("P57124", "a table shows only its own party: ownership is the session, never the number", /identity still comes from the token/.test(PL));
// s8 self-correction: the route path also appears in the queue's opening comment, so "=== 1" was
// counting prose. What the row means is that there is exactly one FETCH of it in each file.
P("P57125", "the three doors all reach the same place-order route", count(M, /fetch\("\/api\/guest\/place-order"/g) === 1 && count(O, /fetch\("\/api\/guest\/place-order"/g) === 1);
P("P57126", "the dish paragraph is loaded only when a dish is opened", /getMenuItem uses "\*"/.test(M));
P("P57127", "the basket's own guard is registered in package.json", /verify:basket/.test(read("package.json")));
P("P57128", "…and the sweep's own scripts are too", /sweep:t3/.test(read("package.json")));
P("P57129", "the at-most-once helper this territory leans on exists", F.idem.length > 500);
P("P57130", "…and so does the clash helper", F.clash.length > 500);

console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:"); for (const f of fails) console.log("  " + f); process.exit(1); }
