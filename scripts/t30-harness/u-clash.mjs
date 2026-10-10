// lib/clash.ts — every branch, against the in-memory stand-in (no database, no network).
import { suite, req } from "./lib.mjs";
import { W, world } from "./sb.mjs";
const F = "lib/clash.ts";
const t = suite(F, 168301, 120);
const C = await import("@/lib/clash.ts");
const RID = "rid-A", OTHER = "rid-B";
const EX = (o) => ({ "x-lfh-expect": typeof o === "string" ? o : JSON.stringify(o) });
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// clashJson
{ const r = C.clashJson({ code: "x", plain: "p", todo: "t", retryable: false }); const j = await r.json();
  t("clashJson answers HTTP 409", r.status === 409, r.status);
  t("…with { error: code, clash: {…} }, the shape the outbox reads", j.error === "x" && j.clash.plain === "p" && j.clash.retryable === false); }
// replayMarkers
t("replayMarkers: no X-LFH-Replay → null (a live write)", C.replayMarkers(req({})) === null);
t("replayMarkers: X-LFH-Replay other than '1' → null", C.replayMarkers(req({ "x-lfh-replay": "true", "x-lfh-queued-at": ago(60000) })) === null);
t("replayMarkers: a replay with no queued-at → null", C.replayMarkers(req({ "x-lfh-replay": "1" })) === null);
t("replayMarkers: an unparseable queued-at → null", C.replayMarkers(req({ "x-lfh-replay": "1", "x-lfh-queued-at": "yesterday-ish" })) === null);
t("replayMarkers: queued 5 s ago → null (inside the 20 s live window)", C.replayMarkers(req({ "x-lfh-replay": "1", "x-lfh-queued-at": ago(5000) })) === null);
{ const at = ago(60000); const m = C.replayMarkers(req({ "x-lfh-replay": "1", "x-lfh-queued-at": at }));
  t("replayMarkers: queued a minute ago → { queuedAt } with that exact time", !!m && m.queuedAt.toISOString() === at); }
t("replayMarkers: a queued-at in the future → null (younger than 20 s by definition)", C.replayMarkers(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(Date.now() + 3600e3).toISOString() })) === null);

// expectClash — the shapes that answer "nothing to compare"
const ex = (h, rid = RID) => C.expectClash(req(h), rid);
world({ order_items: [{ id: "i1", restaurant_id: RID, note: "mild", qty: 2, removed: ["nuts"] }] });
t("expectClash: no header → null", (await ex({})) === null);
t("expectClash: malformed JSON → null (never a crash)", (await ex(EX("{oops"))) === null);
t("expectClash: an array → null", (await ex(EX("[1,2]"))) === null);
t("expectClash: the JSON literal null → null", (await ex(EX("null"))) === null);
t("expectClash: a table not on the allowlist → null, and NOTHING is read", (await ex(EX({ table: "staff_secrets", id: "i1", fields: { note: "x" } }))) === null && W.READS.length === 0);
t("expectClash: no fields → null", (await ex(EX({ table: "order_items", id: "i1" }))) === null);
t("expectClash: fields as a string → null", (await ex(EX({ table: "order_items", id: "i1", fields: "note" }))) === null);
t("expectClash: no id and no where → null", (await ex(EX({ table: "order_items", fields: { note: "x" } }))) === null);
t("expectClash: every field name invalid → null, nothing read", (await ex(EX({ table: "order_items", id: "i1", fields: { "NOTE": "x", "a b": 1, "x'--": 2 } }))) === null && W.READS.length === 0);
// same value → null; a change → clash
t("expectClash: the row still says what the screen saw → null (the write goes ahead)", (await ex(EX({ table: "order_items", id: "i1", fields: { note: "mild" } }))) === null);
t("…and that one comparison was ONE read, scoped to the restaurant", W.READS.length === 1 && W.READS[0].filters.some((f) => f[1] === "restaurant_id" && f[2] === RID));
{ W.READS.length = 0; const c = await ex(EX({ table: "order_items", id: "i1", fields: { note: "no onion" } }));
  t("expectClash: the note changed → a clash with code clash_changed_elsewhere", c && c.code === "clash_changed_elsewhere", JSON.stringify(c));
  t("…its sentence names the field in plain words and quotes what it says NOW", c && c.plain === "Someone else changed this dish's kitchen note while you had it open — it now says “mild”.", c && c.plain);
  t("…it says the change was NOT saved", c && /^Your change was NOT saved/.test(c.todo));
  t("…and it is not retryable — resending the same thing cannot help", c && c.retryable === false);
  t("…and the select asked only for the one column it compares", W.READS[0].cols === "note", W.READS[0].cols); }
