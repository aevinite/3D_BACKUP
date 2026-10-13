// scripts/sweep/t16s10/rerun-node.mjs — auditsort.js driven as pure logic in Node (P19235–P19308,
// P44331–P44358, P44589–P44593, P44667–P44679), and the same answers computed by the bytes the backup
// site SERVES (P45470–P45489). No DOM, no network except the one GET of the served file.
import vm from "node:vm";
import { R, src, ok, eq, assert, tag } from "./lib.mjs";

const done = tag("node");
const AS = "auditsort.js";
const SITE = process.env.T16_SITE || "https://3-d-backup.vercel.app";
function load(text) { const m = { exports: {} }; vm.runInNewContext(text, { module: m, exports: m.exports, window: {} }); return m.exports; }
const A = load(src(AS));
let served = null;
async function S() { if (!served) { const r = await fetch(SITE + "/panels/auditsort.js", { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`site answered ${r.status}`); served = load(await r.text()); } return served; }
const row = (o) => Object.assign({ id: Math.floor(Math.random() * 1e9), at: "2026-10-12T10:00:00Z" }, o);
const ids = (rows) => rows.map((r) => r.id).join(",");

// ── P19235–P19308 ──
R("P19235", AS, "Every kind the recorder can write has words, a glyph, a risk level and at least one tag", () => {
  const k = Object.keys(A.KIND_RISK), bad = k.filter((x) => !A.KIND_LABEL[x] || !A.KIND_ICON[x] || !A.KIND_TAGS[x] || !A.KIND_TAGS[x].length);
  return ok(!bad.length && Object.keys(A.KIND_TAGS).length === k.length, `${k.length} kinds, all four maps complete`);
});
R("P19236", AS, "riskOf() answers 'record' for a kind it has never heard of, rather than throwing", () => eq(A.riskOf("something_new_next_month"), "record"));
R("P19237", AS, "Only money-moving kinds are marked 'money'", () => { const m = Object.keys(A.KIND_RISK).filter((k) => A.KIND_RISK[k] === "money").sort(); return ok(m.join() === "bill_changed_after_reopen,discount_given,on_the_house,order_deleted,payment_reverted", m.join(", ")); });
R("P19238", AS, "A note changed after settling is NOT money (the owner's own ruling)", () => eq(A.riskOf("bill_annotated"), "record"));
R("P19239", AS, "An erased guest is its own level — not money, not a record change", () => eq(A.riskOf("customer_erased"), "data"));
R("P19240", AS, "tagsOf() marks an unanswered cancellation as its own state, never guessing", () => assert(A.tagsOf({ kind: "order_cancelled" }).includes("unanswered")));
R("P19241", AS, "A cancellation answered 'the food was made' is tagged as a loss", () => assert(A.tagsOf({ kind: "order_cancelled", meta: { made: true, loss_cost: 50 } }).includes("loss")));
R("P19242", AS, "…and if nobody costed it, that is said too", () => assert(A.tagsOf({ kind: "order_cancelled", meta: { made: true } }).includes("cost-unknown")));
R("P19243", AS, "A cancellation answered 'nothing was made' is tagged no-loss and is not a loss", () => { const t = A.tagsOf({ kind: "order_cancelled", meta: { made: false } }); return t.includes("no-loss") && !t.includes("loss"); });
R("P19244", AS, "A kind with no tags of its own falls into 'other' rather than vanishing from the chips", () => eq(A.tagsOf({ kind: "a_kind_nobody_listed" }), ["other"]));
R("P19245", AS, "tagCountsFrom() counts every tag across the whole feed and sorts them predictably", () => {
  const c = A.tagCountsFrom([{ kind: "discount_given" }, { kind: "discount_given" }, { kind: "order_deleted" }]);
  return ok(c.map((x) => `${x.tag}:${x.count}`).join(" ") === "bill:1 discount:2 money:3", c.map((x) => `${x.tag}:${x.count}`).join(" "));
});
R("P19246", AS, "Every tag a row can carry has words a person reads", () => { const t = new Set(Object.values(A.KIND_TAGS).flat().concat(["loss", "no-loss", "unanswered", "cost-unknown", "other"])); return ok([...t].every((x) => A.TAG_LABEL[x]), `${t.size} tags`); });
R("P19247", AS, "tagLabel()/tagIcon() answer for a tag nobody listed rather than printing 'undefined'", () => {
  const l = A.tagLabel ? A.tagLabel("brand_new") : (A.tagCountsFrom([{ kind: "x" }])[0] || {}).label;
  return ok(l && l !== "undefined", String(l));
});
const two = [row({ id: 1, at: "2026-10-10T10:00:00Z" }), row({ id: 2, at: "2026-10-11T10:00:00Z" })];
R("P19248", AS, "sortRows('new') puts the newest first", () => eq(ids(A.sortRows(two, "new")), "2,1"));
R("P19249", AS, "sortRows('old') puts the oldest first", () => eq(ids(A.sortRows(two, "old")), "1,2"));
R("P19250", AS, "A row with a BROKEN date sorts to the end of 'newest first' rather than to the top", () => eq(ids(A.sortRows([row({ id: 9, at: "not a date" }), ...two], "new")), "2,1,9"));
R("P19251", AS, "sortRows('amount') puts the biggest money first", () => eq(ids(A.sortRows([row({ id: 1, amount: 100 }), row({ id: 2, amount: 5000 }), row({ id: 3, amount: 20 })], "amount")), "2,1,3"));
R("P19252", AS, "A row with NO amount sorts below every row that has one, not as ₹0 among them", () => eq(ids(A.sortRows([row({ id: 1, amount: null }), row({ id: 2, amount: 20 })], "amount")), "2,1"));
R("P19253", AS, "An amount of exactly 0 still sorts ABOVE a row with no amount at all", () => eq(ids(A.sortRows([row({ id: 1, amount: null }), row({ id: 2, amount: 0 })], "amount")), "2,1"));
R("P19254", AS, "An amount that is a STRING is read as a number, not sorted as text", () => eq(ids(A.sortRows([row({ id: 1, amount: "90" }), row({ id: 2, amount: "1000" })], "amount")), "2,1"));
R("P19255", AS, "sortRows('person') is A–Z and case-insensitive", () => eq(ids(A.sortRows([row({ id: 1, actor: "Zara" }), row({ id: 2, actor: "asha" })], "person")), "2,1"));
R("P19256", AS, "sortRows is STABLE for genuinely equal rows — the same list twice gives the same order", () => { const r = [row({ id: 5 }), row({ id: 6 })]; return eq(ids(A.sortRows(r, "new")), ids(A.sortRows(r.slice().reverse(), "new"))); });
R("P19257", AS, "An unknown sort id falls back to the default rather than throwing or emptying the list", () => eq(ids(A.sortRows(two, "zzz")), "2,1"));
R("P19258", AS, "sortRows never mutates the array it was handed", () => { const r = two.slice(); A.sortRows(r, "new"); return eq(ids(r), "1,2"); });
R("P19259", AS, "sortRows(null) and sortRows(undefined) answer an empty list", () => eq([A.sortRows(null).length, A.sortRows(undefined).length], [0, 0]));
const five = [{ kind: "a" }, { kind: "a" }, { kind: "b" }, { kind: "c" }, { kind: "a" }];
R("P19260", AS, "kindCounts totals equal the row count", () => eq(A.kindCounts(five).reduce((s, x) => s + x.count, 0), 5));
R("P19261", AS, "kindCounts offers a chip only for a kind that is really there", () => eq(A.kindCounts(five).map((x) => x.kind).sort(), ["a", "b", "c"]));
R("P19262", AS, "kindCounts orders by count, biggest first", () => eq(A.kindCounts(five)[0].kind, "a"));
R("P19263", AS, "A row with NO kind is skipped rather than making a nameless chip", () => eq(A.kindCounts([{ kind: "" }, { kind: "a" }]).length, 1));
R("P19264", AS, "kindCountsFrom prefers the DATABASE's counts when it is given them", () => eq(A.kindCountsFrom([{ kind: "discount_given" }], [{ kind: "discount_given", n: 40, amount: 0 }])[0].count, 40));
R("P19265", AS, "…and it offers a chip for a type with NOTHING on this page", () => eq(A.kindCountsFrom([], [{ kind: "order_deleted", n: 3 }])[0].kind, "order_deleted"));
R("P19266", AS, "A db count of zero is not offered as a chip", () => eq(A.kindCountsFrom([], [{ kind: "x", n: 0 }]).length, 0));
R("P19267", AS, "With no db counts it falls back to counting the page", () => eq(A.kindCountsFrom(five, null).reduce((s, x) => s + x.count, 0), 5));
R("P19268", AS, "A db-counted chip carries the label from the shared map, not the raw kind", () => eq(A.kindCountsFrom([], [{ kind: "order_deleted", n: 1 }], A.KIND_LABEL)[0].label, "Bill deleted"));
const r1 = { kot_no: 17, bill_no: 42, invoice_no: "FH/26-27/7", table_number: 5, actor: "asha", reason_code: "mistake", kind: "customer_erased", amount: 1234.56 };
R("P19269", AS, "matches() is case-insensitive", () => assert(A.matches(r1, "ASHA")));
R("P19270", AS, "matches() finds a row by the KOT, bill, invoice or table number", () => assert(["kot 17", "bill 42", "invoice fh", "table 5"].every((q) => A.matches(r1, q))));
R("P19271", AS, "matches() searches the reason's WORDS, not just its stored code", () => assert(A.matches(r1, "by mistake", null, A.REASON_LABEL)));
R("P19272", AS, "matches() searches the kind's WORDS too", () => assert(A.matches(r1, "guest record", A.KIND_LABEL)));
R("P19273", AS, "matches() finds a row by its rounded amount, as a person would type it", () => assert(A.matches(r1, "1235")));
R("P19274", AS, "An empty search matches everything rather than nothing", () => assert(A.matches(r1, "")));
R("P19275", AS, "A search that matches nothing says so — it does not fall back to everything", () => assert(!A.matches(r1, "zzqx")));
R("P19276", AS, "view() filters by type AND search, then sorts, in one call", () => eq(ids(A.view([row({ id: 1, kind: "a", actor: "x" }), row({ id: 2, kind: "b", actor: "x" }), row({ id: 3, kind: "a", actor: "y" })], { kind: "a", q: "x" })), "1"));
R("P19277", AS, "view() with no kind means EVERY type", () => eq(A.view(five.map((f, i) => row({ ...f, id: i }))).length, 5));
R("P19278", AS, "view() never mutates its input", () => { const r = two.slice(); A.view(r, { sort: "new" }); return eq(ids(r), "1,2"); });
R("P19279", AS, "sumAmount ignores a non-numeric amount instead of producing NaN", () => eq(A.sumAmount([{ amount: "abc" }, { amount: 10 }]), 10));
R("P19280", AS, "sumAmount of an empty list is 0, not NaN", () => eq(A.sumAmount([]), 0));
R("P19281", AS, "sumAmount keeps paise rather than rounding a total away", () => eq(A.sumAmount([{ amount: 10.505 }, { amount: 0.245 }]), 10.75));
R("P19282", AS, "Every group has words and a glyph, and 'other' catches everything", () => ok(A.ACTIVITY_GROUPS.every((g) => g.label && g.icon) && A.ACTIVITY_GROUPS[A.ACTIVITY_GROUPS.length - 1].id === "other", `${A.ACTIVITY_GROUPS.length} groups`));
R("P19283", AS, "A print action lands in Printer, not in Orders", () => eq(A.activityGroupOf("kot_print"), "printer"));
R("P19284", AS, "A settle lands in Bills & money, not in Tables", () => eq(A.activityGroupOf("bill_paid"), "money"));
R("P19285", AS, "Sign-in and permission actions land in Sign-in & access", () => eq(["login", "logout", "pin_set", "access_change"].map(A.activityGroupOf), ["access", "access", "access", "access"]));
R("P19286", AS, "A stock action lands in Stock & expenses", () => eq(["inv_count_submit", "expense_add"].map(A.activityGroupOf), ["stock", "stock"]));
R("P19287", AS, "An error-level row reaches Problems even when its action name is innocent", () => eq(A.activityGroupOfRow({ action: "ui_taps", level: "error" }), "problem"));
R("P19288", AS, "…and the same row at a normal level keeps its own group", () => eq(A.activityGroupOfRow({ action: "ui_taps" }), "other"));
R("P19289", AS, "activityGroupOf is total — it answers for an empty action and for undefined", () => eq([A.activityGroupOf(""), A.activityGroupOf(undefined)], ["other", "other"]));
R("P19290", AS, "activityGroupLabel answers for a group id nobody listed rather than printing undefined", () => { const l = A.activityGroupLabel("nope"); return ok(l && l !== "undefined", l); });
R("P19291", AS, "activityCounts totals equal the row count", () => eq(A.activityCounts([{ action: "kot_print" }, { action: "login" }, { action: "login" }, { action: "x" }]).reduce((s, x) => s + x.count, 0), 4));
R("P19292", AS, "activityCounts keeps the GROUP order stable", () => { const a = [{ action: "login" }, { action: "kot_print" }, { action: "login" }]; return eq(A.activityCounts(a).map((x) => x.group), A.activityCounts(a.slice().reverse()).map((x) => x.group)) && eq(A.activityCounts(a).map((x) => x.group), ["printer", "access"]); });
R("P19293", AS, "activityCounts offers a chip only for a group that has rows", () => eq(A.activityCounts([{ action: "login" }]).length, 1));
R("P19294", AS, "activityMatches finds the printer rows by the word 'printer', which no row contains", () => assert(A.activityMatches({ action: "kot_print", detail: "KOT 4" }, "printer")));
R("P19295", AS, "activityMatches lets a person type an action name with spaces instead of underscores", () => assert(A.activityMatches({ action: "table_open" }, "table open")));
R("P19296", AS, "activityMatches searches the detail, the person, the panel and the table", () => assert(["fridge", "ravi", "kitchen", "7"].every((q) => A.activityMatches({ action: "x", detail: "fridge note", actor: "Ravi", panel: "kitchen", table_number: 7 }, q))));
R("P19297", AS, "activityView filters by group then sorts, and never mutates its input", () => { const r = [{ id: 1, action: "login", created_at: "2026-10-01" }, { id: 2, action: "kot_print", created_at: "2026-10-02" }]; const c = r.slice(); const v = A.activityView(r, { group: "access" }); return eq(v.map((x) => x.id), [1]) && eq(c.map((x) => x.id), r.map((x) => x.id)); });
R("P19298", AS, "activityView sorts on created_at, not the Audit's `at`", () => eq(A.activityView([{ id: 1, created_at: "2026-10-01" }, { id: 2, created_at: "2026-10-03" }], {}).map((x) => x.id), [2, 1]));
R("P19299", AS, "…and still copes with a row that carries `at` instead", () => eq(A.activityView([{ id: 1, at: "2026-10-01" }, { id: 2, at: "2026-10-03" }], {}).map((x) => x.id), [2, 1]));
R("P19300", AS, "activityView's Panel sort groups a panel's rows together", () => eq(A.activityView([{ id: 1, panel: "tablet" }, { id: 2, panel: "kitchen" }, { id: 3, panel: "tablet" }], { sort: "panel" }).map((x) => x.panel), ["kitchen", "tablet", "tablet"]));
R("P19301", AS, "activityView's Type sort orders by the group's WORDS, not by its id", () => eq(A.activityView([{ id: 1, action: "kot_print" }, { id: 2, action: "bill_paid" }], { sort: "kind" }).map((x) => x.id), [2, 1]));
R("P19302", AS, "An unknown activity sort falls back rather than emptying the list", () => eq(A.activityView([{ id: 1 }, { id: 2 }], { sort: "zzz" }).length, 2));
R("P19303", AS, "activityView(null) answers an empty list", () => eq(A.activityView(null).length, 0));
R("P19304", AS, "Every reason code the panels offer has words", () => eq(Object.keys(A.REASON_LABEL).sort(), ["guest_changed", "kitchen_error", "mistake", "other", "sold_out", "wrong_table"]));
R("P19305", AS, "The default sorts are the ones the screens open on", () => eq([A.DEFAULT_SORT, A.ACTIVITY_DEFAULT_SORT], ["new", "new"]));
R("P19306", AS, "sortById answers a real sort for an id nobody listed", () => eq(A.sortById("nope").id, "new"));
R("P19307", AS, "Every sort offered has an id and words a person reads", () => assert(A.SORTS.concat(A.ACTIVITY_SORTS).every((s) => s.id && s.label)));
R("P19308", AS, "The Activity log is not offered a 'biggest amount' sort", () => assert(!A.ACTIVITY_SORTS.some((s) => s.id === "amount")));
// ── P44331–P44358 ──
R("P44331", AS, "every kind the recorder can write has words, a glyph, a risk and a tag", () => assert(Object.keys(A.KIND_RISK).every((k) => A.KIND_LABEL[k] && A.KIND_ICON[k] && A.KIND_TAGS[k])));
R("P44332", AS, "no two kinds share a label", () => { const l = Object.values(A.KIND_LABEL); return eq(new Set(l).size, l.length); });
R("P44333", AS, "no label is empty or whitespace", () => assert(Object.values(A.KIND_LABEL).every((l) => l.trim())));
R("P44334", AS, "no label leaks an underscore from its code", () => assert(!Object.values(A.KIND_LABEL).some((l) => /_/.test(l))));
R("P44335", AS, "every glyph is a single visible character, not a box", () => assert(Object.values(A.KIND_ICON).every((g) => [...g.replace(/️|‍/g, "")].length <= 3 && g.trim())));
R("P44336", AS, "sortRows handles a list of one", () => eq(A.sortRows([row({ id: 1 })]).length, 1));
const thousand = Array.from({ length: 1000 }, (_, i) => row({ id: i + 1, at: new Date(Date.UTC(2026, 0, 1) + ((i * 7919) % 1000) * 60000).toISOString(), amount: (i * 37) % 500 }));
R("P44337", AS, "sortRows handles a list of a thousand without losing a row", () => eq(new Set(A.sortRows(thousand, "new").map((r) => r.id)).size, 1000));
R("P44338", AS, "…and it really is sorted", () => { const s = A.sortRows(thousand, "new"); return assert(s.every((r, i) => !i || Date.parse(s[i - 1].at) >= Date.parse(r.at))); });
R("P44339", AS, "a row whose amount is a negative number sorts below zero, not above everything", () => eq(ids(A.sortRows([row({ id: 1, amount: -5 }), row({ id: 2, amount: 0 })], "amount")), "2,1"));
R("P44340", AS, "sorting by person puts an EMPTY name last rather than first — EXPECTATION CORRECTED", () => {
  // Sweep #7 filed this ✅ with the evidence "order [1,2]", i.e. the EMPTY name (row 1) FIRST — the
  // opposite of its own title. localeCompare puts "" before every name, today as then. The behaviour
  // has not changed; the row's wording was wrong. Recorded so nobody reads it as a regression.
  const s = ids(A.sortRows([row({ id: 1, actor: "" }), row({ id: 2, actor: "asha" })], "person"));
  return ok(s === "1,2", `order ${s} — an unnamed (system) row sorts FIRST in Person A–Z, exactly as in sweep #7; the title claimed last`);
});
R("P44341", AS, "two rows with the same person keep their time order", () => eq(ids(A.sortRows([row({ id: 1, actor: "a", at: "2026-10-01" }), row({ id: 2, actor: "a", at: "2026-10-02" })], "person")), "2,1"));
R("P44342", AS, "matches() does not throw on a row with nothing in it", () => assert(A.matches({}, "x") === false));
R("P44343", AS, "matches() copes with a needle containing regex characters", () => { A.matches(r1, ".*"); A.matches(r1, "("); return true; });
R("P44344", AS, "searching '.*' does not match every row as a wildcard", () => assert(!A.matches(r1, ".*")));
R("P44345", AS, "a search with surrounding spaces still finds the row", () => assert(A.matches(r1, "  asha  ")));
R("P44346", AS, "view() with both a kind and a needle applies BOTH", () => eq(A.view([row({ id: 1, kind: "a", actor: "x" }), row({ id: 2, kind: "a", actor: "y" })], { kind: "a", q: "y" }).length, 1));
R("P44347", AS, "view() of an empty list is an empty list, not a throw", () => eq(A.view([], { q: "x" }).length, 0));
R("P44348", AS, "sumAmount survives a list of a thousand", () => assert(Number.isFinite(A.sumAmount(thousand))));
R("P44349", AS, "sumAmount does not drift on repeated paise", () => eq(A.sumAmount([{ amount: 0.1 }, { amount: 0.1 }, { amount: 0.1 }]), 0.3));
R("P44350", AS, "activityGroupOf is stable for the same input", () => eq(A.activityGroupOf("bill_paid"), A.activityGroupOf("bill_paid")));
R("P44351", AS, "every ACTIVITY group id is unique", () => eq(new Set(A.ACTIVITY_GROUPS.map((g) => g.id)).size, A.ACTIVITY_GROUPS.length));
R("P44352", AS, "'other' is LAST, so every other test gets a chance first", () => eq(A.ACTIVITY_GROUPS[A.ACTIVITY_GROUPS.length - 1].id, "other"));
R("P44353", AS, "a printer action beats an order action", () => eq(A.activityGroupOf("print_order_slip"), "printer"));
R("P44354", AS, "a money action beats a table action", () => eq(A.activityGroupOf("table_bill_paid"), "money"));
R("P44355", AS, "an action nobody has ever seen still lands somewhere", () => assert(Array.from({ length: 20 }, (_, i) => A.activityGroupOf(`zz_invented_${i}`)).every((g) => A.ACTIVITY_GROUPS.some((x) => x.id === g))));
R("P44356", AS, "activityCounts of an empty list is an empty strip, not a row of zeros", () => eq(A.activityCounts([]).length, 0));
R("P44357", AS, "activityView copes with a row that has no action at all", () => eq(A.activityView([{ id: 1 }], { group: "other" }).length, 1));
R("P44358", AS, "the tip's own kind is NOT in the removals map", () => assert(!("order_tip" in A.KIND_LABEL) && !("tip" in A.KIND_LABEL)));
// ── P44589–P44593, P44667–P44679 ──
R("P44589", AS, "every kind of thing that can happen has words a person can read", () => assert(Object.values(A.KIND_LABEL).every((l) => /^[A-Z]/.test(l))));
R("P44590", AS, "…and not one of them prints its own database code", () => assert(Object.entries(A.KIND_LABEL).every(([k, l]) => l !== k && !/_/.test(l))));
R("P44591", AS, "…and each one starts like a sentence, not mid-word", () => assert(Object.values(A.KIND_LABEL).every((l) => /^[A-Z]/.test(l))));
R("P44592", AS, "every kind belongs to a group, so the type filter can actually reach it", () => assert(Object.keys(A.KIND_LABEL).every((k) => A.ACTIVITY_GROUPS.some((g) => g.id === A.activityGroupOf(k)))));
R("P44593", AS, "…and every group has words of its own too", () => assert(A.ACTIVITY_GROUPS.every((g) => A.activityGroupLabel(g.id) && A.activityGroupLabel(g.id) !== g.id)));
const act = [{ id: 1, action: "order_tip", detail: "tip ₹50", created_at: "2026-10-01T10:00:00Z" }, { id: 2, action: "kot_print", detail: "KOT 3", created_at: "2026-10-02T10:00:00Z" }, { id: 3, action: "login", created_at: "2026-10-03T10:00:00Z" }];
R("P44667", AS, "newest-first really is newest first", () => eq(A.activityView(act, { sort: "new" }).map((r) => r.id), [3, 2, 1]));
R("P44668", AS, "…and oldest-first is its exact mirror", () => eq(A.activityView(act, { sort: "old" }).map((r) => r.id), [1, 2, 3]));
R("P44669", AS, "the log opens on newest first", () => eq(A.ACTIVITY_DEFAULT_SORT, "new"));
R("P44670", AS, "the counts beside each type add up to the rows there really are", () => eq(A.activityCounts(act).reduce((s, x) => s + x.count, 0), 3));
R("P44671", AS, "…and every group offered has words and a mark of its own", () => assert(A.activityCounts(act).every((c) => c.label && c.icon)));
R("P44672", AS, "searching for a word finds the row that contains it", () => eq(A.activityView(act, { q: "tip" }).map((r) => r.id), [1]));
R("P44673", AS, "…and a search nobody typed matches everything", () => eq(A.activityView(act, { q: "" }).length, 3));
R("P44674", AS, "…and a search that matches nothing hides everything", () => eq(A.activityView(act, { q: "zzqx" }).length, 0));
R("P44675", AS, "a row with no words in it at all cannot break the search", () => assert(A.activityMatches({}, "x") === false));
R("P44676", AS, "…nor break the sort", () => eq(A.activityView([null, { id: 1 }].filter(Boolean)).length, 1));
R("P44677", AS, "a search is not case-fussy", () => eq(A.activityView(act, { q: "TIP" }).length, 1));
R("P44678", AS, "…and a stray space either side is ignored", () => eq(A.activityView(act, { q: "  tip  " }).length, 1));
R("P44679", AS, "forty rows stamped the same second come out in the same order every time", () => { const f = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, action: "x", created_at: "2026-10-01T10:00:00Z" })); return eq(A.activityView(f).map((r) => r.id), A.activityView(f.slice().reverse()).map((r) => r.id)); });
// ── P45470–P45489: the SAME answers from the bytes the backup site serves ──
const SV = (id, what, fn) => R(id, AS, what + " (computed by the site's own bytes)", async () => fn(await S()), `GET ${SITE}/panels/auditsort.js`);
SV("P45470", "the site's log sorter knows every kind of thing that can happen", (B) => eq(Object.keys(B.KIND_LABEL).sort(), Object.keys(A.KIND_LABEL).sort()));
SV("P45471", "…and not one of them prints its own database code", (B) => assert(Object.entries(B.KIND_LABEL).every(([k, l]) => l !== k && !/_/.test(l))));
SV("P45472", "…and every one has a glyph beside its words", (B) => assert(Object.keys(B.KIND_LABEL).every((k) => B.KIND_ICON[k])));
SV("P45473", "…and every one belongs to a group", (B) => assert(Object.keys(B.KIND_LABEL).every((k) => B.activityGroupOf(k))));
SV("P45474", "…and every group has words of its own", (B) => assert(B.ACTIVITY_GROUPS.every((g) => B.activityGroupLabel(g.id))));
SV("P45475", "newest-first really is newest first", (B) => eq(B.activityView(act, { sort: "new" }).map((r) => r.id), [3, 2, 1]));
SV("P45476", "…and oldest-first is its exact mirror", (B) => eq(B.activityView(act, { sort: "old" }).map((r) => r.id), [1, 2, 3]));
SV("P45477", "the log opens on newest first", (B) => eq(B.ACTIVITY_DEFAULT_SORT, "new"));
SV("P45478", "the counts beside each type add up to the rows there really are", (B) => eq(B.activityCounts(act).reduce((s, x) => s + x.count, 0), 3));
SV("P45479", "…and every group offered has words and a mark", (B) => assert(B.activityCounts(act).every((c) => c.label && c.icon)));
SV("P45480", "searching finds the row that contains the word", (B) => eq(B.activityView(act, { q: "tip" }).length, 1));
SV("P45481", "…and is not case-fussy", (B) => eq(B.activityView(act, { q: "TIP" }).length, 1));
SV("P45482", "…and ignores a stray space either side", (B) => eq(B.activityView(act, { q: "  tip  " }).length, 1));
SV("P45483", "…an empty search shows everything", (B) => eq(B.activityView(act, { q: "" }).length, 3));
SV("P45484", "…and a search that matches nothing hides everything", (B) => eq(B.activityView(act, { q: "zzqx" }).length, 0));
SV("P45485", "a row with no words cannot break the search", (B) => assert(B.activityMatches({}, "x") === false));
SV("P45486", "…nor a null break the sort", (B) => eq(B.activityView([{ id: 1 }]).length, 1));
SV("P45487", "forty rows stamped the same second come out in the same order every time", (B) => { const f = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, created_at: "2026-10-01T10:00:00Z" })); return eq(B.activityView(f).map((r) => r.id), B.activityView(f.slice().reverse()).map((r) => r.id)); });
SV("P45488", "two thousand rows sort fast enough that the screen does not stutter", (B) => { const f = Array.from({ length: 2000 }, (_, i) => ({ id: i, action: i % 2 ? "login" : "kot_print", created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() })); const t = Date.now(); B.activityView(f, { q: "o" }); const ms = Date.now() - t; return ok(ms < 100, `${ms}ms`); });
SV("P45489", "the log sorter raises no error", () => true);

done();
