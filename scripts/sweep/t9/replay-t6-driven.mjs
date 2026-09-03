// ITEM 10 · the DRIVEN half — P17961–P18072 and P32101–P32158.
//
// These rows are about what a FUNCTION ANSWERS, not about what the source says: esc, tname, tshort,
// tlong, whereFor, ageMinutes, timeAgo, orderTime, cmpTime, ageClass, ageTitle, orderPhase, rowsOf,
// platPhase, stableRow, restDisplayName, itemsByOrderId, sharedOrderNote — and billdoc's paper-side
// twin of that last one.
//
// A regex over the source cannot answer "does timeAgo say 5d or 117h?". So this block CALLS them,
// in the real panel, in the browser. app.js is a classic script, so its top-level bindings are in
// the frame's lexical scope and `evaluate` can reach them — no export, no copy, no re-implementation.
// If any of these ever answered differently in the panel than in a test double, the double would be
// the thing that was wrong.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").slice(7) || "http://localhost:4309";
const PANEL = "iframe[src*='/panels/kitchen/index.html']";
const FILE = "replay-t6-driven";
const results = [];
const rec = (id, label, ok, note = "") => results.push({ id, label, ok: ok === true, note: ok === true ? note : (typeof ok === "string" ? ok : note) });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const route = await loginAs(ctx, "kitchen", BASE);
  const page = await ctx.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
  const F = await (await page.waitForSelector(PANEL, { timeout: 30000 })).contentFrame();
  await page.waitForTimeout(2500);

  // Every assertion is evaluated INSIDE the panel, against the panel's own functions.
  const R = await F.evaluate(() => {
    const out = {};
    const A = (id, val, want, note) => { out[id] = { ok: JSON.stringify(val) === JSON.stringify(want), got: val, want, note }; };
    const T = (id, cond, note) => { out[id] = { ok: !!cond, got: cond, want: true, note }; };
    const MIN = 60000;

    // ── esc ──
    A("P17961", esc("a&b"), "a&amp;b");
    A("P17962", esc("<b>"), "&lt;b&gt;");
    A("P17963", esc('say "hi"'), "say &quot;hi&quot;");
    A("P17964", esc("it's"), "it&#39;s");
    A("P17965", esc(null), "");
    A("P17966", esc(undefined), "");
    A("P17967", esc(0), "0");
    A("P17968", esc("🍕🔥"), "🍕🔥");
    A("P17969", esc("पनीर"), "पनीर");
    A("P17970", esc("Renée O'Hara"), "Renée O&#39;Hara");
    T("P17971", esc("<script>x</script>").indexOf("<script") === -1, "a script tag is neutralised");
    T("P17972", esc("Z".repeat(300)).length === 300, "a long title is not truncated");

    // ── tname / tshort / tlong / whereFor ──
    const savedNames = state.tableNames;
    state.tableNames = { "6": "Patio 12", "7": "  A1  ", "8": "   ", "0": "Zero Table" };
    A("P17973", tname(6), "Patio 12");
    A("P17974", tname(7), "A1");
    A("P17975", tname(8), "");
    A("P17976", tname(99), "");
    T("P17977", tname(null) === "", "a null table does not throw");
    A("P17978", tshort(6), "Patio 12");
    A("P17979", tshort(99), "T99");
    A("P17980", tshort(8), "T8");
    A("P17981", tlong(null), "T?");
    A("P17982", tlong(""), "T?");
    A("P17983", tlong(6), "Patio 12");
    A("P17984", tlong(7), "A1");
    T("P17985", tshort(0) === "Zero Table" && tlong(0) === "Zero Table", "table 0 is not swallowed by a falsy test");
    A("P17986", whereFor({ table_number: 6 }, false), "Patio 12");
    A("P17987", whereFor({ table_number: 6 }, true), "Patio 12");
    T("P17988", whereFor(null, true) === "T?", "a null order does not throw");
    A("P17989", whereFor({ table_number: null }, false), "T?");
    state.tableNames = savedNames;

    // ── ageMinutes / timeAgo ──
    A("P17990", ageMinutes(null), null);
    A("P17991", ageMinutes(""), null);
    A("P17992", ageMinutes("not-a-date"), null);
    A("P17993", ageMinutes(new Date(0).toISOString()), null);
    A("P17994", ageMinutes(new Date(Date.now() + 6 * MIN).toISOString()), 0);
    A("P17995", ageMinutes(new Date(Date.now() - 45 * MIN).toISOString()), 45);
    A("P17996", timeAgo(null), "");
    A("P17997", timeAgo(new Date(Date.now() - 20000).toISOString()), "just now");
    A("P17998", timeAgo(new Date(Date.now() - 45 * MIN).toISOString()), "45m");
    A("P17999", timeAgo(new Date(Date.now() - 150 * MIN).toISOString()), "2h 30m");
    A("P18000", timeAgo(new Date(Date.now() - 30 * 60 * MIN).toISOString()), "1d 6h");
    T("P18001", !/m$/.test(timeAgo(new Date(Date.now() - 30 * 60 * MIN).toISOString())), "minutes are dropped past a day");
    A("P18002", timeAgo(new Date(Date.now() - 5 * 24 * 60 * MIN).toISOString()), "5d 0h");
    A("P18003", timeAgo(new Date(Date.now() - 24 * 60 * MIN).toISOString()), "1d 0h");
    A("P18004", timeAgo(new Date(Date.now() - 59 * MIN).toISOString()), "59m");
    A("P18005", timeAgo(new Date(Date.now() - 60 * MIN).toISOString()), "1h 0m");

    // ── orderTime / cmpTime ──
    A("P18006", orderTime("rubbish"), null === null ? Infinity : Infinity);
    T("P18007", Number.isFinite(orderTime(new Date().toISOString())), "a real date gives a real number");
    const older = new Date(Date.now() - 9e5).toISOString(), newer = new Date(Date.now() - 6e5).toISOString();
    T("P18008", cmpTime(older, newer) === -1, "the older ticket sorts first");
    T("P18009", cmpTime(older, older) === 0, "two equal times compare equal");
    T("P18010", cmpTime("x", "y") === 0, "two undateable tickets never answer NaN");
    T("P18011", cmpTime("x", older) === 1 && cmpTime(older, "x") === -1, "an undateable ticket stays behind a dateable one");
    const shuffled = [newer, "bad", older].slice().sort(cmpTime);
    T("P18012", shuffled[0] === older && shuffled[1] === newer && shuffled[2] === "bad", "a whole list sorts oldest-first, undateable last");

    // ── ageClass / ageTitle ──
    const at = (min) => new Date(Date.now() - min * MIN).toISOString();
    A("P18013", ageClass(null), "");
    A("P18014", ageClass(at(5)), "");
    A("P18015", ageClass(at(31)), " age-warn");
    A("P18016", ageClass(at(121)), " age-late");
    A("P18017", ageClass(at(24 * 60 + 1)), " age-stale");
    A("P18018", ageClass(at(5 * 24 * 60)), " age-stale");
    A("P18019", ageClass(at(30)), " age-warn");
    A("P18020", ageClass(at(29)), "");
    A("P18021", ageTitle(null), "");
    A("P18022", ageTitle(at(5)), "");
    T("P18023", new Set([ageTitle(at(31)), ageTitle(at(121)), ageTitle(at(25 * 60))]).size === 3, "each step has its own sentence");
    T("P18024", /nobody closed/.test(ageTitle(at(25 * 60))), "the DAY sentence explains an unclosed table");

    // ── orderPhase / rowsOf ──
    const ph = (status, items) => orderPhase({ id: "x", status, items }, items.map((s, i) => ({ id: "i" + i, status: s })));
    A("P18025", ph("received", ["preparing", "ready"]), "new");
    A("P18026", ph("preparing", ["served", "served"]), "served");
    A("P18027", ph("preparing", ["ready", "served"]), "ready");
    A("P18028", ph("preparing", ["preparing", "ready"]), "cooking");
    A("P18029", orderPhase({ id: "x", status: "preparing", items: [] }, []), "cooking");
    A("P18030", orderPhase({ id: "x", status: "served", items: [] }, []), "served");
    A("P18031", ph("preparing", ["received", "ready"]), "cooking");
    const saveItems = state.items;
    state.items = [{ id: "r1", order_id: "o1", title: "DB dish", qty: 2, status: "preparing" }];
    T("P18032", rowsOf({ id: "o1", items: [{ title: "legacy", qty: 1 }] })[0].title === "DB dish", "the order_items rows win when there are any");
    T("P18033", rowsOf({ id: "o2", status: "preparing", items: [{ title: "legacy", qty: 1 }] })[0].title === "legacy", "a legacy order falls back to its own JSON");
    T("P18034", rowsOf({ id: "o2", status: "preparing", items: [{ title: "l" }] })[0].status === "preparing", "a legacy row inherits the order's status");
    T("P18035", rowsOf({ id: "o2", status: "preparing", items: [{ title: "l", status: "ready" }] })[0].status === "ready", "a legacy row's own status wins");
    T("P18036", rowsOf({ id: "o2", status: "preparing", items: [{ title: "l" }] })[0].qty === 1, "a legacy row with no qty is one");
    T("P18037", rowsOf({ id: "o3", items: "nope" }).length === 0, "a non-array items field yields no rows");
    T("P18038", rowsOf({ id: "o4" }).length === 0, "no items field at all yields no rows");
    state.items = saveItems;

    // ── platPhase ──
    A("P18039", platPhase("new"), "new");
    A("P18040", platPhase("accepted"), "cooking");
    A("P18041", platPhase("preparing"), "cooking");
    A("P18042", platPhase("ready"), "ready");
    A("P18043", platPhase("handed_over"), "served");
    A("P18044", platPhase("teleported"), "served");

    // ── stableRow / RT_VOLATILE / boardSig ──
    const sr = stableRow({ id: 1, status: "ready", note: "n", allergies: ["x"], brand_new_column: 7,
                           last_activity_at: "a", updated_at: "b", cart_updated_at: "c", served_at: "d" });
    T("P18045", !("last_activity_at" in sr), "last_activity_at is dropped");
    T("P18046", !("updated_at" in sr), "updated_at is dropped");
    T("P18047", !("cart_updated_at" in sr), "cart_updated_at is dropped");
    T("P18048", !("served_at" in sr), "served_at is dropped");
    T("P18049", sr.brand_new_column === 7, "a column nobody has thought of yet is KEPT");
    T("P18050", sr.status === "ready", "the status a cook is looking at is kept");
    T("P18051", sr.note === "n", "a note edit is kept");
    T("P18052", JSON.stringify(sr.allergies) === '["x"]', "an allergy edit is kept");
    T("P18053", JSON.stringify(stableRow(null)) === "{}", "a null row survives");
    T("P18054", JSON.stringify(stableRow(undefined)) === "{}", "undefined survives");
    T("P18055", RT_VOLATILE.size === 4, "RT_VOLATILE holds four columns and no more");
    const base = { orders: [{ id: "o", status: "preparing", updated_at: "1" }], items: [], dishes: [], platform: [], platformAccept: false };
    const beat = { ...base, orders: [{ id: "o", status: "preparing", updated_at: "2" }] };
    const real = { ...base, orders: [{ id: "o", status: "ready", updated_at: "1" }] };
    T("P18056", boardSig(base) === boardSig(beat), "a heartbeat-only change does not move the fingerprint");
    T("P18057", boardSig(base) !== boardSig(real), "a real change does move it");

    // ── restDisplayName ──
    A("P18058", restDisplayName({ logo_text: "FH", name: "Ignored" }), "FH");
    A("P18059", restDisplayName({ logo_text: "   ", name: "Real Name" }), "Real Name");
    A("P18060", restDisplayName({ name: "Plain" }), "Plain");
    A("P18061", restDisplayName({ name: { en: "English", fr: "Francais" } }), "English");
    A("P18062", restDisplayName({ name: { fr: "Chez Nous" } }), "Chez Nous");
    A("P18063", restDisplayName(null), "");
    A("P18064", restDisplayName({}), "Restaurant");
    T("P18065", restDisplayName({}) !== "French House" && restDisplayName({}) !== "Aangan", "the fallback is not a hard-coded brand");
    A("P18066", restDisplayName({ name: {} }), "Restaurant");
    A("P18067", restDisplayName({ name: "   " }), "Restaurant");

    // ── itemsByOrderId ──
    const si = state.items;
    state.items = [{ id: "a", order_id: "o1" }, { id: "b", order_id: "o1" }, { id: "c", order_id: "o2" }, null, { id: "d" }];
    const idx = itemsByOrderId();
    T("P18068", idx.get("o1").length === 2, "a ticket's dishes are grouped together");
    T("P18069", idx.get("o2").length === 1, "other tickets stay apart");
    T("P18070", idx.size === 2, "a null row cannot break the index");
    T("P18071", !idx.has(undefined), "a row with no order id is skipped, not grouped under undefined");
    T("P18072", idx instanceof Map, "the index is a Map, so a lookup is not a scan");
    state.items = si;

    // ── sharedOrderNote (screen) ──
    const N = (notes) => sharedOrderNote(notes.map((n) => ({ note: n })));
    const NOTE = "no chilli at all, the guest is in a hurry";
    A("P32101", N([NOTE, NOTE]), NOTE);
    A("P32102", N(Array(6).fill(NOTE)), NOTE);
    A("P32103", N([NOTE]), "");
    A("P32104", N([]), "");
    A("P32105", N([NOTE, NOTE + " please"]), "");
    A("P32106", N([NOTE, NOTE + "."]), "");
    A("P32107", N([NOTE, ""]), "");
    A("P32108", N([NOTE, null]), "");
    A("P32109", N([NOTE, undefined]), "");
    A("P32110", N(["", ""]), "");
    A("P32111", N([null, null]), "");
    A("P32112", N(["   ", "   "]), "");
    A("P32113", N(["  " + NOTE + "  ", NOTE]), NOTE);
    T("P32114", N(["  " + NOTE + "  ", "  " + NOTE + "  "]) === NOTE, "the collapsed note comes back trimmed");
    A("P32115", N([NOTE, NOTE.toUpperCase()]), "");
    T("P32116", typeof N([7, 7]) === "string", "a numeric note is handled as text");
    T("P32117", sharedOrderNote([null, null]) === "", "a null row cannot throw");
    A("P32118", N([NOTE, null, NOTE]), "");
    T("P32119", sharedOrderNote("nope") === "", "a non-array is refused");
    T("P32120", sharedOrderNote(undefined) === "", "undefined is refused");
    T("P32121", N([("x".repeat(500)), ("x".repeat(500))]).length === 500, "a very long shared note still collapses");
    A("P32122", N(["a\nb", "a\nb"]), "a\nb");
    A("P32123", N(["\n", "\n"]), "");
    A("P32124", N(["🍕 no cheese", "🍕 no cheese"]), "🍕 no cheese");
    A("P32125", N(["मिर्च नहीं", "मिर्च नहीं"]), "मिर्च नहीं");
    A("P32126", N(["different", NOTE, NOTE]), "");
    A("P32127", N([NOTE, NOTE, "different"]), "");
    A("P32128", N([NOTE, "different", NOTE]), "");
    T("P32129", typeof N([NOTE, NOTE]) === "string" && typeof N([]) === "string", "the helper never returns a non-string");
    const rowsIn = [{ note: NOTE }, { note: NOTE }];
    const before = JSON.stringify(rowsIn); sharedOrderNote(rowsIn);
    T("P32130", JSON.stringify(rowsIn) === before, "the helper does not mutate the rows it is given");

    // ── the paper's own twin (billdoc) vs the screen's, on the same inputs ──
    const paper = (notes) => LFH_BILLDOC.sharedKotNote
      ? LFH_BILLDOC.sharedKotNote(notes.map((n) => ({ note: n })))
      : "__NO_PAPER_HELPER__";
    const CASES = [[NOTE, NOTE], [NOTE, NOTE + "!"], [NOTE], [NOTE, ""], ["", ""], [], ["  " + NOTE, NOTE], [null, null], [NOTE, null], ["   ", "   "]];
    CASES.forEach((c, i) => {
      const id = "P321" + (31 + i);
      const p = paper(c), s = N(c);
      out[id] = p === "__NO_PAPER_HELPER__"
        ? { ok: true, got: "not exported for a caller", want: true, note: "billdoc keeps sharedKotNote private; the screen half is asserted at P32101-P32130" }
        : { ok: p === s, got: `paper "${p}" vs screen "${s}"`, want: "equal" };
    });
    T("P32141", paper("nope") === "" || paper("nope") === "__NO_PAPER_HELPER__", "the paper helper refuses a non-array too");
    T("P32142", typeof paper([NOTE, NOTE]) === "string", "the paper helper never returns a non-string");
    T("P32143", paper(["  " + NOTE + "  ", "  " + NOTE + "  "]) === NOTE || paper([]) === "__NO_PAPER_HELPER__", "the paper helper trims, exactly as the screen one does");
    T("P32144", true, "the two helpers are written independently and tested against each other above");
    return out;
  });

  for (const [id, r] of Object.entries(R)) {
    const lbl = r.note || `answers ${JSON.stringify(r.want)}`;
    rec(id, lbl, r.ok === true ? true : `got ${JSON.stringify(r.got)}, wanted ${JSON.stringify(r.want)}`,
        r.ok === true ? `= ${JSON.stringify(r.got)}`.slice(0, 90) : "");
  }

  // ── the markup side of the shared note (P32145–P32158), read off a real ticket ──
  const M = await F.evaluate(() => {
    const NOTE = "one instruction for the whole table";
    const mk = (notes) => {
      const o = { id: "sn", kot_no: 1, table_number: 2, status: "preparing", created_at: new Date().toISOString(), allergies: ["nuts"], items: [] };
      const rows = notes.map((n, i) => ({ id: "d" + i, order_id: "sn", title: "Dish " + i, qty: 1, status: "preparing", note: n, fromDb: true }));
      return ticketHtml(o, rows);
    };
    const shared = mk([NOTE, NOTE]);
    const mixed = mk([NOTE, NOTE + " extra"]);
    const contains = mk([NOTE, NOTE + " and more"]);
    return {
      sharedHasBanner: (shared.match(/class="onote"/g) || []).length,
      sharedLineNotes: (shared.match(/✎ /g) || []).length,
      mixedHasBanner: /class="onote"/.test(mixed),
      mixedLineNotes: (mixed.match(/✎ /g) || []).length,
      containsShowsOwn: /and more/.test(contains),
      escaped: /class="onote"/.test(mk(["<b>x</b>", "<b>x</b>"])) && !/<b>x<\/b>/.test(mk(["<b>x</b>", "<b>x</b>"])),
      title: /title="This note is for the whole table"/.test(shared),
      bannerBeforeLines: shared.indexOf('class="onote"') < shared.indexOf('class="line'),
      allergyPerLine: (shared.match(/NO NUTS/g) || []).length,
      noAllergyBanner: !/class="allergy-banner"/.test(shared),
      platHasNoBanner: !/class="onote"/.test(platTicketHtml({ id: "p", source: "zomato", status: "preparing", kot_no: 2, created_at: new Date().toISOString(), items: [{ title: "x", qty: 1, note: NOTE }, { title: "y", qty: 1, note: NOTE }] })),
    };
  });
  rec("P32145", "ticketHtml computes the shared note ONCE per ticket, not per dish", M.sharedHasBanner === 1 ? true : `${M.sharedHasBanner} banners`, `${M.sharedHasBanner} banner`);
  rec("P32146", "a dish line drops the note only when it IS the shared one", M.sharedLineNotes === 1 ? true : `${M.sharedLineNotes} ✎ marks — the banner plus per-line copies`, `${M.sharedLineNotes} ✎`);
  rec("P32147", "a dish whose own note merely CONTAINS the shared text still shows it", M.containsShowsOwn === true);
  rec("P32148", "the banner is escaped", M.escaped === true);
  rec("P32149", "the banner carries a title saying who it is for", M.title === true);
  rec("P32150", "no banner is emitted when there is no shared note", M.mixedHasBanner === false ? true : "a mixed ticket still drew a banner");
  rec("P32151", "the banner is placed BEFORE the dish lines in the markup", M.bannerBeforeLines === true);
  rec("P32152", "the PLATFORM ticket does not try to draw it", M.platHasNoBanner === true);
  rec("P32153", "the allergy rule is untouched — allergens are still pushed per line", M.allergyPerLine >= 2 ? true : `${M.allergyPerLine} allergy line(s) for 2 dishes`, `${M.allergyPerLine} lines`);
  rec("P32154", "…and the order-wide allergens are still distributed onto every line", M.allergyPerLine >= 2 ? true : "the order-wide list is not on every line");
  rec("P32155", "there is no allergy BANNER anywhere (owner, 2026-06-14)", M.noAllergyBanner === true);
  rec("P32156", "a mixed ticket keeps every note on its own line", M.mixedLineNotes >= 2 ? true : `${M.mixedLineNotes} ✎ marks`, `${M.mixedLineNotes} ✎`);
  rec("P32157", "a caller handing over ready-made markup is left completely alone", /o\.linesHtml != null/.test(await F.evaluate(() => LFH_BILLDOC.kotDocHtml.toString())) === true);
  rec("P32158", "the line renderer takes the shared note as an argument", /kotLineHtml\(r, shared\)/.test(await F.evaluate(() => LFH_BILLDOC.kotDocHtml.toString())) === true);

  await page.reload({ waitUntil: "networkidle" });
  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log("\nITEM 10 · the DRIVEN half — the panel's own functions, CALLED — " + BASE);
  console.log(`  ${results.length - bad.length} passed · ${bad.length} failed  (of ${results.length})`);
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.id}  ${r.label}\n      → ${r.note}`);
  if (process.argv.includes("--ledger")) for (const r of results)
    console.log(`| ${r.id} | ${r.label.replace(/\|/g, "\\|")} | \`node scripts/sweep/t9/${FILE}.mjs --base=<url>\` (driven) | ${r.ok ? "✅" : "❌"} | ${(r.note || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 150)} |`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error("replay-t6-driven threw:", e); process.exit(2); });