t("expectClash: a row from ANOTHER restaurant is invisible → null (nothing to overwrite here)", (await ex(EX({ table: "order_items", id: "i1", fields: { note: "x" } }), OTHER)) === null);
t("expectClash: an id that does not exist → null", (await ex(EX({ table: "order_items", id: "nope", fields: { note: "x" } }))) === null);
{ W.FAIL["order_items:select"] = { message: "db down", code: "57014" }; t("expectClash: the lookup errors → null (fails OPEN — a broken check never stops a restaurant)", (await ex(EX({ table: "order_items", id: "i1", fields: { note: "x" } }))) === null); W.FAIL = {}; }
{ W.FAIL["order_items:select"] = "throw"; t("expectClash: the lookup throws → null (fails open)", (await ex(EX({ table: "order_items", id: "i1", fields: { note: "x" } }))) === null); W.FAIL = {}; }
// lists, quiet money, booleans, objects, labels
{ const c = await ex(EX({ table: "order_items", id: "i1", fields: { removed: ["dairy"] } }));
  t("expectClash: an allergen list that changed quotes it as 'no …'", c && /it now says “no nuts”\.$/.test(c.plain), c && c.plain); }
t("expectClash: the same allergens in another order and case → null", (await ex(EX({ table: "order_items", id: "i1", fields: { removed: ["NUTS"] } }))) === null);
world({ order_items: [{ id: "i2", restaurant_id: RID, removed: [] }] });
{ const c = await ex(EX({ table: "order_items", id: "i2", fields: { removed: ["nuts"] } }));
  t("expectClash: an allergen list that is now empty reads 'nothing to avoid'", c && /it now says nothing to avoid\.$/.test(c.plain), c && c.plain); }
world({ orders: [{ id: "o1", restaurant_id: RID, discount: 50, payment_status: "paid", total: 999 }] });
for (const col of ["discount", "payment_status", "total"]) {
  const c = await ex(EX({ table: "orders", id: "o1", fields: { [col]: "something else" } }));
  t(`expectClash: a money column (${col}) that moved says so WITHOUT quoting the figure`, c && /while you had it open\.$/.test(c.plain) && !/999|50|paid/.test(c.plain), c && c.plain);
}
world({ menu_items: [{ id: "m1", restaurant_id: RID, price: "120", sold_out: true, title: { en: "Dal" } }] });
{ const c = await ex(EX({ table: "menu_items", id: "m1", fields: { price: "100" } }));
  t("expectClash: a dish's price that moved is quiet too ('the price', no figure)", c && c.plain === "Someone else changed the price while you had it open.", c && c.plain); }
{ const c = await ex(EX({ table: "menu_items", id: "m1", fields: { title: { en: "Daal" } } }));
  t("expectClash: an OBJECT that moved takes the quiet form (no blob is quoted, no '[object Object]')", c && c.plain === "Someone else changed the name while you had it open.", c && c.plain); }
t("expectClash: an object re-serialised in another key order is the same → null", (await ex(EX({ table: "menu_items", id: "m1", fields: { title: { en: "Dal" } } }))) === null);
world({ staff_users: [{ id: "u1", restaurant_id: RID, active: false, profile: { notes: "late on Mondays" }, phone: "" }] });
{ const c = await ex(EX({ table: "staff_users", id: "u1", fields: { active: true } }));
  t("expectClash: a switch reads 'off', never 'false'", c && /it now says off\.$/.test(c.plain), c && c.plain); }
{ const c = await ex(EX({ table: "staff_users", id: "u1", fields: { "profile.notes": "on time" } }));
  t("expectClash: a jsonb sub-key ('profile.notes') is compared on its own and named 'this person's private note'", c && c.plain === "Someone else changed this person's private note while you had it open — it now says “late on Mondays”.", c && c.plain); }
t("expectClash: …and the sub-key that did NOT change → null (an unrelated key in the blob never clashes)", (await ex(EX({ table: "staff_users", id: "u1", fields: { "profile.notes": "late on Mondays" } }))) === null);
{ const c = await ex(EX({ table: "staff_users", id: "u1", fields: { "profile.id_number": "X1" } }));
  t("expectClash: a sub-key the blob does not have compares as absent ('it now says nothing')", c && /the ID number while you had it open — it now says nothing\.$/.test(c.plain), c && c.plain); }
{ const c = await ex(EX({ table: "staff_users", id: "u1", fields: { phone: "999" } }));
  t("expectClash: an empty current value reads 'nothing'", c && /it now says nothing\.$/.test(c.plain), c && c.plain); }
{ const c = await ex(EX({ table: "staff_users", id: "u1", fields: { phone: "999" }, label: "the phone number on file" }));
  t("expectClash: a caller's own label replaces the column name", c && /^Someone else changed the phone number on file while/.test(c.plain), c && c.plain); }
world({ settings: [{ restaurant_id: RID, tablet_discount: "pin", floor_mode: "on", table_count: 12 }] });
{ const c = await ex(EX({ table: "settings", id: RID, fields: { tablet_discount: "on" } }));
  t("expectClash: the waiter tri-state 'pin' reads 'on, but asking for a manager PIN'", c && /it now says on, but asking for a manager PIN\.$/.test(c.plain), c && c.plain); }
{ const c = await ex(EX({ table: "settings", id: RID, fields: { floor_mode: "off" } }));
  t("expectClash: an 'on'/'off' text value is said unquoted", c && /it now says on\.$/.test(c.plain), c && c.plain); }
{ const c = await ex(EX({ table: "settings", id: RID, fields: { table_count: 10 } }));
  t("expectClash: settings is compared for the CALLER's own restaurant, and readable() names table_count", c && /the number of tables while you had it open — it now says “12”\.$/.test(c.plain), c && c.plain); }
{ W.READS.length = 0; t("expectClash: settings named for ANOTHER restaurant → null, and nothing is read", (await ex(EX({ table: "settings", id: OTHER, fields: { table_count: 1 } }))) === null && W.READS.length === 0); }
{ W.READS.length = 0; await ex(EX({ table: "settings", id: RID, fields: { table_count: 12 } }));
  t("expectClash: a tenant-row table (settings) is looked up by restaurant_id = rid and NOT also by a restaurant_id scope twice", W.READS[0].filters.length === 1 && W.READS[0].filters[0][1] === "restaurant_id"); }
world({ restaurants: [{ id: RID, access_config: { a: 1 } }] });
t("expectClash: the restaurants row is its own tenant key (own id compares, foreign id is ignored)", (await ex(EX({ table: "restaurants", id: RID, fields: { access_config: { a: 2 } } }))) !== null && (await ex(EX({ table: "restaurants", id: OTHER, fields: { access_config: { a: 2 } } }))) === null);
world({ categories: [{ slug: "starters", restaurant_id: RID, name: { en: "Starters" } }, { slug: "starters", restaurant_id: OTHER, name: { en: "Other's" } }] });
{ const c = await ex(EX({ table: "categories", id: "starters", fields: { name: { en: "Mains" } } }));
  t("expectClash (item 9): a category is looked up by its SLUG in this restaurant and a change clashes", c && c.code === "clash_changed_elsewhere"); }
t("…and the same slug in ANOTHER restaurant is never compared against", (await ex(EX({ table: "categories", id: "starters", fields: { name: { en: "Starters" } } }))) === null);
// composite key (stock count)
world({ inv_count_lines: [{ id: "L1", restaurant_id: RID, count_id: "c1", item_id: "tom", counted_base: 4 }] });
t("expectClash: a composite (count_id, item_id) that matches and is unchanged → null", (await ex(EX({ table: "inv_count_lines", where: { count_id: "c1", item_id: "tom" }, fields: { counted_base: 4 } }))) === null);
{ const c = await ex(EX({ table: "inv_count_lines", where: { count_id: "c1", item_id: "tom" }, fields: { counted_base: 3 } }));
  t("expectClash: a composite whose count moved → clash naming 'the counted quantity'", c && /the counted quantity while you had it open — it now says “4”\.$/.test(c.plain), c && c.plain); }
t("expectClash: the first person to count an item (no row yet) → null", (await ex(EX({ table: "inv_count_lines", where: { count_id: "c1", item_id: "onion" }, fields: { counted_base: 1 } }))) === null);
t("expectClash: a half-specified composite (one column) → null, nothing read", (W.READS.length = 0, (await ex(EX({ table: "inv_count_lines", where: { count_id: "c1" }, fields: { counted_base: 1 } }))) === null && W.READS.length === 0));
t("expectClash: a composite naming a column not on the list → null", (await ex(EX({ table: "inv_count_lines", where: { count_id: "c1", restaurant_id: OTHER }, fields: { counted_base: 1 } }))) === null);
t("expectClash: a composite with an empty value → null", (await ex(EX({ table: "inv_count_lines", where: { count_id: "c1", item_id: "" }, fields: { counted_base: 1 } }))) === null);
t("expectClash: a composite given as an array → null", (await ex(EX({ table: "inv_count_lines", where: ["c1", "tom"], fields: { counted_base: 1 } }))) === null);
t("expectClash: a composite on a table with no composite key (orders) → null", (await ex(EX({ table: "orders", where: { count_id: "c1", item_id: "tom" }, fields: { total: 1 } }))) === null);
// the 8-field cap
world({ inv_items: [{ id: "x", restaurant_id: RID, a1: 1, a2: 1, a3: 1, a4: 1, a5: 1, a6: 1, a7: 1, a8: 1, a9: 1 }] });
t("expectClash: only the first 8 fields are compared (a 9th that moved is not seen — the cap is real)", (await ex(EX({ table: "inv_items", id: "x", fields: { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1, a6: 1, a7: 1, a8: 1, a9: 2 } }))) === null);
{ const c = await ex(EX({ table: "inv_items", id: "x", fields: { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1, a6: 1, a7: 1, a8: 2 } }));
  t("…while an 8th that moved IS seen, and an unknown column is named in plain words ('the a8')", c && /^Someone else changed the a8 while/.test(c.plain), c && c.plain); }
{ W.READS.length = 0; world({ order_items: [{ id: "i1", restaurant_id: RID, note: "a", qty: 1 }] }); await ex(EX({ table: "order_items", id: "i1", fields: { note: "a", "note.x": "y", qty: 1 } }));
  t("expectClash: a column named twice (as itself and as a sub-key) is selected once", W.READS[0].cols === "note, qty", W.READS[0].cols); }

// replayClash
const rp = (h, a, b, c, body) => C.replayClash(req(h), RID, a, b, c, body);
const R = (ms) => ({ "x-lfh-replay": "1", "x-lfh-queued-at": ago(ms) });
world({ sessions: [], settings: [{ restaurant_id: RID, table_names: { "5": "Patio" } }] });
t("replayClash: a live write → null without a single read", (W.READS.length = 0, (await rp({}, "tables", "5", "x", {})) === null && W.READS.length === 0));
t("replayClash: an aged replay for an action with no table (a parcel) → null", (await rp(R(60000), "parcel", undefined, undefined, {})) === null);
t("replayClash: an aged replay whose table cannot be resolved → null (\"couldn't tell\" is never a refusal)", (await rp(R(60000), "orders", "ghost", "pay", {})) === null);
t("replayClash: nothing sitting at that table now → null", (await rp(R(60000), "tables", "5", "pay", {})) === null);
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(5000), closed_at: null }], settings: [{ restaurant_id: RID, table_names: { "5": "Patio" } }] });
{ const c = await rp(R(60000), "tables", "5", "pay", {});
  t("replayClash: a NEW party sat down after the change was made → clash_new_party", c && c.code === "clash_new_party", JSON.stringify(c));
  t("…and it speaks of the table by the name the restaurant gave it ('Patio')", c && /^Patio has a different party now/.test(c.plain) && /for Patio as it is now\.$/.test(c.todo), c && c.plain); }
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", status: "open", created_at: ago(3600e3), closed_at: null }], settings: [{ restaurant_id: RID, table_names: {} }] });
t("replayClash: the same party is still there and open → null (the replay goes ahead)", (await rp(R(60000), "tables", "6", "pay", {})) === null);
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", status: "closed", created_at: ago(3600e3), closed_at: null }], settings: [] });
{ const c = await rp(R(60000), "tables", "6", "pay", {});
  t("replayClash: CLOSED with no closed_at (a bare script close) → refused, because nobody can prove who was first", c && c.code === "clash_table_closed" && /has been closed and billed since you did this/.test(c.plain), c && c.plain);
  t("…and with no name configured it says 'Table 6'", c && /^Table 6 /.test(c.plain)); }
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", status: "closed", created_at: ago(3600e3), closed_at: ago(30000) }], settings: [] });
{ const c = await rp(R(60000), "order", undefined, undefined, { table: "6" });
  t("replayClash: closed AFTER the person acted → refused, and an ORDER is told it never reached the kitchen", c && c.code === "clash_table_closed" && /after you did this — the order never reached the kitchen\.$/.test(c.plain), c && c.plain); }
{ const c = await rp(R(60000), "tables", "6", "pay", {});
  t("…any other action closed after → the same refusal without the kitchen clause", c && /was closed and billed after you did this\.$/.test(c.plain), c && c.plain); }
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", status: "closed", created_at: ago(7200e3), closed_at: ago(3600e3) }], settings: [] });
t("replayClash: closed BEFORE the person acted → null (the handler decides)", (await rp(R(60000), "tables", "6", "pay", {})) === null);
world({ sessions: [{ id: "s1", restaurant_id: OTHER, table_number: "6", status: "open", created_at: ago(1000) }], settings: [] });
t("replayClash: another restaurant's party on 'table 6' is never seen (the lookup is scoped)", (await rp(R(60000), "tables", "6", "pay", {})) === null);
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", status: "open", created_at: ago(1000) }] }); W.FAIL["sessions:select"] = { message: "down" };
t("replayClash: the session read errors → null (fails open)", (await rp(R(60000), "tables", "6", "pay", {})) === null); W.FAIL = {};
W.FAIL["sessions:select"] = "throw"; t("replayClash: the session read throws → null (fails open)", (await rp(R(60000), "tables", "6", "pay", {})) === null); W.FAIL = {};
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(5000) }], settings: [{ restaurant_id: RID, table_names: { "5": "Patio" } }] }); W.FAIL["settings:select"] = "throw";
{ const c = await rp(R(60000), "tables", "5", "pay", {});
  t("replayClash: the table-name read fails → it falls back to 'Table 5', still refuses", c && /^Table 5 has a different party now/.test(c.plain), c && c.plain); }
W.FAIL = {};
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(5000) }], settings: [{ restaurant_id: RID, table_names: { "5": "   " } }] });
{ const c = await rp(R(60000), "tables", "5", "pay", {}); t("replayClash: a blank table name reads as 'Table 5'", c && /^Table 5 /.test(c.plain)); }
world({ sessions: [{ id: "s-a", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(9e6) }, { id: "s-b", restaurant_id: RID, table_number: "6", status: "open", created_at: ago(5000) }], settings: [] });
{ const c = await rp(R(60000), "sessions", "s-a", "shift", { to: "6" });
  t("replayClash: moving the party at 5 to 6 checks BOTH tables — the new party on 6 refuses it", c && c.code === "clash_new_party" && /^Table 6 /.test(c.plain), c && c.plain); }
world({ sessions: [{ id: "s-old", restaurant_id: RID, table_number: "5", status: "closed", created_at: ago(9e6), closed_at: ago(8e6) }, { id: "s-now", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(4e6) }], settings: [] });
t("replayClash: it reads the NEWEST session on the table (an older closed one does not refuse)", (await rp(R(60000), "tables", "5", "pay", {})) === null);
// the branches the first pass left unrun (measured by coverage.mjs)
t("expectClash: an expectation with no table named → null", (await ex(EX({ id: "i1", fields: { note: "x" } }))) === null);
world({ inv_count_lines: [{ id: "L1", restaurant_id: RID, count_id: "c1", item_id: "tom", counted_base: 4 }] });
t("expectClash: a composite whose value is null is treated as empty → null", (await ex(EX({ table: "inv_count_lines", where: { count_id: null, item_id: "tom" }, fields: { counted_base: 1 } }))) === null);
world({ staff_users: [{ id: "u1", restaurant_id: RID, active: true }] });
{ const c = await ex(EX({ table: "staff_users", id: "u1", fields: { active: false } })); t("expectClash: a switch that is now ON reads 'on'", c && /it now says on\.$/.test(c.plain), c && c.plain); }
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(5000) }], settings: [{ restaurant_id: RID, table_names: null }] });
{ const c = await rp(R(60000), "tables", "5", "pay", {}); t("replayClash: settings.table_names missing altogether → 'Table 5'", c && /^Table 5 /.test(c.plain)); }
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "", status: "open", created_at: ago(5000) }] });
t("replayClash: an order with no table number in it (a blank table) is skipped, not refused", (await rp(R(60000), "order", undefined, undefined, {})) === null);
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "7", created_at: ago(9e6), closed_at: ago(30000) }], settings: [] });
{ const c = await rp(R(60000), "tables", "7", "pay", {}); t("replayClash: a session with NO status but a closed_at after the change → still refused as closed", c && c.code === "clash_table_closed"); }
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(5000) }], settings: [{ restaurant_id: RID, table_names: "Patio" }] });
{ const c = await rp(R(60000), "tables", "5", "pay", {}); t("replayClash: a table_names that is not an object (a stray string) → 'Table 5'", c && /^Table 5 /.test(c.plain)); }
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(5000) }], settings: [{ restaurant_id: RID, table_names: { "9": "Bar" } }] });
{ const c = await rp(R(60000), "tables", "5", "pay", {}); t("replayClash: names exist for other tables but not this one → 'Table 5'", c && /^Table 5 /.test(c.plain)); }
// round-2 mutation survivors, closed
world({ staff_users: [{ id: "u1", restaurant_id: RID, profile: null }] });
{ const c = await ex(EX({ table: "staff_users", id: "u1", fields: { "profile.notes": "x" } })); t("expectClash: a jsonb column that is NULL compares its sub-key as absent → clash 'it now says nothing'", c && /it now says nothing\.$/.test(c.plain), c && c.plain); }
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "6", status: "open", created_at: ago(5000) }], settings: [] });
// RE-STATED 2026-10-10 (round 4): T13's item 4 (lib/tableOfAction.ts "THREE ANSWERS, NOT TWO") made a row
// that does not exist GONE — nothing of its own to protect — instead of "couldn't tell". So a replayed move
// whose party has vanished is judged by its destination; only a FAILED read is still "couldn't tell".
{ const c = await rp(R(60000), "sessions", "ghost", "shift", { to: "6" });
  t("replayClash: when the moved party is GONE, the destination still decides — a new party sat there since → refused, in plain words", !!c && c.code === "clash_new_party" && /^Table 6 has a different party now/.test(c.plain), c && c.plain); }
world({ sessions: [{ id: "s-old", restaurant_id: RID, table_number: "5", status: "closed", created_at: ago(9e6), closed_at: ago(8e6) }, { id: "s-new", restaurant_id: RID, table_number: "5", status: "open", created_at: ago(5000) }], settings: [] });
{ const c = await rp(R(60000), "tables", "5", "pay", {}); t("replayClash: with an old closed party AND a new one, it judges against the NEWEST (the new party refuses)", c && c.code === "clash_new_party");
  t("…every replay refusal is not retryable (new party)", c && c.retryable === false); }
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", status: "closed", created_at: ago(3600e3), closed_at: null }], settings: [] });
{ const c = await rp(R(60000), "tables", "6", "pay", {}); t("…every replay refusal is not retryable (closed, no timestamp)", c && c.retryable === false); }
world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", status: "closed", created_at: ago(3600e3), closed_at: ago(30000) }], settings: [] });
{ const c = await rp(R(60000), "tables", "6", "pay", {}); t("…every replay refusal is not retryable (closed after)", c && c.retryable === false); }
world({ order_items: [{ id: "i1", restaurant_id: RID, note: "mild" }] });
t("expectClash: fields given as null → null, never a crash (the write goes ahead)", await (async () => { try { return (await ex(EX({ table: "order_items", id: "i1", fields: null }))) === null; } catch { return false; } })());
world({ inv_count_lines: [{ id: "L1", restaurant_id: RID, count_id: "c1", item_id: "tom", counted_base: 4 }] });
t("expectClash: a composite 'where' given as null → null, never a crash", await (async () => { try { return (await ex(EX({ table: "inv_count_lines", where: null, fields: { counted_base: 1 } }))) === null; } catch { return false; } })());
// the exact time boundaries, with the clock held still (round-2 mutation survivors, closed)
{ const now = Date.parse("2026-10-09T12:00:00.000Z"); const realNow = Date.now; Date.now = () => now;
  try {
    t("replayMarkers: a change queued EXACTLY 20 s ago is judged as a replay (the live window is 'under 20 s')", !!C.replayMarkers(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(now - 20000).toISOString() })));
    t("…19.999 s ago is still a live write", C.replayMarkers(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(now - 19999).toISOString() })) === null);
    const q = now - 60000;
    world({ sessions: [{ id: "s", restaurant_id: RID, table_number: "5", status: "open", created_at: new Date(q + 1000).toISOString() }], settings: [] });
    t("replayClash: a party seated EXACTLY 1 s after the change is the same party (a second of clock skew is allowed)", (await C.replayClash(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(q).toISOString() }), RID, "tables", "5", "pay", {})) === null);
    world({ sessions: [{ id: "s", restaurant_id: RID, table_number: "5", status: "open", created_at: new Date(q + 1001).toISOString() }], settings: [] });
    t("…1.001 s after is a new party → refused", (await C.replayClash(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(q).toISOString() }), RID, "tables", "5", "pay", {}))?.code === "clash_new_party");
    world({ sessions: [{ id: "s", restaurant_id: RID, table_number: "5", status: "closed", created_at: new Date(q - 9e6).toISOString(), closed_at: new Date(q).toISOString() }], settings: [] });
    t("replayClash: a table closed at the SAME millisecond as the change → allowed (closed is not 'after')", (await C.replayClash(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(q).toISOString() }), RID, "tables", "5", "pay", {})) === null);
  } finally { Date.now = realNow; } }
// (appended, round 4) …and when the READ of the moved party fails, it is still "couldn't tell" → null
world({ sessions: [{ id: "s-new", restaurant_id: RID, table_number: "6", status: "open", created_at: ago(5000) }], settings: [] }); W.FAIL_NTH["sessions:select"] = { at: 1, mode: { code: "57014", message: "timeout" } };
t("replayClash: when the read of the moved party FAILS, the check is 'couldn't tell' → null (a blip is never read as gone)", (await rp(R(60000), "sessions", "ghost", "shift", { to: "6" })) === null);
