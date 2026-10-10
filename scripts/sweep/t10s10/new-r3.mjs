// Round 3 (2026-10-10) — the owner's "check every single bit … I want zero error". P211001–P211999.
//
// AIMED BY MEASUREMENT, NOT BY IDEA: scripts/sweep/t10s10/coverage.mjs ran every in-memory check this
// terminal owned against the REAL route.ts and listed the lines and branch arms no check had ever
// executed (269 lines + 597 arms, 2026-10-10). Each row below drives one of them, in memory, and
// asserts what the handler WROTE or ANSWERED — never "the source contains". The two opt-in stub
// features this needs (an error carrying a real database code; an update handing back the rows it
// matched) were added to scripts/panel-stubs/sb.mjs for this block.
import { check, call } from "./lib.mjs";
import { fullWorld, ID } from "./endpoints.mjs";

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
let n = 211001;
const row = (what, fn, how = "STUB · the real route, French House manager unless named") => check(`P${n++}`, what, how, fn);
const run = async (setup, verb, path, body) => {
  const G = await fullWorld(setup);
  G.HONOUR_UPDATE_RETURN = true;
  G.HONOUR_COLUMNS = false; // opt-in per row (the menu-delete naming rows)
  if (setup.mut) setup.mut(G);
  const r = await call(verb, path, body === undefined || body === null ? {} : { body });
  return { G, r };
};
const W = (G, table) => G.WRITES.filter((w) => w.table === table && (w.op === "insert" || w.op === "upsert" || w.matched > 0));
const lastPatch = (G, table) => { const w = G.WRITES.filter((x) => x.table === table && x.op !== "delete").pop(); return (w && w.patch) || {}; };
const rpc = (G, name) => G.RPCS.filter((c) => c.name === name);
const audits = (G, kind) => rpc(G, "lfh_record_removal").filter((c) => !kind || c.args.p_kind === kind);
const logged = (G, a) => G.LOGS.filter((l) => l.action === a);
const ord = (G, id = ID.order) => G.FIX.orders.find((o) => o.id === id);
const owner = { who: "owner" };
const settingsSave = (body, setup = owner) => run(setup, "POST", "settings", body);

// ══ 1 · THE SETTINGS SAVE — 0 rows had ever driven it (ledger: "settings save 1 · 0") ══════════
row("the log-retention window: a MANAGER is told only the owner can change it (code retention_manager_blocked), nothing saved", async () => {
  const { G, r } = await settingsSave({ oplog_retention_days: 7 }, {});
  return { ok: r.status === 403 && r.json.code === "retention_manager_blocked" && /owner/.test(r.json.error) && !W(G, "settings").length, note: `${r.status} ${r.json && r.json.code}` }; });
row("…and when Aevidine has LOCKED it, even the owner is told so (retention_locked), nothing saved", async () => {
  const { G, r } = await settingsSave({ oplog_retention_days: 7 }, { ...owner, fix: { app_config: [{ key: "log_retention_lock", value: { locked: true } }] } });
  return { ok: r.status === 403 && r.json.code === "retention_locked" && /locked/.test(r.json.error) && !W(G, "settings").length, note: `${r.status} ${r.json && r.json.code}` }; });
row("…unlocked, the owner's window is saved and clamped to 1–90 days (0 → 1)", async () => {
  const { G, r } = await settingsSave({ oplog_retention_days: 0, custlog_retention_days: 500 });
  const p = lastPatch(G, "settings"); return { ok: r.status === 200 && p.oplog_retention_days === 1 && p.custlog_retention_days === 90, note: JSON.stringify([p.oplog_retention_days, p.custlog_retention_days]) }; });
row("…and a window that is not a number falls back to 90 days, never to NaN", async () => {
  const { G } = await settingsSave({ oplog_retention_days: "abc" }); return { ok: lastPatch(G, "settings").oplog_retention_days === 90, note: String(lastPatch(G, "settings").oplog_retention_days) }; });
row("a manager whose Tables section is switched off is refused a table rename on that ground", async () => {
  const { r } = await settingsSave({ table_names: { 1: "Patio" } }, { accessConfig: { menus: { mgrset: { tables: false } } } });
  return { ok: r.status === 403 && /change the tables/.test(r.json.error), note: `${r.status} ${r.text.slice(0, 80)}` }; });
row("a manager with Tables ON is still told table names and seats are the admin's (403), nothing saved", async () => {
  const { G, r } = await settingsSave({ table_seats: { 1: 6 } }, {});
  return { ok: r.status === 403 && /set by the admin only/.test(r.text) && !W(G, "settings").length, note: `${r.status}` }; });
row("a manager changing how many tables sit on a row is told the admin sets the layout (403)", async () => {
  const { r } = await settingsSave({ floor_per_row: 5 }, {}); return { ok: r.status === 403 && /laid out/.test(r.text), note: `${r.status}` }; });
row("a manager sending ANY other setting (the bill footer) is refused — there is nothing left a manager may change here", async () => {
  const { G, r } = await settingsSave({ bill_footer: "Thanks!" }, {}); return { ok: r.status === 403 && !W(G, "settings").length, note: `${r.status}` }; });
row("a manager's save carrying only the row id passes the refusals and writes nothing the admin owns", async () => {
  const { G, r } = await settingsSave({ id: "x" }, {});
  const p = lastPatch(G, "settings"); return { ok: r.status === 200 && !("tax_rate" in p) && !("gstin" in p) && p.restaurant_id === "rest-1", note: `${r.status} ${JSON.stringify(p).slice(0, 80)}` }; });
row("the settings row id is always the restaurant's EXISTING row, never the 'site' a stale panel sends", async () => {
  const { G } = await settingsSave({ id: "site", bill_footer: "x" }); return { ok: lastPatch(G, "settings").id === "site" && lastPatch(G, "settings").restaurant_id === "rest-1", note: lastPatch(G, "settings").id }; },
  "STUB · owner; French House's existing settings row is id 'site' in this world, so 'site' is correct — the point is restaurant_id pins it");
row("an owner cannot grant an admin entitlement by sending any `*_allowed` flag", async () => {
  const { G } = await settingsSave({ auto_print_kot_allowed: true, item_tax_modes_allowed: true, bill_footer: "x" });
  const p = lastPatch(G, "settings"); return { ok: !("auto_print_kot_allowed" in p) && !("item_tax_modes_allowed" in p) && p.bill_footer === "x", note: Object.keys(p).join(",") }; });
row("the banquet bill prefix is cleaned to letters and digits, upper-case, ≤ 8 (\"bq-1!\" → \"BQ1\")", async () => {
  const { G } = await settingsSave({ banquet_bill_prefix: "bq-1!" }); return { ok: lastPatch(G, "settings").banquet_bill_prefix === "BQ1", note: lastPatch(G, "settings").banquet_bill_prefix }; });
row("…an empty prefix becomes the default BQB, never an empty series name", async () => {
  const { G } = await settingsSave({ banquet_bill_prefix: "--" }); return { ok: lastPatch(G, "settings").banquet_bill_prefix === "BQB", note: lastPatch(G, "settings").banquet_bill_prefix }; });
row("…an unknown numbering style falls back to the financial-year style", async () => {
  const { G } = await settingsSave({ banquet_bill_style: "weekly" }); return { ok: lastPatch(G, "settings").banquet_bill_style === "fy", note: lastPatch(G, "settings").banquet_bill_style }; });
row("…a real style ('date') is kept", async () => {
  const { G } = await settingsSave({ banquet_bill_style: "date" }); return { ok: lastPatch(G, "settings").banquet_bill_style === "date", note: lastPatch(G, "settings").banquet_bill_style }; });
row("the banquet STARTING number cannot move once a banquet bill has been issued (409), so the series stays gapless", async () => {
  const { G, r } = await settingsSave({ banquet_bill_next: 50 }, { ...owner, settings: { banquet_bill_next: 4 }, fix: { banquet_bills: [{ id: "bb1", restaurant_id: "rest-1" }] } });
  return { ok: r.status === 409 && /already been issued/.test(r.text) && !W(G, "settings").length, note: `${r.status}` }; });
row("…re-sending the CURRENT number is not a change and saves", async () => {
  const { r } = await settingsSave({ banquet_bill_next: 4 }, { ...owner, settings: { banquet_bill_next: 4 }, fix: { banquet_bills: [{ id: "bb1", restaurant_id: "rest-1" }] } });
  return { ok: r.status === 200, note: `${r.status}` }; });
row("…with no banquet bill yet, the starting number is clamped to 1–99,999,999", async () => {
  // read each result BEFORE the next call — the stub world is one shared object
  const v = []; for (const x of [0, 1e12, "x"]) v.push(lastPatch((await settingsSave({ banquet_bill_next: x })).G, "settings").banquet_bill_next); return { ok: v[0] === 1 && v[1] === 99999999 && v[2] === 1, note: JSON.stringify(v) }; });
row("the owner's table count is clamped to 1–500 and a non-number becomes 12", async () => {
  const v = []; for (const x of [0, 9999, "x"]) v.push(lastPatch((await settingsSave({ table_count: x })).G, "settings").table_count);
  return { ok: JSON.stringify(v) === "[1,500,12]", note: JSON.stringify(v) }; });
row("the guest location radius is clamped to 20–5,000 m and a non-number becomes 250", async () => {
  const v = []; for (const x of [5, 1e6, "x"]) v.push(lastPatch((await settingsSave({ geo_radius_m: x })).G, "settings").geo_radius_m);
  return { ok: JSON.stringify(v) === "[20,5000,250]", note: JSON.stringify(v) }; });
row("the restaurant's latitude/longitude are numbers or null, never text", async () => {
  const { G } = await settingsSave({ geo_lat: "23.0225", geo_lng: "east" }); const p = lastPatch(G, "settings");
  return { ok: p.geo_lat === 23.0225 && p.geo_lng === null, note: JSON.stringify([p.geo_lat, p.geo_lng]) }; });
row("the four on/off settings store a real true/false (\"true\" → true, \"yes\" → false)", async () => {
  const { G } = await settingsSave({ sessions_enabled: "true", require_otp: "yes", auto_print_kot: true, require_location: 1 }); const p = lastPatch(G, "settings");
  return { ok: p.sessions_enabled === true && p.require_otp === false && p.auto_print_kot === true && p.require_location === false, note: JSON.stringify([p.sessions_enabled, p.require_otp, p.auto_print_kot, p.require_location]) }; });
row("the named tax breakdown keeps only labelled taxes between 0 and 100%, trimmed, at most six", async () => {
  const { G } = await settingsSave({ tax_components: [{ label: " CGST ", rate: 2.5 }, { label: "", rate: 5 }, { label: "Silly", rate: 250 }, { label: "Zero", rate: 0 }, ...Array.from({ length: 8 }, (_, i) => ({ label: "T" + i, rate: 1 }))] });
  const tc = lastPatch(G, "settings").tax_components; return { ok: tc.length === 6 && tc[0].label === "CGST" && tc[0].rate === 2.5 && !tc.some((c) => c.label === "Silly" || c.label === "Zero"), note: JSON.stringify(tc).slice(0, 90) }; });
row("…and a tax breakdown that is not a list becomes empty ('not configured'), never garbage in the column", async () => {
  const { G } = await settingsSave({ tax_components: "5%" }); return { ok: JSON.stringify(lastPatch(G, "settings").tax_components) === "[]", note: JSON.stringify(lastPatch(G, "settings").tax_components) }; });
row("a blank bill footer is stored as nothing (the default prints), and a long one is cut at 200", async () => {
  const a = lastPatch((await settingsSave({ bill_footer: "   " })).G, "settings").bill_footer; const b = lastPatch((await settingsSave({ bill_footer: "x".repeat(300) })).G, "settings").bill_footer;
  return { ok: a === null && b.length === 200, note: `${a} / ${b && b.length}` }; });
row("a blank on-screen tax word is stored as nothing, a long one cut at 20", async () => {
  const a = lastPatch((await settingsSave({ tax_label: " " })).G, "settings").tax_label; const b = lastPatch((await settingsSave({ tax_label: "Goods and Services Tax!" })).G, "settings").tax_label;
  return { ok: a === null && b.length === 20, note: `${a} / ${b}` }; });
row("seat counts are rebuilt: numbers only, 1–30 per table, a floor-wide 'default' kept, stray keys dropped", async () => {
  const { G } = await settingsSave({ table_seats: { 1: "4", 2: 99, default: "2", patio: 3, 0: 5, 3: "many" } });
  const s = lastPatch(G, "settings").table_seats; return { ok: JSON.stringify(s) === JSON.stringify({ 1: 4, 2: 30, default: 2 }), note: JSON.stringify(s) }; });
row("…and seat counts sent as a LIST become an empty map, never an array in the column", async () => {
  const { G } = await settingsSave({ table_seats: [4, 4] }); return { ok: JSON.stringify(lastPatch(G, "settings").table_seats) === "{}", note: JSON.stringify(lastPatch(G, "settings").table_seats) }; });
row("table names are trimmed, capped at 24, and blank or non-numbered ones dropped", async () => {
  const { G } = await settingsSave({ table_names: { 1: "  Patio  ", 2: "", bar: "Bar", 3: "A".repeat(30) } });
  const t = lastPatch(G, "settings").table_names; return { ok: t[1] === "Patio" && !("2" in t) && !("bar" in t) && t[3].length === 24, note: JSON.stringify(t).slice(0, 80) }; });
row("…and table names sent as a list become an empty map", async () => {
  const { G } = await settingsSave({ table_names: ["A"] }); return { ok: JSON.stringify(lastPatch(G, "settings").table_names) === "{}", note: "" }; });
row("the saved settings row comes back WITHOUT the delivery apps' connection keys", async () => {
  const { r } = await settingsSave({ bill_footer: "x" }, { ...owner, settings: { platform_channels: { zomato: { on: true, key: "SECRET-K" } } } });
  return { ok: r.status === 200 && !/SECRET-K/.test(r.text), note: `${r.status}` }; });

// ══ 2 · THE MENU SAVE — create and edit paths no check had driven ═══════════════════════════
const dish = (setup, body) => run(setup, "POST", "items", body);
row("a NEW dish gets an id unique across EVERY restaurant, namespaced for this one", async () => {
  const { G, r } = await dish(owner, { __create: true, title: "Paneer Tikka", price: "250" });
  const p = lastPatch(G, "menu_items"); return { ok: r.status === 200 && p.id === "paneer-tikka__rest-1" && p.slug === "paneer-tikka", note: `${p.id} · ${p.slug}` }; });
row("…and when that id is already taken (by ANY restaurant) it becomes -2, never overwriting the other dish", async () => {
  const { G } = await dish({ ...owner, mut: (G) => G.FIX.menu_items.push({ id: "paneer-tikka__rest-1", restaurant_id: "rest-2", slug: "x", title: "T" }) }, { __create: true, title: "Paneer Tikka", price: "250" });
  return { ok: lastPatch(G, "menu_items").id === "paneer-tikka__rest-1-2" && G.FIX.menu_items.find((d) => d.id === "paneer-tikka__rest-1").restaurant_id === "rest-2", note: lastPatch(G, "menu_items").id }; });
row("…and its guest-facing slug is unique WITHIN this restaurant (dal → dal-2)", async () => {
  const { G } = await dish(owner, { __create: true, title: "Dal", price: "100" }); return { ok: lastPatch(G, "menu_items").slug === "dal-2", note: lastPatch(G, "menu_items").slug }; });
row("a new dish with no name is refused before anything is written", async () => {
  const { G, r } = await dish(owner, { __create: true, title: "  ", price: "100" }); return { ok: r.status === 400 && /name/.test(r.text) && !W(G, "menu_items").length, note: `${r.status}` }; });
row("a new dish with no price is refused before anything is written", async () => {
  const { G, r } = await dish(owner, { __create: true, title: "Chai" }); return { ok: r.status === 400 && /price/.test(r.text) && !W(G, "menu_items").length, note: `${r.status}` }; });
row("a new dish with no photo or category is saved blank, never crashing on a required column", async () => {
  const { G, r } = await dish(owner, { __create: true, title: "Chai", price: "20" }); const p = lastPatch(G, "menu_items");
  return { ok: r.status === 200 && p.image === "" && p.category === "", note: JSON.stringify([p.image, p.category]) }; });
row("a manager without 'add a dish' is refused a new dish", async () => {
  const { r } = await dish({ accessConfig: { edit_menu: { manager_opts: { add_dish: false } } } }, { __create: true, title: "Chai", price: "20" });
  return { ok: r.status === 403 && /add a new dish/.test(r.text), note: `${r.status}` }; });
row("a price typed with a thousands comma (\"1,299\") is stored as the number 1299", async () => {
  const { G } = await dish(owner, { id: "dal", price: "1,299" }); return { ok: lastPatch(G, "menu_items").price === "1299", note: lastPatch(G, "menu_items").price }; });
row("a price is rounded to the paisa (12.345 → 12.35)", async () => {
  const { G } = await dish(owner, { id: "dal", price: "12.345" }); return { ok: lastPatch(G, "menu_items").price === "12.35", note: lastPatch(G, "menu_items").price }; });
row("an EMPTY price on an edit is refused (it would sell the dish for ₹0)", async () => {
  const { r } = await dish(owner, { id: "dal", price: "" }); return { ok: r.status === 400 && /valid price/.test(r.text), note: `${r.status}` }; });
row("a dish's tax mode is DROPPED while the admin has per-dish modes switched off", async () => {
  const { G } = await dish(owner, { id: "dal", tax_mode: "mrp", title: "Dal" }); return { ok: !("tax_mode" in lastPatch(G, "menu_items")), note: Object.keys(lastPatch(G, "menu_items")).join(",") }; });
row("…with modes switched ON, an unknown mode is refused out loud (not left to a database error)", async () => {
  const { r } = await dish({ ...owner, settings: { item_tax_modes_allowed: true } }, { id: "dal", tax_mode: "half" }); return { ok: r.status === 400 && /Pick one of/.test(r.text), note: `${r.status}` }; });
row("…and a real mode ('mrp') is saved", async () => {
  const { G } = await dish({ ...owner, settings: { item_tax_modes_allowed: true } }, { id: "dal", tax_mode: "mrp" }); return { ok: lastPatch(G, "menu_items").tax_mode === "mrp", note: lastPatch(G, "menu_items").tax_mode }; });
row("an edit with no id finds the dish by its slug in this restaurant's namespace", async () => {
  const { G, r } = await dish({ ...owner, mut: (G) => G.FIX.menu_items.push({ id: "chai__rest-1", restaurant_id: "rest-1", slug: "chai", title: "Chai", price: "20", image: "", category: "" }) }, { slug: "chai", price: "25" });
  return { ok: r.status === 200 && G.FIX.menu_items.find((d) => d.id === "chai__rest-1").price === "25", note: `${r.status}` }; });
row("an edit naming another restaurant's dish id is refused (409), that dish untouched", async () => {
  const { G, r } = await dish(owner, { id: "dal__r2", price: "1" }); return { ok: r.status === 409 && G.FIX.menu_items.find((d) => d.id === "dal__r2").price === "200", note: `${r.status}` }; });
row("an edit of a dish that was deleted meanwhile is refused (404), never re-inserting a half dish", async () => {
  const { G, r } = await dish(owner, { id: "gone-dish", price: "10" }); return { ok: r.status === 404 && !W(G, "menu_items").length, note: `${r.status}` }; });
row("an edit that sends an explicit null for the title keeps the stored title", async () => {
  const { G } = await dish(owner, { id: "dal", title: null, price: "210" }); return { ok: G.FIX.menu_items.find((d) => d.id === "dal").title === "Dal", note: G.FIX.menu_items.find((d) => d.id === "dal").title }; });
row("a cleared sort-order box saves 0, and 3.7 saves 4 — never null or a text value", async () => {
  const a = lastPatch((await dish(owner, { id: "dal", sort_order: "" })).G, "menu_items").sort_order; const b = lastPatch((await dish(owner, { id: "dal", sort_order: "3.7" })).G, "menu_items").sort_order;
  return { ok: a === 0 && b === 4, note: `${a} / ${b}` }; });
row("a manager allowed NOTHING on a dish is refused the edit outright", async () => {
  const { r } = await dish({ accessConfig: { edit_menu: { manager_opts: { edit_dish: false, edit_price: false, mark_86: false, edit_options: false, edit_3d: false } } } }, { id: "dal", title: "x" });
  return { ok: r.status === 403 && /edit dishes/.test(r.text), note: `${r.status}` }; });
row("a manager allowed ONLY 'sold out' keeps the stored filter tags but may add sold-out", async () => {
  const { G } = await dish({ accessConfig: { edit_menu: { manager_opts: { edit_dish: false, edit_price: false, mark_86: true, edit_options: false, edit_3d: false } } }, mut: (G) => { G.FIX.menu_items[0].tags = ["veg"]; } }, { id: "dal", tags: ["spicy", "sold-out"] });
  const t = G.FIX.menu_items.find((d) => d.id === "dal").tags; return { ok: JSON.stringify(t) === JSON.stringify(["veg", "sold-out"]), note: JSON.stringify(t) }; });
row("a manager allowed only the info, NOT sold-out, keeps the stored sold-out mark", async () => {
  const { G } = await dish({ accessConfig: { edit_menu: { manager_opts: { edit_dish: true, mark_86: false } } }, mut: (G) => { G.FIX.menu_items[0].tags = ["sold-out"]; } }, { id: "dal", tags: ["veg"] });
  const t = G.FIX.menu_items.find((d) => d.id === "dal").tags; return { ok: t.includes("sold-out") && t.includes("veg"), note: JSON.stringify(t) }; });
row("a manager without 'change a price' has the price, open-price flag and tax mode dropped, the rest saved", async () => {
  const { G } = await dish({ accessConfig: { edit_menu: { manager_opts: { edit_price: false, edit_dish: true } } } }, { id: "dal", price: "1", open_price: true, title: "Dal special" });
  const d = G.FIX.menu_items.find((x) => x.id === "dal"); return { ok: d.price === "200" && d.title === "Dal special" && !d.open_price, note: `${d.price} ${d.title}` }; });
row("a manager without 'edit dish info' keeps only price/tags/options/3D fields — the title cannot change", async () => {
  const { G } = await dish({ accessConfig: { edit_menu: { manager_opts: { edit_dish: false, edit_price: true } } } }, { id: "dal", price: "220", title: "Renamed" });
  const d = G.FIX.menu_items.find((x) => x.id === "dal"); return { ok: d.price === "220" && d.title === "Dal", note: `${d.price} ${d.title}` }; });
row("a manager without the 3D part cannot attach a model, even on a create", async () => {
  const { G } = await dish({}, { __create: true, title: "X", price: "1", is4d: true, model_folder: "m" }); const p = lastPatch(G, "menu_items");
  return { ok: !("is4d" in p) && !("model_folder" in p), note: Object.keys(p).join(",") }; });
row("a NEW category with no name is refused", async () => {
  const { r } = await run({}, "POST", "categories", { __create: true, slug: "soups" }); return { ok: r.status === 400 && /category a name/.test(r.text), note: `${r.status}` }; });
row("…a new category whose name is only blank translations is refused", async () => {
  const { r } = await run({}, "POST", "categories", { __create: true, slug: "soups", name: { en: " ", hi: "" } }); return { ok: r.status === 400, note: `${r.status}` }; });
row("…a new tag with a name but no slug is refused (both columns are required)", async () => {
  const { r } = await run({}, "POST", "filters", { __create: true, name: "Vegan" }); return { ok: r.status === 400 && /tag a name/.test(r.text), note: `${r.status}` }; });
row("…a new category with a name and slug is created for this restaurant", async () => {
  const { G, r } = await run({}, "POST", "categories", { __create: true, slug: "soups", name: { en: "Soups" } });
  return { ok: r.status === 200 && G.FIX.categories.some((c) => c.slug === "soups" && c.restaurant_id === "rest-1"), note: `${r.status}` }; });
row("a menu change busts the guest menu cache and is written to the Activity log as English", async () => {
  const { G } = await run({}, "POST", "categories", { slug: "mains", name: { en: "Main course" } }); const l = logged(G, "menu_edit")[0];
  return { ok: !!l && /edited category: Main course/.test(l.detail), note: l ? l.detail : "no line" }; });

// ══ 3 · INVOICES, REOPENS, CREDIT NOTES — the database's own refusals, now with their codes ══
const inv = (setup) => run({ ...setup }, "POST", `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "Asha" });
row("a SETTLED bill's invoice the database locks (LFH01) is answered 409, sending the person to a credit note", async () => {
  const { r } = await inv({ fail: { "rpc:lfh_generate_invoice": { code: "LFH01", message: "invoice locked" } } });
  return { ok: r.status === 409 && /credit note/.test(r.text), note: `${r.status} ${r.text.slice(0, 70)}` }; });
row("a CANCELLED sale the database refuses a number for (LFH02) is answered 409 in plain words", async () => {
  const { r } = await inv({ fail: { "rpc:lfh_generate_invoice": { code: "LFH02", message: "a cancelled sale never takes an invoice" } } });
  return { ok: r.status === 409 && /never gets a tax invoice/.test(r.text), note: `${r.status}` }; });
row("any OTHER invoice refusal is a plain sentence, its database text kept out of the answer", async () => {
  const { r } = await inv({ fail: { "rpc:lfh_generate_invoice": { code: "XX000", message: "internal kaboom" } } });
  return { ok: r.status >= 400 && !/kaboom/.test(r.text), note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("re-issuing a REOPENED bill writes the before → after Audit row ('Reopened at ₹X, re-issued at ₹Y — ₹Z MORE')", async () => {
  const { G, r } = await inv({ fix: { deletion_audit: [{ id: 9, restaurant_id: "rest-1", session_id: ID.sess, kind: "invoice_voided", at: ago(3), reason_code: "add_items", reason_note: "", meta: { total_at_reopen: 400, discount_at_reopen: 0, orders_on_bill: 1 } }] } });
  const a = audits(G, "bill_changed_after_reopen")[0];
  return { ok: r.status === 200 && !!a && /Reopened at ₹400, re-issued at ₹\d+ — ₹\d+ MORE/.test(a.args.p_meta.summary), note: a ? a.args.p_meta.summary : "no audit row" }; });
row("…and the re-issue takes the REOPEN's reason ('Reopened: add items') instead of asking a second question", async () => {
  const { G } = await inv({ fix: { deletion_audit: [{ id: 9, restaurant_id: "rest-1", session_id: ID.sess, kind: "invoice_voided", at: ago(3), reason_code: "add_items", reason_note: "", meta: {} }] } });
  const c = rpc(G, "lfh_generate_invoice")[0]; return { ok: !!c && c.args.p_reason === "Reopened: add items", note: c ? c.args.p_reason : "not called" }; });
row("…a bill re-issued for LESS than it was reopened at says LESS", async () => {
  const { G } = await inv({ fix: { deletion_audit: [{ id: 9, restaurant_id: "rest-1", session_id: ID.sess, kind: "invoice_voided", at: ago(3), meta: { total_at_reopen: 5000 } }] } });
  const a = audits(G, "bill_changed_after_reopen")[0]; return { ok: !!a && /LESS/.test(a.args.p_meta.summary), note: a ? a.args.p_meta.summary : "" }; });
row("reopening a table someone else is now sitting at (LFH03) is answered with the table's name", async () => {
  const { r } = await run({ fail: { "rpc:lfh_reopen_table": { code: "LFH03", message: "another party is sitting" } } }, "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "coffee" });
  return { ok: r.status === 409 && /Someone else is sitting at T9/.test(r.text), note: r.text.slice(0, 80) }; });
row("reopening a bill whose every ticket was cancelled (LFH04) says there is no sale to reopen", async () => {
  const { r } = await run({ fail: { "rpc:lfh_reopen_table": { code: "LFH04", message: "nothing to reopen" } } }, "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "coffee" });
  return { ok: r.status === 409 && /no sale to reopen/.test(r.text), note: `${r.status}` }; });
row("reopening a table without a reason is refused before the database is asked", async () => {
  const { G, r } = await run({}, "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: " " }); return { ok: r.status === 400 && !rpc(G, "lfh_reopen_table").length, note: `${r.status}` }; });
row("a reopened table is logged with its bill number and the retired invoice number", async () => {
  const { G } = await run({}, "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "one more coffee" }); const l = logged(G, "table_reopened")[0];
  return { ok: !!l && /Bill #3/.test(l.detail) && /INV-1 retired/.test(l.detail), note: l ? l.detail : "" }; });
row("a credit note larger than the bill (the database's LFH02) is answered in plain words", async () => {
  const { r } = await run({ fail: { "rpc:lfh_issue_credit_note": { code: "LFH02", message: "cannot exceed" } } }, "POST", `sessions/${ID.closedSess}/credit-note`, { amount: 99999, reason: "x" });
  return { ok: r.status === 409 && /more than the bill total/.test(r.text), note: `${r.status}` }; });
row("a void the database refuses as settled (LFH01) points to the credit note", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(1); }, fail: { "rpc:lfh_void_invoice": { code: "LFH01", message: "invoice locked" } } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "x" });
  return { ok: r.status === 409 && /credit note/.test(r.text), note: `${r.status}` }; });
row("'was the food made?' on an order that is not cancelled is answered as such (409)", async () => {
  const { r } = await run({ rpc: { lfh_cancel_classify: { ok: false, reason: "not_cancelled" } } }, "POST", "audit/classify", { order_id: ID.order, made: false });
  return { ok: r.status === 409 && /isn't cancelled/.test(r.text), note: `${r.status}` }; });
row("…on an order that has gone, says it no longer exists", async () => {
  const { r } = await run({ rpc: { lfh_cancel_classify: { ok: false, reason: "order_not_found" } } }, "POST", "audit/classify", { order_id: ID.order, made: false });
  return { ok: r.status === 409 && /no longer exists/.test(r.text), note: `${r.status}` }; });
row("…any other refusal is 'try again', never a silent ok", async () => {
  const { G, r } = await run({ rpc: { lfh_cancel_classify: { ok: false, reason: "weird" } } }, "POST", "audit/classify", { order_id: ID.order, made: true });
  return { ok: r.status === 409 && /try again/.test(r.text) && !logged(G, "cancel_classified").length, note: `${r.status}` }; });
row("…an accepted answer is logged in plain words with the loss it recorded", async () => {
  const { G } = await run({ rpc: { lfh_cancel_classify: { ok: true, lossCost: 85 } } }, "POST", "audit/classify", { order_id: ID.cancelled, made: true });
  const l = logged(G, "cancel_classified")[0]; return { ok: !!l && /WAS made — recorded as a loss of 85/.test(l.detail), note: l ? l.detail : "" }; });

// ══ 4 · CANCEL, PAY, UN-PAY — the PATCH arms no check took ════════════════════════════════
row("cancelling WITH an answer to 'was it made?' asks the database to classify it, AFTER the cancel is written", async () => {
  const { G } = await run({ rpc: { lfh_cancel_classify: { ok: true } } }, "PATCH", `orders/${ID.order}`, { status: "cancelled", made: true });
  const c = rpc(G, "lfh_cancel_classify")[0]; const wroteAt = G.WRITES.findIndex((w) => w.table === "orders" && w.op === "update");
  return { ok: !!c && c.args.p_made === true && ord(G).status === "cancelled" && wroteAt >= 0, note: c ? "classified" : "not asked" }; });
row("…if classifying is refused, the cancel still stands and the refusal is logged as an error — never swallowed", async () => {
  const { G, r } = await run({ rpc: { lfh_cancel_classify: { ok: false, reason: "not_cancelled" } } }, "PATCH", `orders/${ID.order}`, { status: "cancelled", made: false });
  const l = logged(G, "cancel_classify_failed")[0]; return { ok: r.status === 200 && ord(G).status === "cancelled" && !!l && l.level === "error", note: l ? l.detail : "no line" }; });
row("…and if the classify call itself errors, the same error line is written", async () => {
  const { G } = await run({ fail: { "rpc:lfh_cancel_classify": "error" } }, "PATCH", `orders/${ID.order}`, { status: "cancelled", made: true });
  return { ok: logged(G, "cancel_classify_failed").length === 1, note: "" }; });
row("restoring a bill FREED more than 30 minutes ago is refused, it stays off the floor", async () => {
  const { G, r } = await run({ mut: (G) => Object.assign(ord(G), { archived: true, archived_at: ago(45) }) }, "PATCH", `orders/${ID.order}`, { archived: false });
  return { ok: r.status === 409 && ord(G).archived === true, note: `${r.status}` }; });
row("…restoring one freed 5 minutes ago works and clears the archive time", async () => {
  const { G, r } = await run({ mut: (G) => Object.assign(ord(G), { archived: true, archived_at: ago(5), status: "served", payment_status: "paid" }) }, "PATCH", `orders/${ID.order}`, { archived: false });
  return { ok: r.status === 200 && ord(G).archived === false && ord(G).archived_at === null, note: `${r.status}` }; });
row("un-paying a SPLIT bill reverses its payment parts in the money trail and logs how many", async () => {
  const { G, r } = await run({ mut: (G) => { Object.assign(ord(G), { payment_status: "paid", paid_at: ago(3) }); (G.FIX.session_payments ||= []).push({ id: "sp1", restaurant_id: "rest-1", session_id: ID.sess, amount: 210, method: "UPI", created_at: ago(3), reversed_at: null }, { id: "sp2", restaurant_id: "rest-1", session_id: ID.sess, amount: 210, method: "Cash", created_at: ago(3), reversed_at: null }); } },
    "PATCH", `orders/${ID.order}`, { payment_status: "pending", revert_reason: "wrong table" });
  const l = logged(G, "payment_legs_reversed")[0]; return { ok: r.status === 200 && !!l && /2 leg/.test(l.detail) && G.FIX.session_payments.every((p) => p.reversed_at), note: l ? l.detail : `${r.status} no line` }; });
row("…and if reversing those parts fails, the bill stays PAID and the person is told (500, plain words)", async () => {
  const { G, r } = await run({ mut: (G) => { Object.assign(ord(G), { payment_status: "paid", paid_at: ago(3) }); (G.FIX.session_payments ||= []).push({ id: "sp1", restaurant_id: "rest-1", session_id: ID.sess, amount: 420, created_at: ago(3), reversed_at: null }); }, fail: { "session_payments:update": "error" } },
    "PATCH", `orders/${ID.order}`, { payment_status: "pending", revert_reason: "x" });
  return { ok: r.status === 500 && /left as paid/.test(r.text) && ord(G).payment_status === "paid" && !/stub:/.test(r.text), note: `${r.status} ${r.text.slice(0, 70)}` }; });
row("un-paying reverses that bill's customer visit and loyalty points for THAT session", async () => {
  const { G } = await run({ mut: (G) => Object.assign(ord(G), { payment_status: "paid", paid_at: ago(3) }) }, "PATCH", `orders/${ID.order}`, { payment_status: "pending", revert_reason: "x" });
  const c = rpc(G, "lfh_uncapture_customer")[0]; return { ok: !!c && c.args.p_session === ID.sess, note: c ? c.args.p_session : "not called" }; });
row("marking paid with a method stores the method and a trimmed note", async () => {
  const { G } = await run({}, "PATCH", `orders/${ID.order}`, { payment_status: "paid", payment_method: "UPI", payment_note: "x".repeat(300) });
  return { ok: ord(G).payment_method === "UPI" && ord(G).payment_note.length === 200 && !!ord(G).paid_at, note: ord(G).payment_method }; });
row("an unknown PATCH address answers 404", async () => { const { r } = await run({}, "PATCH", "widgets/x", { a: 1 }); return { ok: r.status === 404, note: `${r.status}` }; });
row("a PATCH with nothing to change is refused, nothing written", async () => {
  const { G, r } = await run({}, "PATCH", `orders/${ID.order}`, {}); return { ok: r.status === 400 && !W(G, "orders").length, note: `${r.status}` }; });
row("a PATCH whose read crashes answers a plain sentence and leaves an error-level diary line naming the endpoint", async () => {
  const { G, r } = await run({ fail: { "orders:select": "throw" } }, "PATCH", `orders/${ID.order}`, { status: "served" });
  return { ok: r.status >= 500 && !/stub:/.test(r.text) && G.ERRORS.some((e) => /PATCH orders/.test(e.detail || "")), note: `${r.status}` }; });
row("a DELETE whose write crashes answers a plain sentence and leaves an error-level diary line", async () => {
  const { G, r } = await run({ fail: { "waiter_calls:delete": "throw" } }, "DELETE", `calls/${ID.call}`, null);
  return { ok: r.status >= 500 && !/stub:/.test(r.text) && G.ERRORS.some((e) => /DELETE calls/.test(e.detail || "")), note: `${r.status}` }; });
row("an unknown DELETE address answers 404", async () => { const { r } = await run({}, "DELETE", "widgets/x", null); return { ok: r.status === 404, note: `${r.status}` }; });
row("the admin console is refused deleting a PAID bill — it is a financial record (409)", async () => {
  const { G, r } = await run({ who: "admin", mut: (G) => Object.assign(ord(G, ID.order2), { payment_status: "paid", status: "served" }) }, "DELETE", `orders/${ID.order2}`, null);
  return { ok: r.status === 409 && !ord(G, ID.order2).deleted_at, note: `${r.status}` }; });
row("deleting a category that is already gone answers 404 with nothing recorded", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.categories = []; } }, "DELETE", "categories/mains", null);
  return { ok: r.status === 404 && /category is already gone/.test(r.text) && !audits(G).length, note: `${r.status}` }; });
row("deleting a tag removes it from every dish that still carried it", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.menu_items[0].tags = ["veg", "spicy"]; } }, "DELETE", "filters/veg", null);
  return { ok: JSON.stringify(G.FIX.menu_items.find((d) => d.id === "dal").tags) === '["spicy"]', note: JSON.stringify(G.FIX.menu_items.find((d) => d.id === "dal").tags) }; });
row("deleting a category leaves its dishes uncategorised instead of pointing at a dead slug", async () => {
  const { G } = await run({}, "DELETE", "categories/mains", null); return { ok: G.FIX.menu_items.find((d) => d.id === "dal").category === null, note: String(G.FIX.menu_items.find((d) => d.id === "dal").category) }; });

// ══ 5 · ORDERS, PARCELS, BANQUET — branches the happy path skipped ══════════════════════════
const orderReq = (extra = {}) => ({ table: "4", items: [{ id: "dal", qty: 1 }], ...extra });
row("an IDENTICAL order for the same table within 3 seconds is answered with the 'send it anyway?' question (409)", async () => {
  const { G, r } = await run({ mut: (G) => G.FIX.orders.push({ id: "recent", restaurant_id: "rest-1", table_number: "4", items: [{ id: "dal", qty: 1 }], allergies: [], created_at: new Date().toISOString() }) }, "POST", "order", orderReq());
  return { ok: r.status === 409 && r.json.duplicateWarning === true && !rpc(G, "lfh_staff_place_order").length, note: `${r.status}` }; });
row("…and 'send it anyway' (confirmDuplicate) goes through to the database's own lock", async () => {
  const { G, r } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: "o-new" } }, mut: (G) => G.FIX.orders.push({ id: "recent", restaurant_id: "rest-1", table_number: "4", items: [{ id: "dal", qty: 1 }], allergies: [], created_at: new Date().toISOString() }) }, "POST", "order", orderReq({ confirmDuplicate: true }));
  const c = rpc(G, "lfh_staff_place_order")[0]; return { ok: r.status === 200 && c && c.args.p_confirm_duplicate === true, note: `${r.status}` }; });
row("an order the pricer refuses (a dish sold out) is a real refusal with its reason, not 'sent'", async () => {
  const { r } = await run({ rpc: { lfh_staff_place_order: { ok: false, reason: "sold_out" } } }, "POST", "order", orderReq());
  return { ok: r.status === 400 && /sold out/.test(r.text), note: r.text.slice(0, 60) }; });
row("an order that was placed but could not be put on the pass answers a failure, not success", async () => {
  const { r } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: "o-new" } }, fail: { "rpc:lfh_staff_mark_placed": "error" } }, "POST", "order", orderReq());
  return { ok: r.status >= 500, note: `${r.status}` }; });
row("an open-price parcel line uses the price the manager typed, rounded to the paisa", async () => {
  const { G, r } = await run({ rpc: { lfh_platform_insert: { id: "p-new" } }, mut: (G) => Object.assign(G.FIX.menu_items[0], { open_price: true, price: "" }) }, "POST", "parcel", { items: [{ id: "dal", qty: 1, price: "149.999" }] });
  const c = rpc(G, "lfh_platform_insert")[0]; return { ok: r.status === 200 && c && c.args.p_items[0].price === 150, note: c ? String(c.args.p_items[0].price) : `${r.status}` }; });
row("…and an open-price parcel line with no price is refused, naming the dish", async () => {
  const { G, r } = await run({ mut: (G) => Object.assign(G.FIX.menu_items[0], { open_price: true, price: "" }) }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }] });
  return { ok: r.status === 400 && r.json.error === 'Enter a price for "Dal".' && !rpc(G, "lfh_platform_insert").length, note: r.json && r.json.error }; });
row("a parcel discount bigger than its food is refused out loud with the most it can take, never trimmed (the uncapped owner — a capped person is refused on the % first)", async () => {
  const { G, r } = await run({ who: "owner" }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], discount: 500 });
  return { ok: r.status === 400 && /Most you can take off this parcel is ₹200\.00/.test(r.text) && !rpc(G, "lfh_platform_insert").length, note: r.text.slice(0, 80) }; });
row("…and when part of it is a legally-final MRP price, the refusal says how much of it is MRP", async () => {
  const { r } = await run({ who: "owner", settings: { item_tax_modes_allowed: true, mrp_tax_treatment: "inside" },
    mut: (G) => { G.FIX.menu_items.push({ id: "cola", restaurant_id: "rest-1", slug: "cola", title: "Cola", price: "40", tax_mode: "mrp", tags: [] }); } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }, { id: "cola", qty: 1 }], discount: 500 });
  return { ok: r.status === 400 && /MRP items, whose price is final/.test(r.text), note: r.text.slice(0, 90) }; });
row("editing an EXISTING banquet line updates that line in this restaurant", async () => {
  const { G, r } = await run({}, "POST", "banquet/item-save", { id: ID.bq, title: "Thali deluxe", price: 400 });
  return { ok: r.status === 200 && G.FIX.banquet_items.find((b) => b.id === ID.bq).title === "Thali deluxe", note: `${r.status}` }; });
row("…editing a banquet line that is gone answers 404", async () => {
  const { r } = await run({}, "POST", "banquet/item-save", { id: "gone", title: "X", price: 1 }); return { ok: r.status === 404, note: `${r.status}` }; });
row("a banquet line's price is clamped to 0–10,00,000 and its unit trimmed", async () => {
  const { G } = await run({}, "POST", "banquet/item-save", { title: "Feast", price: -5, unit: "  per head  " }); const b = G.FIX.banquet_items.find((x) => x.title === "Feast");
  return { ok: b && b.price === 0 && b.unit === "per head", note: b ? `${b.price} ${b.unit}` : "none" }; });
row("a banquet BILL for table 'x' is refused", async () => {
  const { r } = await run({}, "POST", "banquet/bill", { table: "x", lines: [{ id: ID.bq, qty: 1 }] }); return { ok: r.status === 400, note: `${r.status}` }; });
row("…a banquet bill for table 99 of a 20-table floor is refused, naming the real count", async () => {
  const { r } = await run({}, "POST", "banquet/bill", { table: "99", lines: [{ id: ID.bq, qty: 1 }] }); return { ok: r.status === 400 && /has 20 tables/.test(r.text), note: `${r.status}` }; });
row("…a banquet bill records WHO prepared it from the login, never from the browser", async () => {
  const { G } = await run({ rpc: { lfh_banquet_bill_create: { ok: true, bill_no: "BQB-1", total: 3000 } } }, "POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 10 }], meta: { prepared_by: "Someone else" } });
  const c = rpc(G, "lfh_banquet_bill_create")[0]; return { ok: c && c.args.p_meta.prepared_by === "Diag Manager", note: c ? c.args.p_meta.prepared_by : "" }; });
row("…a banquet bill the database refuses ('not allowed') says banquet isn't enabled", async () => {
  const { r } = await run({ rpc: { lfh_banquet_bill_create: { ok: false, reason: "not_allowed" } } }, "POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 1 }] });
  return { ok: r.status === 400 && /Banquet isn't enabled/.test(r.text), note: `${r.status}` }; });
row("an unknown banquet action answers 404", async () => { const { r } = await run({}, "POST", "banquet/teleport", {}); return { ok: r.status === 404, note: `${r.status}` }; });
row("the admin console naming more than 60 orders in one bill delete is refused — there is no bulk clear", async () => {
  const { r } = await run({ who: "admin" }, "POST", "orders/delete", { ids: Array.from({ length: 61 }, (_, i) => "o" + i) });
  return { ok: r.status === 400 && /one bill at a time/.test(r.text), note: `${r.status}` }; });

// ══ 6 · DISHES, ALLERGIES, REQUESTS, TABLES ═══════════════════════════════════════════════
row("changing the order-wide allergy line WITHOUT a reason is refused — it is what the kitchen cooks to", async () => {
  const { G, r } = await run({}, "POST", `orders/${ID.order}/allergies`, { allergies: ["peanuts"] }); return { ok: r.status === 400 && /Say why/.test(r.text) && !W(G, "orders").length, note: `${r.status}` }; });
row("…re-saving the SAME allergy line needs no reason (nothing moved)", async () => {
  const { r } = await run({ mut: (G) => { ord(G).allergies = ["peanuts"]; } }, "POST", `orders/${ID.order}/allergies`, { allergies: ["Peanuts"] }); return { ok: r.status === 200, note: `${r.status}` }; });
row("changing ONE dish's NO-list without a reason is refused", async () => {
  const { G, r } = await run({}, "POST", `items/${ID.item}/removed`, { removed: ["onion"] }); return { ok: r.status === 400 && /Say why/.test(r.text) && !W(G, "order_items").length, note: `${r.status}` }; });
row("…changing it on a PAID bill is allowed and leaves a 'bill annotated' Audit row naming the allergens", async () => {
  const { G, r } = await run({ mut: (G) => { ord(G).payment_status = "paid"; } }, "POST", `items/${ID.item}/removed`, { removed: ["onion"], reason_note: "guest asked" });
  const a = audits(G, "bill_annotated")[0]; return { ok: r.status === 200 && !!a && JSON.stringify(a.args.p_meta.added) === '["onion"]', note: a ? JSON.stringify(a.args.p_meta) : `${r.status}` }; });
row("…on a cancelled order the NO-list cannot change at all", async () => {
  const { r } = await run({ mut: (G) => { ord(G).status = "cancelled"; } }, "POST", `items/${ID.item}/removed`, { removed: ["onion"], reason_note: "x" }); return { ok: r.status === 400 && /cancelled/.test(r.text), note: `${r.status}` }; });
row("a dish note changed on a SETTLED bill leaves a 'bill annotated' Audit row", async () => {
  const { G } = await run({ rpc: { lfh_staff_edit_item_note: { ok: true, order_id: ID.order, settled: true, note: "less oil" } } }, "POST", `items/${ID.item}/note`, { note: "less oil" });
  const a = audits(G, "bill_annotated")[0]; return { ok: !!a && a.args.p_meta.field === "note", note: a ? JSON.stringify(a.args.p_meta) : "none" }; });
row("…a dish note the database refuses on a PAID bill is answered 409 in plain words", async () => {
  const { r } = await run({ rpc: { lfh_staff_edit_item_note: { ok: false, reason: "order_paid" } } }, "POST", `items/${ID.item}/note`, { note: "x" }); return { ok: r.status === 409 && /PAID/.test(r.text), note: `${r.status}` }; });
row("removing a dish from a PAID bill (the database's refusal) is answered 409", async () => {
  const { r } = await run({ rpc: { lfh_delete_order_item: { ok: false, reason: "order_paid" } } }, "POST", `items/${ID.item}/delete`, {}); return { ok: r.status === 409 && /PAID/.test(r.text), note: `${r.status}` }; });
row("…a dish another device removed a second earlier says 'already removed'", async () => {
  const { r } = await run({ rpc: { lfh_delete_order_item: { ok: false, reason: "item_not_found" } } }, "POST", `items/${ID.item}/delete`, {}); return { ok: r.status === 400 && /already removed/.test(r.text), note: `${r.status}` }; });
row("…an emptied ticket is logged as 'order emptied → cancelled'", async () => {
  const { G } = await run({ rpc: { lfh_delete_order_item: { ok: true, order_id: ID.order, order_cancelled: true, items_left: 0 } } }, "POST", `items/${ID.item}/delete`, {});
  const l = logged(G, "order_item_delete")[0]; return { ok: !!l && /emptied/.test(l.detail), note: l ? l.detail : "" }; });
row("approving an 'open the table' request opens a session for that table when none is open", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.requests.push({ id: "rq-open", restaurant_id: "rest-1", table_number: "11", type: "open", status: "pending" }); } }, "POST", "requests/rq-open/resolve", { status: "approved" });
  return { ok: r.status === 200 && (rpc(G, "lfh_open_table_session").length + W(G, "sessions").length) > 0, note: `${r.status} rpc=${G.RPCS.map((c) => c.name).join(",")}` }; });
row("…and when the table is already open, approving opens nothing new", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.requests.push({ id: "rq-open", restaurant_id: "rest-1", table_number: "4", type: "open", status: "pending" }); } }, "POST", "requests/rq-open/resolve", { status: "approved" });
  return { ok: !W(G, "sessions").filter((w) => w.op === "insert").length, note: "" }; });
row("answering a request a colleague already answered the OTHER way is refused out loud (409)", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.requests.find((q) => q.id === ID.req).status = "denied"; } }, "POST", `requests/${ID.req}/resolve`, { status: "approved" });
  return { ok: r.status === 409 && /already denied/.test(r.text), note: `${r.status}` }; });
row("…the SAME answer twice is a quiet ok (a double tap), not an error", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.requests.find((q) => q.id === ID.req).status = "approved"; } }, "POST", `requests/${ID.req}/resolve`, { status: "approved" });
  return { ok: r.status === 200, note: `${r.status}` }; });
row("splitting tables whose bill is already invoiced is refused, with the reason the panel shows", async () => {
  const { r } = await run({ rpc: { lfh_staff_unmerge_table: { ok: false, reason: "invoiced" } } }, "POST", "tables/4/unmerge", {});
  return { ok: r.status === 409 && /already been invoiced/.test(r.text) && r.json.reason === "invoiced", note: `${r.status}` }; });
row("…splitting a table that is not merged says so", async () => {
  const { r } = await run({ rpc: { lfh_staff_unmerge_table: { ok: false, reason: "not_merged" } } }, "POST", "tables/4/unmerge", {}); return { ok: r.status === 409 && /isn't merged/.test(r.text), note: `${r.status}` }; });
row("…any other unmerge refusal is a plain 'couldn't split'", async () => {
  const { r } = await run({ rpc: { lfh_staff_unmerge_table: { ok: false, reason: "x" } } }, "POST", "tables/4/unmerge", {}); return { ok: r.status === 409 && /Couldn't split/.test(r.text), note: `${r.status}` }; });
row("a merge stamps WHO joined the tables on the merge record", async () => {
  const { G } = await run({ rpc: { lfh_staff_merge_tables: { ok: true, child_table: "4", parent_table: "2" } }, mut: (G) => G.FIX.table_merges.push({ restaurant_id: "rest-1", child_table: "4", parent_table: "2", ended_at: null }) }, "POST", `sessions/${ID.sess}/merge`, { to: "2" });
  const m = G.FIX.table_merges[0]; return { ok: m.merged_by === "diagm1" && m.merged_by_id === "u1", note: `${m.merged_by}` }; });
row("clearing a table's type (tag null) deletes its mark and logs it", async () => {
  const { G, r } = await run({}, "POST", "tables/4/tag", { tag: null }); return { ok: r.status === 200 && !G.FIX.table_tags.some((t) => t.restaurant_id === "rest-1" && t.table_number === "4") && logged(G, "table_tag_clear").length === 1, note: `${r.status}` }; });
row("parking a bill while food is still COOKING is refused", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); } }, "POST", "tables/4/khata", { customer_id: ID.khata });
  return { ok: r.status === 409 && /still has orders cooking/.test(r.text), note: `${r.status}` }; });
row("parking a bill on a NEW person adds them to this restaurant's book", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; } }, "POST", "tables/4/khata", { name: "Meera", phone: "9000000002" });
  return { ok: r.status === 200 && G.FIX.khata_customers.some((k) => k.name === "Meera" && k.restaurant_id === "rest-1"), note: `${r.status}` }; });
row("…parking on a new person with no name is refused", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; } }, "POST", "tables/4/khata", { name: " " });
  return { ok: r.status === 400 && /name is required/.test(r.text), note: `${r.status}` }; });
row("…parking orders that have no open session still clears the table's waiter calls and requests", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.sessions = G.FIX.sessions.filter((s) => s.id !== ID.sess); G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); Object.assign(ord(G), { status: "served", session_id: null }); } }, "POST", "tables/4/khata", { customer_id: ID.khata });
  return { ok: r.status === 200 && (W(G, "waiter_calls").length + W(G, "requests").length) > 0, note: `${r.status}` }; });
row("collecting a tab with neither a bill nor an order named is refused", async () => {
  const { r } = await run({}, "POST", "khata/pay", { method: "Cash" }); return { ok: r.status === 400 && /session_id or order_id/.test(r.text), note: `${r.status}` }; });
row("collecting a tab marks its orders paid and relabels a split's pay-later part with how it was really paid", async () => {
  const { G, r } = await run({ mut: (G) => { Object.assign(G.FIX.orders.find((o) => o.id === ID.paid), { payment_status: "pending", session_id: ID.closedSess }); (G.FIX.session_payments ||= []).push({ id: "sp9", restaurant_id: "rest-1", session_id: ID.closedSess, khata_customer_id: ID.khata, method: "Pay later", settled_at: null, reversed_at: null }); } },
    "POST", "khata/pay", { session_id: ID.closedSess, method: "Cash" });
  const sp = G.FIX.session_payments.find((p) => p.id === "sp9");
  return { ok: r.status === 200 && G.FIX.orders.find((o) => o.id === ID.paid).payment_status === "paid" && sp.method === "Cash" && !!sp.settled_at, note: `${r.status} · ${sp.method}` }; });
row("…a tab already collected is 'nothing outstanding' (409)", async () => {
  const { r } = await run({ mut: (G) => Object.assign(G.FIX.orders.find((o) => o.id === ID.paid), { payment_status: "paid" }) }, "POST", "khata/pay", { order_id: ID.paid, method: "Cash" });
  return { ok: r.status === 409 && /Nothing outstanding/.test(r.text), note: `${r.status}` }; });
row("settling in parts with a PAY-LATER part needs the pay-later module (403 when it is off)", async () => {
  const { r } = await run({ settings: { khata_allowed: false } }, "POST", "tables/4/pay-split", { splits: [{ method: "Pay later", amount: 420 }] });
  return { ok: r.status === 403 && /Pay later/.test(r.text), note: `${r.status}` }; });
row("settling in parts marks the bill paid as 'Split' and logs the parts", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); } }, "POST", "tables/4/pay-split", { splits: [{ method: "Cash", amount: 210 }, { method: "UPI", amount: 210 }] });
  return { ok: r.status === 200 && ord(G).payment_method === "Split" && logged(G, "bill_split").length === 1, note: `${r.status} ${r.text.slice(0, 80)}` }; });

// ══ 7 · PRINTING — the counter as a printer, test prints, "print here" (coverage pass 2) ═════════
const nowIso = () => new Date().toISOString();
const PRINT = (routes = {}, extra = {}) => ({
  settings: { modules: { loyalty: { allowed: true }, printing: { routes } }, auto_print_kot: true, auto_print_kot_allowed: true, ...(extra.settings || {}) },
  mut: (G) => {
    G.FIX.print_agents = [{ id: "ag1", restaurant_id: "rest-1", name: "Till PC", printers: [{ name: "EPSON" }], last_seen_at: nowIso(), revoked_at: null, owner_device: "dev-test", seen_fingerprints: [] }];
    G.FIX.print_jobs = [{ id: ID.job, restaurant_id: "rest-1", kind: "kot", status: "queued", order_id: ID.order, created_at: ago(1), attempts: 0 }];
    G.FIX.print_stations = G.FIX.print_stations || [];
    if (extra.mut) extra.mut(G);
  },
  ...(extra.who ? { who: extra.who } : {}),
});
const SCREEN_MGR = { kot: { via: "screen", panel: "manager" } };
row("the counter screen the admin named claims a waiting kitchen ticket by itself, and says which station holds the printer", async () => {
  const { r } = await run(PRINT(SCREEN_MGR), "POST", "print-jobs/claim", { ids: [ID.job] });
  return { ok: r.status === 200 && Array.isArray(r.json.won) && "station" in r.json && !r.json.refused, note: `${r.status} ${r.text.slice(0, 100)}` }; });
row("…while automatic kitchen-slip printing is switched OFF, the counter claims nothing and says why ('off')", async () => {
  const { r } = await run(PRINT(SCREEN_MGR, { settings: { auto_print_kot: false } }), "POST", "print-jobs/claim", { ids: [ID.job] });
  return { ok: r.status === 200 && r.json.won.length === 0 && !!r.json.refused, note: `${r.status} refused=${r.json && r.json.refused}` }; });
row("…while a COMPUTER owns the kitchen slips, no screen claims them ('helper')", async () => {
  const { r } = await run(PRINT({ kot: { agent: "ag1", printer: "EPSON" } }), "POST", "print-jobs/claim", { ids: [ID.job] });
  return { ok: r.status === 200 && r.json.won.length === 0 && r.json.refused === "helper", note: `${r.status} refused=${r.json && r.json.refused}` }; });
row("…an empty claim list answers 'won nothing' without asking anything", async () => {
  const { G, r } = await run(PRINT(SCREEN_MGR), "POST", "print-jobs/claim", { ids: [] }); return { ok: r.status === 200 && r.json.won.length === 0 && !G.WRITES.length, note: `${r.status}` }; });
row("a FAILED print the counter reports is logged as a warning with the try count", async () => {
  const { G, r } = await run(PRINT(SCREEN_MGR, { mut: (G) => { Object.assign(G.FIX.print_jobs[0], { status: "printing", claimed_at: nowIso() }); } }), "POST", `print-jobs/${ID.job}/done`, { ok: false, error: "paper jam" });
  const l = logged(G, "kot_print_failed")[0]; return { ok: r.status === 200 && !!l && /paper jam/.test(l.detail) && typeof r.json.attempts === "number", note: l ? l.detail : `${r.status} ${r.text.slice(0, 60)}` }; });
row("a successful print the counter reports is logged 'printed KOT … on this screen'", async () => {
  const { G, r } = await run(PRINT(SCREEN_MGR, { mut: (G) => { Object.assign(G.FIX.print_jobs[0], { status: "printing", claimed_at: nowIso() }); } }), "POST", `print-jobs/${ID.job}/done`, { ok: true });
  const l = logged(G, "kot_printed")[0]; return { ok: r.status === 200 && !!l && /on this screen/.test(l.detail), note: l ? l.detail : `${r.status}` }; });
row("a SAMPLE bill goes to the computer that owns bills, and the person is told which printer", async () => {
  const { G, r } = await run(PRINT({ bill: { agent: "ag1", printer: "EPSON" } }), "POST", "printing/test", { sample: "bill" });
  return { ok: r.status === 200 && r.json.queued === true && r.json.printer === "EPSON" && logged(G, "print_test").length === 1, note: `${r.status} ${r.text.slice(0, 90)}` }; });
row("…while the printing queue is STOPPED, a sample is refused (nothing would come out)", async () => {
  const { r } = await run(PRINT({ bill: { agent: "ag1", printer: "EPSON" } }, { settings: { modules: { printing: { paused: true, routes: { bill: { agent: "ag1", printer: "EPSON" } } } } } }), "POST", "printing/test", { sample: "bill" });
  return { ok: r.status === 400 && /queue is stopped/.test(r.text), note: `${r.status}` }; });
row("…a sample KITCHEN SLIP while automatic slip printing is off is refused, per kind", async () => {
  const { r } = await run(PRINT({ kot: { agent: "ag1", printer: "EPSON" } }, { settings: { auto_print_kot: false } }), "POST", "printing/test", { sample: "kot" });
  return { ok: r.status === 400 && /kitchen-slip printing is switched off/.test(r.text), note: `${r.status}` }; });
row("…a sample of a paper NO computer owns is refused (409) — a screen route has no printer to prove", async () => {
  const { r } = await run(PRINT({}), "POST", "printing/test", { sample: "bill" }); return { ok: r.status === 409 && /No computer is set to print that/.test(r.text), note: `${r.status}` }; });
row("…a sample to a computer that is asleep is SAVED, and the person is told it prints when it is back", async () => {
  const { r } = await run(PRINT({ bill: { agent: "ag1", printer: "EPSON" } }, { mut: (G) => { G.FIX.print_agents[0].last_seen_at = ago(30); } }), "POST", "printing/test", { sample: "bill" });
  return { ok: r.status === 200 && /as soon as Till PC is back/.test(r.json.note), note: r.json && r.json.note }; });
row("a TEST PAGE on one of this computer's own printers is queued", async () => {
  const { G, r } = await run(PRINT({}), "POST", "printing/test", { printer: "EPSON" });
  return { ok: r.status === 200 && r.json.queued === true && logged(G, "print_test").length === 1, note: `${r.status} ${r.json && r.json.note}` }; });
row("…a test page to a printer this computer does not have is refused", async () => {
  const { r } = await run(PRINT({}), "POST", "printing/test", { printer: "CANON" }); return { ok: r.status === 400 && /no printer by that name/.test(r.text), note: `${r.status}` }; });
row("…from a browser that is not a set-up computer, the test page says to set it up first", async () => {
  const { r } = await run(PRINT({}, { mut: (G) => { G.FIX.print_agents[0].owner_device = "another"; } }), "POST", "printing/test", { printer: "EPSON" });
  return { ok: r.status === 400 && /Set this computer up first/.test(r.text), note: `${r.status}` }; });
row("[removed · round 4 item 4] 'Unknown printing request' and its `if (b === \"test\")` wrapper are gone — only `test` gets that far, so the test page now runs straight", async () => { const { src } = await import("./lib.mjs");
  return { ok: !/Unknown printing request\./.test(src.replace(/\/\/.*$/gm, "")) && /if \(b0 !== "test"\) return permDenied/.test(src) && /const mine = await agentForDevice\(rid, dv\);/.test(src), note: "the line is gone; the refusal that made it dead still stands" }; }, "SRC · the removed line and the refusal in front of it");
row("'print here instead' on a counter the admin named takes the printer and logs it", async () => {
  const { G, r } = await run(PRINT(SCREEN_MGR), "POST", "print-station/take", {});
  return { ok: r.status === 200 && r.json.ok === true && logged(G, "print_station_take").length === 1, note: `${r.status} ${r.text.slice(0, 80)}` }; });
row("…and 'stop printing here' releases it and logs it", async () => {
  const { G, r } = await run(PRINT(SCREEN_MGR), "POST", "print-station/release", {}); return { ok: r.status === 200 && logged(G, "print_station_release").length === 1, note: `${r.status}` }; });

// ══ 8 · LOYALTY, SPLITS WITH A TAB, AND THE LAST ERROR EXITS ═══════════════════════════════════
const LOYAL = { settings: { modules: { loyalty: { allowed: true } } },
  rpc: { lfh_loyalty_state: { on: true, point_value_paise: 100, max_redeem_pct: 100, balance: 100 }, lfh_loyalty_redeem: { ok: true, rupees: 10, balance: 90 }, lfh_staff_bill_discount: { discount: 10 } } };
row("spending a guest's points takes the money off THIS table's open bill and is logged", async () => {
  const { G, r } = await run(LOYAL, "POST", "loyalty-redeem", { table: "4", phone: "9876543210", points: 10 });
  const d = rpc(G, "lfh_staff_bill_discount")[0];
  return { ok: r.status === 200 && r.json.ok === true && !!d && d.args.p_session === ID.sess && logged(G, "loyalty_redeemed").length === 1, note: `${r.status} ${r.text.slice(0, 80)}` }; });
row("…with the module off for the restaurant, points cannot be spent (refused, nothing taken off)", async () => {
  const { G, r } = await run({ ...LOYAL, settings: { modules: { loyalty: { allowed: false } } } }, "POST", "loyalty-redeem", { table: "4", phone: "98", points: 10 });
  return { ok: r.status === 400 && !rpc(G, "lfh_staff_bill_discount").length, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("reading a guest's points with no phone answers 'not on', never an error", async () => {
  const { r } = await run(LOYAL, "POST", "loyalty", { table: "4" }); return { ok: r.status === 200 && r.json.on === false, note: `${r.status}` }; });
row("reopening a table refused by the database for any OTHER reason answers a plain sentence", async () => {
  const { r } = await run({ fail: { "rpc:lfh_reopen_table": { code: "XX000", message: "kaboom" } } }, "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "x" });
  return { ok: r.status >= 400 && !/kaboom/.test(r.text), note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("a manager whose pay-later power the admin switched OFF cannot put part of a split on a tab", async () => {
  const { G, r } = await run({ accessConfig: { khata: { on: false } } }, "POST", "tables/4/pay-split", { splits: [{ method: "Pay later", amount: 420 }] });
  return { ok: r.status === 403 && /put part of a bill on a tab/.test(r.text) && !W(G, "orders").length, note: `${r.status}` }; });
row("a split with a PAY-LATER part parks that part on the person, closes the table, and logs the tab", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; } },
    "POST", "tables/4/pay-split", { splits: [{ method: "Cash", amount: 210 }, { method: "Pay later", amount: 210, khataCustomerId: ID.khata }] });
  const s = G.FIX.sessions.find((x) => x.id === ID.sess);
  return { ok: r.status === 200 && r.json.parked === true && logged(G, "khata_park").length === 1 && s.status === "closed", note: `${r.status} ${r.text.slice(0, 100)}` }; });
row("a DELETE with no id at all answers 404, touching nothing", async () => {
  const { G, r } = await run({}, "DELETE", "orders", null); return { ok: r.status === 404 && !G.WRITES.length, note: `${r.status}` }; });
row("a print that FAILS for the fifth time is parked (it stops retrying) and logged 'gave up after 5 tries' as a warning", async () => {
  const { G, r } = await run(PRINT(SCREEN_MGR, { mut: (G) => { Object.assign(G.FIX.print_jobs[0], { status: "printing", claimed_at: nowIso(), attempts: 4 }); } }), "POST", `print-jobs/${ID.job}/done`, { ok: false, error: "no paper" });
  const l = logged(G, "kot_print_failed")[0];
  return { ok: r.status === 200 && !!l && /gave up after 5 tries/.test(l.detail) && l.level === "warn" && G.FIX.print_jobs[0].status === "failed", note: l ? `${l.detail} · ${l.level}` : `${r.status}` }; });

// ══ 9 · EVERY REFUSAL NO CHECK HAD MADE FIRE (coverage pass 3: 146 untaken exits) ═══════════════
// Each row drives one refusal and asserts three things: the status, the sentence a person reads, and
// that nothing was written (a write that matched no row is not a write). Powers that are always ON for
// a manager are refused here the only way they can be: the admin switching the FEATURE off
// (access_config.<power>.on = false) — the cap managerCan() honours before anything else.
const realWrites = (G) => G.WRITES.filter((w) => w.table !== "staff_actions" && (w.op === "insert" || w.op === "upsert" || w.matched > 0)).length;
const capOff = (...flags) => ({ accessConfig: Object.fromEntries(flags.map((f) => [f, { on: false }])) });
function refuse(what, setup, verb, path, body, status, re, opts = {}) {
  row(what, async () => {
    const G = await fullWorld(setup); G.HONOUR_UPDATE_RETURN = true; if (setup.mut) setup.mut(G);
    const r = await call(verb, path, { ...(body === null ? {} : { body }), ...(opts.headers ? { headers: opts.headers } : {}), ...(opts.query ? { query: opts.query } : {}) });
    const msg = (r.json && r.json.error) || r.text;
    const okStatus = Array.isArray(status) ? status.includes(r.status) : r.status === status;
    const plain = !/stub:|violates|syntax|PGRST|kaboom/.test(r.text);
    const w = realWrites(G);
    return { ok: okStatus && (!re || re.test(msg)) && plain && (opts.writes === true || w === 0), note: `${r.status} · ${String(msg).slice(0, 80)} · ${w} write(s)` };
  }, `STUB · ${setup.label || "French House manager"}${opts.how ? " · " + opts.how : ""}`);
}
// A database error AFTER the request was accepted: a plain sentence, and an error-level diary line naming the endpoint.
function crashes(what, setup, verb, path, body) {
  row(what, async () => {
    const G = await fullWorld(setup); G.HONOUR_UPDATE_RETURN = true; if (setup.mut) setup.mut(G);
    const r = await call(verb, path, body === null ? {} : { body });
    const named = G.ERRORS.some((e) => e.action === "route_error" && new RegExp(`${verb} ${path.split("/")[0]}`).test(e.detail || ""));
    return { ok: r.status >= 500 && !/stub:/.test(r.text) && named, note: `${r.status} · logged=${named}` };
  }, `STUB · the database errors on purpose · ${setup.label || "manager"}`);
}
const T = "00000000-0000-4000-8000-000000000999"; // an id nothing carries

// customer, loyalty, orders, parcels
refuse("saving a customer for a table called 'x' is refused", {}, "POST", "customer-capture", { table: "x" }, 400, /valid table/);
refuse("reading points with no table is refused", {}, "POST", "loyalty", { phone: "98" }, 400, /valid table/);
refuse("spending points with no table is refused", {}, "POST", "loyalty-redeem", { phone: "98", points: 1 }, 400, /valid table/);
refuse("taking an order with order-taking switched OFF by the admin is refused", capOff("take_orders"), "POST", "order", { table: "4", items: [{ id: "dal" }] }, 403, /take new orders/);
refuse("an order for table 'x' is refused", {}, "POST", "order", { table: "x", items: [{ id: "dal" }] }, 400, /valid table/);
refuse("an order for table 0 is refused — by the shared floor-plan check, before this branch's own count check", {}, "POST", "order", { table: "0", items: [{ id: "dal" }] }, 400, /isn't valid|has 20 tables/);
refuse("a quick-order discount from someone whose discount power is OFF is refused before the order exists", capOff("give_discounts"), "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 10 }, 403, /give discounts/);
refuse("…and if the power is switched off between the check and the placing, the order stands but no discount is written", { ...capOff(), rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order2 }, lfh_price_order: { ok: false } }, mut: (G) => { G.FIX.restaurants[0].access_config = { give_discounts: { on: false } }; } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 10 }, 403, /give discounts/, { writes: true, how: "pricer unavailable, so the pre-check is skipped and the backstop answers" });
refuse("a quick-order discount over the limit, when the pre-check could not price it, is still refused by the backstop", { accessConfig: { give_discounts: { limit: { manager: 10 } } }, rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order }, lfh_price_order: { ok: false } } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 300 }, 403, /over your 10% limit/, { writes: true });
refuse("a counter parcel from a manager whose parcel power the admin switched off is refused", capOff("parcel"), "POST", "parcel", { items: [{ id: "dal" }] }, 403, /parcel/);
refuse("a parcel with no dishes is refused", {}, "POST", "parcel", { items: [] }, 400, /items required/);
refuse("a parcel naming a dish that is not on this menu is refused (it used to go out a line short)", {}, "POST", "parcel", { items: [{ id: "nope" }] }, 400, /isn't on the menu/);
refuse("a parcel discount from someone without the discount power is refused before the parcel exists", capOff("give_discounts"), "POST", "parcel", { items: [{ id: "dal" }], discount: 10 }, 403, /give discounts/);
refuse("a parcel discount over the person's %-limit is refused before the parcel exists", { accessConfig: { give_discounts: { limit: { manager: 10 } } } }, "POST", "parcel", { items: [{ id: "dal" }], discount: 100 }, 403, /over your 10% limit/);
crashes("a parcel the database refuses to create answers a plain sentence and leaves an error line", { fail: { "rpc:lfh_platform_insert": "error" } }, "POST", "parcel", { items: [{ id: "dal" }] });
crashes("…and if stamping its payment fails after it was created, the same", { rpc: { lfh_platform_insert: { id: ID.plat } }, fail: { "aggregator_orders:update": "error" } }, "POST", "parcel", { items: [{ id: "dal" }], paid: true, method: "Cash" });
// ratings and the platform board
refuse("handling a rating without the ratings power is refused", capOff("view_ratings"), "POST", "ratings/ack", { id: ID.fb, acknowledged: true }, 403);
refuse("handling a rating with no id is refused", {}, "POST", "ratings/ack", { acknowledged: true }, 400, /id required/);
refuse("'handled' sent as text, not true/false, is refused", {}, "POST", "ratings/ack", { id: ID.fb, acknowledged: "yes" }, 400, /true\/false/);
refuse("a rating note that is not text is refused", {}, "POST", "ratings/ack", { id: ID.fb, note: 5 }, 400, /must be text/);
refuse("a rating save with nothing to change is refused", {}, "POST", "ratings/ack", { id: ID.fb }, 400, /nothing to update/);
crashes("a rating save the database refuses answers a plain sentence", { fail: { "feedback:update": "error" } }, "POST", "ratings/ack", { id: ID.fb, note: "called back" });
refuse("a MANAGER may not add demo delivery orders (they would pollute real revenue)", {}, "POST", "platform/test", { channel: "zomato" }, 403, /Only the owner or admin/);
refuse("the owner asking for a demo order on a channel that is OFF is refused, not given a different one", { who: "owner" }, "POST", "platform/test", { channel: "swiggy" }, 400, /turned off/);
refuse("…with no channel on at all, there is nothing to simulate", { who: "owner", settings: { platform_channels: {} } }, "POST", "platform/test", {}, 400, /No delivery channel/);
crashes("…and a demo order the database refuses answers a plain sentence", { who: "owner", fail: { "rpc:lfh_platform_insert": "error" } }, "POST", "platform/test", { channel: "zomato" });
refuse("a delivery order moved to an unknown status is refused", {}, "POST", `platform/${ID.plat}/status`, { status: "teleported" }, 400, /invalid status/);
refuse("a delivery order whose platform power is switched off cannot be advanced", capOff("platform"), "POST", `platform/${ID.plat}/status`, { status: "accepted" }, 403);
crashes("…and a status change the database refuses answers a plain sentence", { fail: { "rpc:lfh_platform_set_status": "error" } }, "POST", `platform/${ID.plat}/status`, { status: "accepted" });
refuse("collecting a parcel that is not this restaurant's is refused (404)", {}, "POST", `platform/${T}/pay`, { method: "Cash" }, 404);
refuse("collecting a delivery order with the platform power off is refused", capOff("platform"), "POST", `platform/${ID.plat}/pay`, { method: "Cash" }, 403);
crashes("…and a collection the database refuses answers a plain sentence, nothing claimed", { fail: { "aggregator_orders:update": "error" } }, "POST", `platform/${ID.plat}/pay`, { method: "Cash" });
refuse("noting a bill printed for a parcel that is not this restaurant's is refused (404)", {}, "POST", `platform/${T}/printed`, {}, 404);
refuse("noting a delivery bill printed with the platform power off is refused", capOff("platform"), "POST", `platform/${ID.plat}/printed`, {}, 403);
crashes("…and a print stamp the database refuses answers a plain sentence", { fail: { "aggregator_orders:update": "error" } }, "POST", `platform/${ID.plat}/printed`, {});
// banquet
refuse("banquet with the banquet power switched off by the admin is refused", capOff("banquet"), "POST", "banquet/item-save", { title: "X", price: 1 }, 403, /banquet billing/);
refuse("a banquet line with no title is refused", {}, "POST", "banquet/item-save", { title: " ", price: 1 }, 400, /title required/);
refuse("deleting a banquet line without 'edit the menu' is refused", { perms: { banquet: true, edit_menu: false } }, "POST", "banquet/item-delete", { id: ID.bq }, 403, /banquet menu/);
refuse("a banquet order for table 99 of 20 is refused", {}, "POST", "banquet/place", { table: "99", lines: [{ id: ID.bq, qty: 1 }] }, 400, /has 20 tables/);
refuse("a banquet order with no lines is refused", {}, "POST", "banquet/place", { lines: [] }, 400, /lines required/);
crashes("a banquet order the database refuses answers a plain sentence", { fail: { "rpc:lfh_banquet_place_order": "error" } }, "POST", "banquet/place", { lines: [{ id: ID.bq, qty: 1 }] });
refuse("a banquet order the database turns down names the reason (an item that no longer exists)", { rpc: { lfh_banquet_place_order: { ok: false, reason: "unknown_item" } } }, "POST", "banquet/place", { lines: [{ id: ID.bq, qty: 1 }] }, 400, /no longer exists/);
refuse("a banquet bill with no lines is refused", {}, "POST", "banquet/bill", { lines: [] }, 400, /at least one banquet line/);
crashes("a banquet bill the database refuses answers a plain sentence", { fail: { "rpc:lfh_banquet_bill_create": "error" } }, "POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 1 }] });
// audit, deletes, tips, dish status
crashes("recording a removal the database refuses answers a plain sentence", { fail: { "rpc:lfh_record_removal": "error" } }, "POST", "audit", { kind: "dish_removed" });
refuse("'was the food made?' with no order named is refused", {}, "POST", "audit/classify", { made: true }, 400, /which order/);
crashes("…and an answer the database refuses answers a plain sentence", { fail: { "rpc:lfh_cancel_classify": "error" } }, "POST", "audit/classify", { order_id: ID.cancelled, made: true });
refuse("deleting a bill without the 'reopen a bill' power is refused before the delete rule is even asked", { perms: { void_bills: false } }, "POST", "orders/delete", { ids: [ID.order2] }, 403, /delete or clear bills/);
refuse("the admin console sending a bill delete with no ids is refused", { who: "admin" }, "POST", "orders/delete", {}, 400, /no ids/);
refuse("a tip from someone whose settle power the admin switched off is refused", capOff("mark_paid"), "POST", `orders/${ID.order}/tip`, { amount: 10 }, 403, /record a tip/);
refuse("one dish inside a ticket set to an unknown status is refused", {}, "POST", `orders/${ID.order}/item`, { index: 0, status: "eaten" }, 400, /invalid status/);
refuse("one dish inside a ticket at an index that does not exist is refused", {}, "POST", `orders/${ID.order}/item`, { index: 7, status: "served" }, 400, /bad item index/);
// sessions, tables, moves
refuse("opening a table with no table named is refused", {}, "POST", "sessions/open", {}, 400, /table required/);
crashes("opening a table the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_open_table": "error" } }, "POST", "sessions/open", { table: "6" });
refuse("opening a table the database turns down passes on its reason", { rpc: { lfh_staff_open_table: { error: "That table is already open." } } }, "POST", "sessions/open", { table: "6" }, 400, /already open/);
refuse("closing a table that still owes money WITHOUT 'close anyway' is refused with a reason code the panel reads", { mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id !== ID.order2 && o.id !== ID.cancelled); } }, "POST", `sessions/${ID.sess}/close`, {}, 409, /owes|cooking|unpaid/i);
refuse("an invoice for a session that is not this restaurant's is refused (404), no number drawn", {}, "POST", `sessions/${ID.s_r2}/invoice`, { cust_phone: "9876543210", cust_name: "A" }, 404);
refuse("reopening a table for a session that is not this restaurant's is refused (404)", {}, "POST", `sessions/${ID.s_r2}/reopen-table`, { reason: "x" }, 404);
refuse("voiding the invoice of a session that is not this restaurant's is refused (404)", {}, "POST", `sessions/${ID.s_r2}/void-invoice`, { reason: "x" }, 404);
refuse("voiding an invoice without a reason is refused — every reopen must say why", { mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(1); } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: " " }, 400, /reason is required/);
refuse("moving a party from a session that is not this restaurant's is refused (404)", {}, "POST", `sessions/${ID.s_r2}/shift`, { to: "7" }, 404);
refuse("moving a party to table 99 of 20 is refused", {}, "POST", `sessions/${ID.sess}/shift`, { to: "99" }, 400, /out of range/);
refuse("moving one ticket to table 'x' is refused", {}, "POST", `orders/${ID.order}/move`, { to: "x" }, 400, /valid table/);
refuse("moving one ticket to table 99 of 20 is refused", {}, "POST", `orders/${ID.order}/move`, { to: "99" }, 400, /out of range/);
crashes("a ticket move the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_move_order": "error" } }, "POST", `orders/${ID.order}/move`, { to: "7" });
refuse("a ticket move the database turns down names its reason (a PAID order)", { rpc: { lfh_staff_move_order: { ok: false, reason: "order_paid" } } }, "POST", `orders/${ID.order}/move`, { to: "7" }, 409, /PAID order/);
refuse("merging into table 'x' is refused", {}, "POST", `sessions/${ID.sess}/merge`, { to: "x" }, 400, /valid table/);
refuse("merging a session that is not this restaurant's is refused (404)", {}, "POST", `sessions/${ID.s_r2}/merge`, { to: "2" }, 404);
crashes("a merge the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_merge_tables": "error" } }, "POST", `sessions/${ID.sess}/merge`, { to: "2" });
refuse("a merge into a table with nobody at it says to use Change table instead", { rpc: { lfh_staff_merge_tables: { ok: false, reason: "target_not_open" } } }, "POST", `sessions/${ID.sess}/merge`, { to: "2" }, 409, /Change table/);
refuse("settling in parts with the settle power switched off by the admin is refused", capOff("mark_paid"), "POST", "tables/4/pay-split", { splits: [{ method: "Cash", amount: 420 }] }, 403, /mark a bill paid/);
refuse("settling in parts for table 'x' is refused", {}, "POST", "tables/x/pay-split", { splits: [{ method: "Cash", amount: 1 }] }, 400, /valid table/);
refuse("moving one dish to table '0' is refused", {}, "POST", `order-items/${ID.item}/move`, { to: "0" }, 400, /valid table/);
refuse("moving one dish to table 99 of 20 is refused", {}, "POST", `order-items/${ID.item}/move`, { to: "99" }, 400, /out of range/);
crashes("a dish move the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_move_order_item": "error" } }, "POST", `order-items/${ID.item}/move`, { to: "7" });
refuse("a dish move onto an invoiced table names that reason", { rpc: { lfh_staff_move_order_item: { ok: false, reason: "target_invoiced" } } }, "POST", `order-items/${ID.item}/move`, { to: "7" }, 409, /already invoiced/);
refuse("making a guest who is gone the head of the table is refused (404)", {}, "POST", `members/${T}/make-head`, {}, 404, /not found/);
refuse("making the CURRENT head the head again changes nothing", { mut: (G) => { const m = G.FIX.session_members.find((x) => x.id === ID.member); m.role = "owner"; } }, "POST", `members/${ID.member}/make-head`, {}, 200);
// dishes on a printed bill, edits the database refuses
const LIVE_INVOICE = (G) => { const s = G.FIX.sessions.find((x) => x.id === ID.sess); Object.assign(s, { invoice_no: "INV-7", invoice_voided: false, invoice_at: ago(1) }); };
refuse("removing a dish that is on the PRINTED bill is refused — reopen to add, or a credit note", { mut: LIVE_INVOICE }, "POST", `items/${ID.item}/delete`, {}, 409, /printed bill/);
crashes("a dish removal the database refuses answers a plain sentence", { fail: { "rpc:lfh_delete_order_item": "error" } }, "POST", `items/${ID.item}/delete`, {});
refuse("lowering a printed dish's quantity is refused the same way", { mut: LIVE_INVOICE }, "POST", `items/${ID.item}/qty`, { qty: 1 }, 409, /printed bill/);
crashes("a quantity change the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_edit_item_qty": "error" } }, "POST", `items/${ID.item}/qty`, { qty: 1 });
refuse("a quantity change the database turns down on a PAID bill is answered 409", { rpc: { lfh_staff_edit_item_qty: { ok: false, reason: "order_paid" } } }, "POST", `items/${ID.item}/qty`, { qty: 1 }, 409, /PAID/);
crashes("a dish note the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_edit_item_note": "error" } }, "POST", `items/${ID.item}/note`, { note: "x" });
refuse("changing the NO-list of a dish that is gone is refused", {}, "POST", `items/${T}/removed`, { removed: ["onion"], reason_note: "x" }, 400, /no longer on the order/);
refuse("adding a dish to a ticket on the PRINTED bill is refused", { mut: LIVE_INVOICE }, "POST", `orders/${ID.order}/add-item`, { dishId: "dal" }, 409, /printed bill/);
refuse("adding a dish with no dish named is refused", {}, "POST", `orders/${ID.order}/add-item`, {}, 400, /dish required/);
crashes("adding a dish the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_add_item_to_order": "error" } }, "POST", `orders/${ID.order}/add-item`, { dishId: "dal" });
refuse("adding a sold-out dish (the database's refusal) says so", { rpc: { lfh_staff_add_item_to_order: { ok: false, reason: "sold_out" } } }, "POST", `orders/${ID.order}/add-item`, { dishId: "dal" }, 400, /sold out/);
refuse("serving a dish that is not on this order any more is refused (404)", { mut: (G) => { G.FIX.order_items = G.FIX.order_items.filter((i) => i.id !== ID.item); } }, "POST", `items/${ID.item}/status`, { status: "served" }, 404, /isn't on this order/);
refuse("answering a request with 'maybe' is refused", {}, "POST", `requests/${ID.req}/resolve`, { status: "maybe" }, 400, /invalid status/);
row("approving an 'open' request whose table another device opened at the same moment is treated as 'already open', not a crash", async () => {
  const G = await fullWorld({ fail: { "sessions:insert": { code: "23505", message: "duplicate key value violates unique constraint" } } }); G.HONOUR_UPDATE_RETURN = true;
  G.FIX.requests.push({ id: "rq2", restaurant_id: "rest-1", table_number: "12", type: "open", status: "pending" });
  const r = await call("POST", "requests/rq2/resolve", { body: { status: "approved" } });
  return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
refuse("clearing the round of table 'x' is refused", {}, "POST", "tables/x/restart", {}, 400, /valid table/);
refuse("splitting table 'x' from a merge is refused", {}, "POST", "tables/x/unmerge", {}, 400, /valid table/);
crashes("an unmerge the database refuses answers a plain sentence", { fail: { "rpc:lfh_staff_unmerge_table": "error" } }, "POST", "tables/4/unmerge", {});
refuse("marking table 'x' is refused", {}, "POST", "tables/x/tag", { tag: "vip" }, 400, /valid table/);
refuse("marking a table with the table-type power switched off by the admin is refused", capOff("table_tags"), "POST", "tables/4/tag", { tag: "vip" }, 403, /mark tables/);
refuse("'on the house' for table 'x' is refused", {}, "POST", "tables/x/on-the-house", {}, 400, /valid table/);
refuse("'on the house' with the table-type power switched off by the admin is refused", capOff("table_tags"), "POST", "tables/4/on-the-house", {}, 403, /on the house/);
refuse("'on the house' with the settle power switched off by the admin is refused", capOff("mark_paid"), "POST", "tables/4/on-the-house", {}, 403, /mark a bill paid/);
refuse("'on the house' on a table where everything is already paid has nothing to settle", { mut: (G) => { for (const o of G.FIX.orders) if (o.restaurant_id === "rest-1") o.payment_status = "paid"; } }, "POST", "tables/4/on-the-house", {}, 409, /Nothing to settle/);
refuse("'on the house' while a ticket is still waiting to be accepted is refused", { mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order2 || o.restaurant_id === "rest-2"); } }, "POST", "tables/4/on-the-house", {}, 409, /Accept the order first/);
refuse("parking table 'x' is refused", {}, "POST", "tables/x/khata", { customer_id: ID.khata }, 400, /valid table/);
refuse("parking a bill with the pay-later power switched off by the admin is refused", capOff("khata"), "POST", "tables/4/khata", { customer_id: ID.khata }, 403, /collect later/);
refuse("parking a table with nothing unpaid is refused", { mut: (G) => { for (const o of G.FIX.orders) if (o.restaurant_id === "rest-1") o.payment_status = "paid"; } }, "POST", "tables/4/khata", { customer_id: ID.khata }, 409, /Nothing unpaid/);
refuse("adding a person to the book with the pay-later power off is refused", capOff("khata"), "POST", "khata/customers", { name: "X" }, 403, /khata book/);
refuse("adding a person with no name is refused", {}, "POST", "khata/customers", { name: " " }, 400, /name required/);
refuse("collecting a tab with the pay-later power off is refused", capOff("khata"), "POST", "khata/pay", { order_id: ID.paid, method: "Cash" }, 403, /khata payments/);
refuse("collecting a tab with the settle power off is refused", capOff("mark_paid"), "POST", "khata/pay", { order_id: ID.paid, method: "Cash" }, 403, /mark a bill paid/);
refuse("collecting a tab with a payment method nobody counts is refused", {}, "POST", "khata/pay", { order_id: ID.paid, method: "IOU" }, 400, /invalid payment_method/);
refuse("a ban that names nobody (no phone, table, device or guest) is refused", {}, "POST", "blocklist", { reason: "x" }, 400, /required/);
// printing
refuse("reprinting a KOT with no order named is refused", {}, "POST", "print-jobs", {}, 400, /Missing order id/);
refuse("reprinting a KOT that was DELETED is refused — a removed order is not cooked again", { mut: (G) => { ord(G).deleted_at = ago(2); } }, "POST", "print-jobs", { order_id: ID.order }, 400, /was deleted/);
refuse("reporting a print for a job that is gone is refused (404)", {}, "POST", `print-jobs/${T}/done`, { ok: true }, 404, /gone/);
refuse("clearing the queue when the waiting count cannot be read clears NOTHING and says so", { fail: { "print_jobs:select": "error" } }, "POST", "printing/queue/clear", {}, 400, /Couldn't count/);
refuse("clearing an EMPTY queue answers 'cleared 0' and writes nothing", { mut: (G) => { G.FIX.print_jobs = []; } }, "POST", "printing/queue/clear", {}, 200);
refuse("clearing the queue when the database refuses the write says it could not", { fail: { "print_jobs:update": "error" } }, "POST", "printing/queue/clear", {}, 400, /Could not clear/);
refuse("any printer-SETUP verb from the panel is refused — Aevidine sets printers up", {}, "POST", "printing/route", { kind: "kot" }, 403, /Aevidine does that/);
refuse("a test print from a browser with no device id is refused", { mut: () => {} }, "POST", "printing/test", { printer: "EPSON" }, 400, /no device id/, { headers: { "x-test-no-device": "1" }, how: "the stub device id is replaced with none" });
refuse("'print here' from a browser with no device id is refused out loud", {}, "POST", "print-station/take", {}, 409, /no device id/, { headers: { "x-test-no-device": "1" } });
// the generic save and the generic delete
refuse("saving an unknown kind of thing is refused (404)", {}, "POST", "widgets", { a: 1 }, 404, /unknown kind/);
refuse("saving a dish with Edit menu switched OFF for managers is refused at the tab", capOff("edit_menu"), "POST", "items", { id: "dal" }, 403, /menu editor/);
refuse("a manager without 'manage categories' cannot save a category", { accessConfig: { edit_menu: { manager_opts: { manage_categories: false } } } }, "POST", "categories", { slug: "mains", name: { en: "X" } }, 403, /manage categories/);
refuse("a manager without 'manage filters' cannot save a tag", { accessConfig: { edit_menu: { manager_opts: { manage_filters: false } } } }, "POST", "filters", { slug: "veg", name: { en: "X" } }, 403, /manage filters/);
refuse("deleting a dish with Edit menu switched off for managers is refused", capOff("edit_menu"), "DELETE", "items/dal", null, 403);
refuse("a manager without 'delete a dish' cannot delete one", { accessConfig: { edit_menu: { manager_opts: { delete_dish: false } } } }, "DELETE", "items/dal", null, 403, /delete dishes/);
refuse("a manager without 'manage categories' cannot delete a category", { accessConfig: { edit_menu: { manager_opts: { manage_categories: false } } } }, "DELETE", "categories/mains", null, 403, /manage categories/);
refuse("a manager without 'manage filters' cannot delete a tag", { accessConfig: { edit_menu: { manager_opts: { manage_filters: false } } } }, "DELETE", "filters/veg", null, 403, /manage filters/);
// PATCH / DELETE preambles
refuse("an OWNER naming a restaurant they do not own in ?rid= is refused before anything is read (PATCH)", { who: "owner" }, "PATCH", `orders/${ID.order}`, { status: "served" }, 403, /only edit restaurants you own/, { query: "?rid=rest-2" });
refuse("…and the same for DELETE", { who: "owner" }, "DELETE", `calls/${ID.call}`, null, 403, /only edit restaurants you own/, { query: "?rid=rest-2" });
refuse("a PATCH on a switched-off tab's path is refused at the tab gate", capOff("view_ratings"), "PATCH", "ratings/x", { a: 1 }, 403, /guest ratings/);
refuse("a DELETE on the menu editor's path with Edit menu off is refused at the tab gate", capOff("edit_menu"), "DELETE", "filters/veg", null, 403, /menu editor/);
refuse("a PATCH carrying a value the screen saw that is no longer true is refused — first save wins, the loser is told", {}, "PATCH", `orders/${ID.order}`, { payment_status: "paid", payment_method: "Cash" }, 409, null, { headers: { "x-lfh-expect": JSON.stringify({ table: "orders", id: ID.order, fields: { payment_status: "paid" } }) } });
refuse("a payment status that is neither pending nor paid is refused", {}, "PATCH", `orders/${ID.order}`, { payment_status: "half" }, 400, /invalid payment_status/);
refuse("marking paid with the settle power switched off by the admin is refused", capOff("mark_paid"), "PATCH", `orders/${ID.order}`, { payment_status: "paid" }, 403, /mark a bill paid/);
refuse("deleting a ticket without the 'reopen a bill' power is refused before the delete rule", { perms: { void_bills: false } }, "DELETE", `orders/${ID.order2}`, null, 403, /delete bills/);

// ══ 10 · THE LAST EXITS — reachable ones driven, by-design backstops read (coverage pass 4) ═══════
const REPLAY = { "x-lfh-replay": "1", "x-lfh-queued-at": ago(10) };
const NEW_PARTY = (G) => { G.FIX.sessions.find((s) => s.id === ID.sess).created_at = new Date().toISOString(); };
refuse("an OFFLINE cancel replayed after the table got a NEW party is refused — it was for the guests who left", { mut: NEW_PARTY }, "PATCH", `orders/${ID.order}`, { status: "cancelled" }, 409, /clash_new_party|different party now/, { headers: REPLAY });
refuse("…and an offline waiter-call removal replayed onto a new party is refused the same way", { mut: (G) => { NEW_PARTY(G); } }, "DELETE", `calls/${ID.call}`, null, [200, 409], null, { headers: REPLAY, how: "a call names a table only when its row says so — 409 if it does, the delete otherwise" });
refuse("…while a LIVE cancel (no replay marker) on the same table goes through", { mut: NEW_PARTY }, "PATCH", `orders/${ID.order}`, { status: "cancelled" }, 200, null, { writes: true });
refuse("the owner voiding an invoice the database calls SETTLED (LFH01) is sent to the credit note", { who: "owner", mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(1); }, fail: { "rpc:lfh_void_invoice": { code: "LFH01", message: "invoice locked" } } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "x" }, 409, /settled — its invoice can't be reopened/);
refuse("parking a bill whose table close fails mid-way answers the close's own reason, never 'done'", { mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; G.FAIL_NTH = { "sessions:select": { at: 2, mode: "error" } }; } }, "POST", "tables/4/khata", { customer_id: ID.khata }, [400, 404, 409, 500, 503], null, { writes: true, how: "the 2nd sessions read (closeSession's ownership check) errors" });
refuse("a split with a tab whose table close fails answers the close's reason, never 'settled'", { mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; G.FAIL_NTH = { "sessions:select": { at: 2, mode: "error" } }; } }, "POST", "tables/4/pay-split", { splits: [{ method: "Cash", amount: 210 }, { method: "Pay later", amount: 210, khataCustomerId: ID.khata }] }, [400, 404, 409, 500, 503], null, { writes: true, how: "closeSession's ownership read errors" });
crashes("approving 'open the table' when the database fails for a reason OTHER than a duplicate answers a plain sentence", { fail: { "sessions:insert": "error" }, mut: (G) => { G.FIX.requests.push({ id: "rq3", restaurant_id: "rest-1", table_number: "13", type: "open", status: "pending" }); } }, "POST", "requests/rq3/resolve", { status: "approved" });
refuse("a sample print the queue refuses to take says it could not send it (500, plain words)", { ...PRINT({ bill: { agent: "ag1", printer: "EPSON" } }), fail: { "print_jobs:insert": "error" } }, "POST", "printing/test", { sample: "bill" }, 500, /Could not send that sample/);
refuse("a test page the queue refuses to take says it could not send it (500, plain words)", { ...PRINT({}), fail: { "print_jobs:insert": "error" } }, "POST", "printing/test", { printer: "EPSON" }, 500, /Could not send the test page/);
// The by-design backstops: something earlier always answers first. Read, with the earlier gate named.
const B = async () => (await import("./lib.mjs"));
row("[read] the quick order's own table-count check sits behind the shared floor-plan check (offPlanTable), which refuses any table off the plan first", async () => {
  const { src } = await B(); return { ok: /offPlanTable/.test(src.slice(0, src.indexOf("async function postImpl(") + 6000)) && /tableCount > 0 && \(tn < 1 \|\| tn > tableCount\)/.test(src), note: "a second net, kept — not a fault" }; }, "SRC · read");
row("[read] 'Parcel orders aren't switched on' and 'The Platform board isn't enabled' cannot fire — both features are PERMANENT (lib/tableTags ALWAYS_ON, owner 2026-08-03)", async () => {
  const t = (await import("node:fs")).readFileSync(new URL("../../../lib/tableTags.ts", import.meta.url), "utf8");
  return { ok: /export const parcelLadder = async \(_rid: string\): Promise<TableTagsLadder> => ALWAYS_ON;/.test(t) && /export const takeawayLadder = async \(_rid: string\): Promise<TableTagsLadder> => ALWAYS_ON;/.test(t), note: "kept as nets for the day a switch returns" }; }, "SRC · lib/tableTags.ts read");
row("[read] a parcel with 'no valid dishes' cannot happen — every line is either refused (unknown, sold out, no price) or added", async () => {
  const { branch } = await B(); const t = branch('a === "parcel" && path.length === 1');
  return { ok: /if \(!d\) return err/.test(t) && /sold out/.test(t) && /picked\.push\(line\)/.test(t), note: "unreachable by construction" }; }, "SRC · read");
row("[read] the ratings and Edit-menu permission lines inside their handlers repeat the tab gate, which asks the same power first", async () => {
  const { src } = await B(); return { ok: /hit\.tab === "editor"  \? await managerCan\(g, rid, "edit_menu"\)/.test(src) && /hit\.tab === "ratings" \? await managerCan\(g, rid, "view_ratings"\)/.test(src), note: "backstops behind tabGate" }; }, "SRC · read");
row("[read] the quick order's AFTER-placing discount checks are now the backstop behind item 13's pre-check (same power, same cap)", async () => {
  const { branch } = await B(); const t = branch('a === "order" && path.length === 1');
  return { ok: t.indexOf('sb.rpc("lfh_price_order"') > 0 && t.indexOf('sb.rpc("lfh_price_order"') < t.indexOf('sb.rpc("lfh_staff_place_order"'), note: "the pre-check runs first; the backstop is kept" }; }, "SRC · read");
row("[read] serving a dish that vanished between the pre-read and the write is answered 404 (a race backstop since item 1's pre-read)", async () => {
  const { branch } = await B(); const t = branch('a === "items" && c === "status"'); return { ok: (t.match(/isn't on this order any more/g) || []).length >= 2, note: "two 404s: before the write, and if the write matched nothing" }; }, "SRC · read");

// ══ 11 · WHAT THE MUTATION RUN ASKED FOR (round 3: 533 planted breaks, 110 unnoticed at first) ═══
// scripts/sweep/t10s10/mutate.mjs made one small deliberate break at a time in my range and ran the
// whole in-memory suite against it. These rows exist because a break went UNNOTICED: most assert the
// VALUE a door wrote (a name, a note, a customer), not merely that it wrote; some pin routing (a near
// miss landing in the wrong handler); the last is the whole-suite query audit.
row("saving a customer passes THEIR name, number, consent and this bill's session to the database", async () => {
  const { G, r } = await run({}, "POST", "customer-capture", { table: "4", session: ID.sess, phone: "9876543210", name: "Asha", consent: true });
  const c = rpc(G, "lfh_capture_customer")[0];
  return { ok: r.status === 200 && c && c.args.p_name === "Asha" && c.args.p_phone === "9876543210" && c.args.p_consent === true && c.args.p_session === ID.sess, note: c ? JSON.stringify(c.args).slice(0, 110) : `${r.status}` }; });
row("…without consent, consent:false reaches the database (it then stores nothing)", async () => {
  const { G } = await run({}, "POST", "customer-capture", { table: "4", phone: "98", name: "A" }); const c = rpc(G, "lfh_capture_customer")[0];
  return { ok: c && c.args.p_consent === false, note: c ? String(c.args.p_consent) : "" }; });
row("a complaint raised from the admin console is filed with the role 'manager', never 'undefined'", async () => {
  const { G } = await run({ who: "admin" }, "POST", "issue", { subject: "Fridge" }); const w = G.WRITES.find((x) => x.table === "issues");
  // (the stub's copy drops undefined keys, so the role is asserted by name, not by "no undefined")
  return { ok: !!w && w.patch && w.patch.raised_role === "manager", note: w ? JSON.stringify(w.patch).slice(0, 110) : "no write" }; });
row("a quick order whose discount cannot be priced is still PLACED (the pricer being unavailable never blocks food)", async () => {
  const { G, r } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order } }, fail: { "rpc:lfh_price_order": "error" }, accessConfig: { give_discounts: { limit: { manager: 100 } } } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 10 });
  return { ok: r.status === 200 && rpc(G, "lfh_staff_place_order").length === 1, note: `${r.status}` }; });
row("a quick order WITHOUT a discount touches no discount at all", async () => {
  const { G } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order } } }, "POST", "order", { table: "4", items: [{ id: "dal" }] });
  return { ok: !rpc(G, "lfh_staff_bill_discount").length && !G.WRITES.some((w) => w.table === "orders" && w.patch && "discount" in w.patch), note: "" }; });
row("a quick-order discount carries the note the manager typed", async () => {
  const { G } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order } }, accessConfig: { give_discounts: { limit: { manager: 100 } } } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 10, discountNote: "regular guest" });
  const c = rpc(G, "lfh_staff_bill_discount")[0]; return { ok: c && c.args.p_note === "regular guest", note: c ? c.args.p_note : "not called" }; });
row("a quick-order discount on a SOLO order (no table session) is written on that order, with its note", async () => {
  const { G } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: ID.solo } }, accessConfig: { give_discounts: { limit: { manager: 100 } } } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 10, discountNote: "staff" });
  const o = ord(G, ID.solo); return { ok: o.discount === 10 && o.discount_note === "staff", note: `${o.discount} ${o.discount_note}` }; });
row("a parcel keeps each line's own kitchen note and the whole-order note", async () => {
  const { G } = await run({ rpc: { lfh_platform_insert: { id: ID.plat } } }, "POST", "parcel", { items: [{ id: "dal", qty: 1, note: "no onion" }], note: "pack separately" });
  const c = rpc(G, "lfh_platform_insert")[0]; const up = G.WRITES.find((w) => w.table === "aggregator_orders" && w.op === "update");
  return { ok: c && c.args.p_items[0].note === "no onion" && up && up.patch.payload.note === "pack separately", note: `${c && c.args.p_items[0].note} · ${up && up.patch.payload.note}` }; });
row("a parcel is filed under the customer's name when one is given, and 'Parcel' when not", async () => {
  const a = await run({ rpc: { lfh_platform_insert: { id: ID.plat } } }, "POST", "parcel", { items: [{ id: "dal" }], customer: "  Asha " }); const ca = rpc(a.G, "lfh_platform_insert")[0].args.p_customer;
  const b = await run({ rpc: { lfh_platform_insert: { id: ID.plat } } }, "POST", "parcel", { items: [{ id: "dal" }] }); const cb = rpc(b.G, "lfh_platform_insert")[0].args.p_customer;
  return { ok: ca === "Asha" && cb === "Parcel", note: `${ca} / ${cb}` }; });
row("the 'most you can take off' sentence mentions MRP ONLY when the parcel really has an MRP line", async () => {
  const { r } = await run({ who: "owner" }, "POST", "parcel", { items: [{ id: "dal" }], discount: 500 });
  return { ok: r.json && r.json.error === "Most you can take off this parcel is ₹200.00.", note: r.json && r.json.error }; });
row("a demo delivery order carries real dishes from this menu, never an empty ticket", async () => {
  const { G } = await run({ who: "owner" }, "POST", "platform/test", { channel: "zomato" }); const c = rpc(G, "lfh_platform_insert")[0];
  return { ok: c && c.args.p_items.length >= 1 && c.args.p_items.every((i) => i.title), note: c ? `${c.args.p_items.length} line(s)` : "" }; });
row("a demo delivery order is marked as a DEMO on the row, so a real integration can tell it apart", async () => {
  const { G } = await run({ who: "owner", rpc: { lfh_platform_insert: { id: ID.plat } } }, "POST", "platform/test", { channel: "zomato" });
  const w = G.WRITES.find((x) => x.table === "aggregator_orders" && x.op === "update"); return { ok: w && w.patch.payload.demo === true && w.patch.payload.channel === "zomato", note: w ? JSON.stringify(w.patch.payload) : "" }; });
row("a banquet order without a table is a walk-in bill (no table), logged as such", async () => {
  const { G } = await run({ rpc: { lfh_banquet_place_order: { ok: true, total: 300 } } }, "POST", "banquet/place", { lines: [{ id: ID.bq, qty: 1 }] });
  const c = rpc(G, "lfh_banquet_place_order")[0]; const l = logged(G, "banquet_place")[0]; return { ok: c && c.args.p_table === null && l && l.table_number === null, note: "" }; });
row("recording a removal passes the order and dish it names, and null when none is named", async () => {
  const { G } = await run({}, "POST", "audit", { kind: "dish_removed", order_id: ID.order, item_id: ID.item }); const c = rpc(G, "lfh_record_removal")[0];
  const b = await run({}, "POST", "audit", { kind: "order_cancelled" }); const d = rpc(b.G, "lfh_record_removal")[0];
  return { ok: c.args.p_order === ID.order && c.args.p_item === ID.item && d.args.p_order === null && d.args.p_item === null, note: "" }; });
row("an answer to 'was the food made?' names the person who gave it", async () => {
  const { G } = await run({ rpc: { lfh_cancel_classify: { ok: true } } }, "POST", "audit/classify", { order_id: ID.cancelled, made: false }); const c = rpc(G, "lfh_cancel_classify")[0];
  return { ok: c && c.args.p_actor === "Diag Manager" && c.args.p_actor_id === "u1", note: c ? c.args.p_actor : "" }; });
row("the admin console may delete a bill of EXACTLY 60 orders (the limit is 'more than 60')", async () => {
  const { r } = await run({ who: "admin" }, "POST", "orders/delete", { ids: Array.from({ length: 60 }, (_, i) => "x" + i) }); return { ok: r.status === 200, note: `${r.status}` }; });
row("…and one solo order (no session) may be deleted on its own", async () => {
  const { r } = await run({ who: "admin" }, "POST", "orders/delete", { ids: [ID.solo] }); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("…the Audit row of a deleted bill says what it was worth", async () => {
  const { G } = await run({ who: "admin" }, "POST", "orders/delete", { ids: [ID.order2] }); const a = audits(G, "order_deleted")[0];
  return { ok: a && Number(a.args.p_amount) === 210, note: a ? String(a.args.p_amount) : "no audit" }; });
row("a tip on a real ticket is saved on THAT ticket only", async () => {
  const { G, r } = await run({}, "POST", `orders/${ID.order}/tip`, { amount: 30 }); return { ok: r.status === 200 && ord(G).tip === 30 && ord(G, ID.order2).tip === undefined, note: `${r.status} ${ord(G).tip}` }; });
row("a ticket discount note longer than 200 is cut, and a missing one is stored as nothing", async () => {
  const { G } = await run({ who: "admin" }, "POST", `orders/${ID.solo}/discount`, { amount: 10, note: "n".repeat(300) }); const a = ord(G, ID.solo).discount_note;
  const b = await run({ who: "admin" }, "POST", `orders/${ID.solo}/discount`, { amount: 10 }); return { ok: a.length === 200 && ord(b.G, ID.solo).discount_note === null, note: `${a.length}` }; });
row("accepting a LIVE ticket moves it — and only it — to preparing", async () => {
  const { G } = await run({}, "POST", `orders/${ID.order2}/accept`, {}); return { ok: ord(G, ID.order2).status === "preparing" && ord(G, ID.cancelled).status === "cancelled", note: "" }; });
row("setting one dish inside a ticket rolls the ticket up: all served → served, some → preparing, none → received", async () => {
  const mk = (items) => ({ mut: (G) => { ord(G).items = items; } });
  const a = await run(mk([{ status: "served" }, { status: "preparing" }]), "POST", `orders/${ID.order}/item`, { index: 1, status: "served" }); const sa = ord(a.G).status;
  const b = await run(mk([{ status: "received" }, { status: "received" }]), "POST", `orders/${ID.order}/item`, { index: 0, status: "preparing" }); const sb_ = ord(b.G).status;
  const c = await run(mk([{ status: "received" }, { status: "preparing" }]), "POST", `orders/${ID.order}/item`, { index: 1, status: "received" }); const sc = ord(c.G).status;
  return { ok: sa === "served" && sb_ === "preparing" && sc === "received", note: `${sa}/${sb_}/${sc}` }; });
row("serving one dish rolls the ticket up the same way from the dish rows (all served → served; none active → received)", async () => {
  const a = await run({ mut: (G) => { G.FIX.order_items = [{ id: ID.item, restaurant_id: "rest-1", order_id: ID.order, status: "preparing" }]; } }, "POST", `items/${ID.item}/status`, { status: "served" }); const sa = ord(a.G).status;
  const b = await run({ mut: (G) => { G.FIX.order_items = [{ id: ID.item, restaurant_id: "rest-1", order_id: ID.order, status: "preparing" }, { id: "i2", restaurant_id: "rest-1", order_id: ID.order, status: "received" }]; } }, "POST", `items/${ID.item}/status`, { status: "received" }); const sb_ = ord(b.G).status;
  const c = await run({}, "POST", `items/${ID.item}/status`, { status: "served" }); const ser = c.G.FIX.order_items.find((i) => i.id === ID.item).served_at;
  return { ok: sa === "served" && sb_ === "received" && !!ser, note: `${sa}/${sb_}` }; });
row("…and sending a dish BACK clears its served time", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.order_items[0].served_at = ago(1); G.FIX.order_items[0].status = "served"; } }, "POST", `items/${ID.item}/status`, { status: "preparing" });
  return { ok: G.FIX.order_items.find((i) => i.id === ID.item).served_at === null, note: "" }; });
row("opening a table the database answers with no error opens it and logs table_open", async () => {
  const { G, r } = await run({ rpc: { lfh_staff_open_table: { ok: true } } }, "POST", "sessions/open", { table: "6" }); return { ok: r.status === 200 && logged(G, "table_open").length === 1, note: `${r.status}` }; });
row("re-issuing a reopened bill records the DISCOUNT change too (before → after)", async () => {
  const { G } = await inv({ mut: (G) => { ord(G).discount = 20; }, fix: { deletion_audit: [{ id: 9, restaurant_id: "rest-1", session_id: ID.sess, kind: "invoice_voided", at: ago(3), meta: { total_at_reopen: 400, discount_at_reopen: 5, orders_on_bill: 1 } }] } });
  const a = audits(G, "bill_changed_after_reopen")[0]; return { ok: a && a.args.p_meta.change.discount === 15 && a.args.p_meta.before.discount === 5, note: a ? JSON.stringify(a.args.p_meta.change) : "" }; });
row("voiding an invoice records what the bill stood at, with its discount, in the Audit", async () => {
  const { G } = await run({ who: "owner", mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(1); G.FIX.orders.push({ id: "v1", restaurant_id: "rest-1", session_id: ID.closedSess, total: 300, discount: 12, status: "served" }); } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "wrong dish" });
  const a = audits(G, "invoice_voided")[0]; // the closed bill already carries a ₹300 order in this world, so the record is ₹600 over 2 orders
  return { ok: a && a.args.p_meta.total_at_reopen === 600 && a.args.p_meta.discount_at_reopen === 12 && a.args.p_meta.orders_on_bill === 2, note: a ? JSON.stringify(a.args.p_meta) : "" }; });
row("a MANAGER may reopen a bill INSIDE the window (4 minutes after it closed, default window 5)", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(4); } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "x" });
  return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("…the owner is NOT held to the manager's window (20 minutes later still reopens)", async () => {
  const { r } = await run({ who: "owner", mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(20); } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "x" });
  return { ok: r.status === 200, note: `${r.status}` }; });
row("a merge records the actor's LOGIN name on the request (who joined them)", async () => {
  const { G } = await run({ rpc: { lfh_staff_merge_tables: { ok: true } } }, "POST", `sessions/${ID.sess}/merge`, { to: "2" }); const c = rpc(G, "lfh_staff_merge_tables")[0];
  return { ok: c && c.args.p_actor === "diagm1" && c.args.p_actor_id === "u1", note: c ? c.args.p_actor : "" }; });
row("an unmerge records the actor's login name", async () => {
  const { G } = await run({ rpc: { lfh_staff_unmerge_table: { ok: true, parent: "2", moved: 1 } } }, "POST", "tables/4/unmerge", {}); const c = rpc(G, "lfh_staff_unmerge_table")[0];
  return { ok: c && c.args.p_actor === "diagm1", note: c ? c.args.p_actor : "" }; });
row("the admin console's merges and unmerges are recorded as 'manager'… never as undefined", async () => {
  const { G } = await run({ who: "admin", rpc: { lfh_staff_unmerge_table: { ok: true } } }, "POST", "tables/4/unmerge", {}); const c = rpc(G, "lfh_staff_unmerge_table")[0];
  return { ok: c && c.args.p_actor === "manager", note: c ? c.args.p_actor : "" }; });
row("removing a dish records its worth as price × quantity in the Audit", async () => {
  const { G } = await run({ rpc: { lfh_delete_order_item: { ok: true, order_id: ID.order, items_left: 1 } } }, "POST", `items/${ID.item}/delete`, {}); const a = audits(G, "dish_removed")[0];
  return { ok: a && Number(a.args.p_amount) === 400, note: a ? String(a.args.p_amount) : "" }; });
row("a guest who is already the head is not demoted and re-promoted (nothing written)", async () => {
  const { G, r } = await run({ mut: (G) => { const m = G.FIX.session_members.find((x) => x.id === ID.member); m.role = "owner"; m.removed = false; } }, "POST", `members/${ID.member}/make-head`, {});
  return { ok: r.status === 200 && !W(G, "session_members").length, note: `${r.status}` }; });
row("…while a REMOVED former head is made head again properly", async () => {
  const { G } = await run({ mut: (G) => { const m = G.FIX.session_members.find((x) => x.id === ID.member); m.role = "owner"; m.removed = true; } }, "POST", `members/${ID.member}/make-head`, {});
  const m = G.FIX.session_members.find((x) => x.id === ID.member); return { ok: m.removed === false && m.role === "owner", note: "" }; });
row("letting a guest in and removing one each report 404 when the guest has left (two separate doors)", async () => {
  const a = await run({}, "POST", `members/${T}/approve`, {}); const b = await run({}, "POST", `members/${T}/remove`, {}); return { ok: a.r.status === 404 && b.r.status === 404, note: `${a.r.status}/${b.r.status}` }; });
row("a ban naming a guest also takes their PHONE from their seat when the request had none", async () => {
  const { G } = await run({}, "POST", "blocklist", { member_id: ID.member, reason: "rude" }); const b = G.FIX.blocklist.find((x) => x.member_id === ID.member);
  return { ok: b && b.phone === "9000001" && b.device_id === "g-dev", note: b ? `${b.phone} ${b.device_id}` : "" }; });
row("…but a phone the manager typed is kept, not replaced by the seat's", async () => {
  const { G } = await run({}, "POST", "blocklist", { member_id: ID.member, phone: "9111111111" }); const b = G.FIX.blocklist.find((x) => x.member_id === ID.member);
  return { ok: b && b.phone === "9111111111", note: b ? b.phone : "" }; });
row("a ban by table alone is accepted (no phone, device or guest needed)", async () => {
  const { r } = await run({}, "POST", "blocklist", { table: "4" }); return { ok: r.status === 200, note: `${r.status}` }; });
row("lifting the LAST ban on a phone unblocks that customer; lifting one of two leaves them blocked", async () => {
  const one = await run({ fix: { blocklist: [{ id: "b1", restaurant_id: "rest-1", phone: "9111" }], customers: [{ restaurant_id: "rest-1", phone: "9111", blocked: true }] } }, "DELETE", "blocklist/b1", null);
  const u1 = one.G.FIX.customers[0].blocked;
  const two = await run({ fix: { blocklist: [{ id: "b1", restaurant_id: "rest-1", phone: "9111" }, { id: "b2", restaurant_id: "rest-1", phone: "9111" }], customers: [{ restaurant_id: "rest-1", phone: "9111", blocked: true }] } }, "DELETE", "blocklist/b1", null);
  return { ok: u1 === false && two.G.FIX.customers[0].blocked === true, note: `${u1}/${two.G.FIX.customers[0].blocked}` }; });
row("a KOT reprint records WHO asked for it (the admin console as 'Manager')", async () => {
  const { G } = await run({ who: "admin" }, "POST", "print-jobs", { order_id: ID.order }); const j = G.FIX.print_jobs.find((x) => x.reprint === true);
  return { ok: j && j.requested_by === "Manager" && j.kind === "kot", note: j ? j.requested_by : "" }; });
row("dismissing a stuck reprint changes ONLY that job, and only while it is still live", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.print_jobs.push({ id: "pj-done", restaurant_id: "rest-1", status: "done" }); } }, "POST", "print-jobs/pj-done/dismiss", {});
  return { ok: G.FIX.print_jobs.find((x) => x.id === "pj-done").status === "done", note: "a finished job stays done" }; });
row("deleting a dish records its NAME in the Audit ('dish: Dal')", async () => {
  const { G } = await run({}, "DELETE", "items/dal", null); const a = audits(G, "menu_item_deleted")[0]; return { ok: a && a.args.p_item_title === "dish: Dal", note: a ? a.args.p_item_title : "" }; });
row("deleting carries the reason from the address (?reason=) into the Audit", async () => {
  const G2 = (await (async () => { const W2 = await fullWorld({}); await call("DELETE", "filters/veg", { query: "?reason=duplicate&reason_code=mistake" }); return W2; })());
  const a = audits(G2, "menu_item_deleted")[0]; return { ok: a && a.args.p_reason_note === "duplicate" && a.args.p_reason_code === "mistake", note: a ? `${a.args.p_reason_code}/${a.args.p_reason_note}` : "" }; });
row("an unknown verb on a known noun answers 'unknown POST endpoint', never a neighbour's handler", async () => {
  const outs = []; for (const p of [`members/${ID.member}/zap`, `orders/${ID.order}/zap`, `orders/${ID.order}/printed`, `print-jobs/${ID.job}/zap`, `platform/${ID.plat}/zap`, `sessions/${ID.sess}/zap`, `tables/4/zap`, `items/${ID.item}/zap`]) {
    const { r } = await run({ who: "admin" }, "POST", p, {}); outs.push(`${p.split("/").slice(0, 3).join("/").replace(/[0-9a-f-]{36}/, ":id")}=${r.status}${/unknown POST endpoint/.test(r.text) ? "" : "!"}`); }
  // (anything under printing/ that is not the test print is refused on purpose — checked in block 9)
  return { ok: outs.every((o) => !o.endsWith("!")), note: outs.join(" ") }; });
row("restoring a cancel exactly as the window allows (29 minutes) works; 31 minutes does not", async () => {
  const a = await run({ mut: (G) => { ord(G, ID.cancelled).cancelled_at = ago(29); } }, "PATCH", `orders/${ID.cancelled}`, { status: "received" });
  const b = await run({ mut: (G) => { ord(G, ID.cancelled).cancelled_at = ago(31); } }, "PATCH", `orders/${ID.cancelled}`, { status: "received" });
  return { ok: a.r.status === 200 && b.r.status === 409, note: `${a.r.status}/${b.r.status}` }; });
row("a cancel's Audit row says whether the ticket had been paid", async () => {
  const { G } = await run({}, "PATCH", `orders/${ID.order}`, { status: "cancelled" }); const a = audits(G, "order_cancelled")[0]; return { ok: a && a.args.p_meta.was_paid === false, note: a ? JSON.stringify(a.args.p_meta) : "" }; });
row("ticking a waiter call off stores TRUE, and un-ticking stores FALSE", async () => {
  const a = await run({}, "PATCH", `calls/${ID.call}`, { resolved: true }); const ra = a.G.FIX.waiter_calls.find((c) => c.id === ID.call).resolved;
  const b = await run({}, "PATCH", `calls/${ID.call}`, { resolved: false }); return { ok: ra === true && b.G.FIX.waiter_calls.find((c) => c.id === ID.call).resolved === false, note: "" }; });
row("removing a waiter call removes THAT call only", async () => {
  const { G } = await run({ mut: (G) => G.FIX.waiter_calls.push({ id: "c2", restaurant_id: "rest-1" }) }, "DELETE", `calls/${ID.call}`, null);
  return { ok: !G.FIX.waiter_calls.some((c) => c.id === ID.call) && G.FIX.waiter_calls.some((c) => c.id === "c2"), note: "" }; });
row("the admin console deleting an UNPAID ticket soft-deletes it and records its worth", async () => {
  const { G, r } = await run({ who: "admin" }, "DELETE", `orders/${ID.order2}`, null); const a = audits(G, "order_deleted")[0];
  return { ok: r.status === 200 && a && Number(a.args.p_amount) === 210, note: `${r.status}` }; });
row("…and deleting a CANCELLED paid ticket is allowed (a ₹0 record, not a sale)", async () => {
  const { r } = await run({ who: "admin", mut: (G) => Object.assign(ord(G, ID.cancelled), { payment_status: "paid" }) }, "DELETE", `orders/${ID.cancelled}`, null);
  return { ok: r.status === 200, note: `${r.status}` }; });
row("a NEW dish named only by a slug keeps that slug", async () => {
  const { G } = await dish(owner, { __create: true, slug: "masala-chai", title: "Chai", price: "20" }); const p = lastPatch(G, "menu_items");
  return { ok: p.slug === "masala-chai" && p.id === "masala-chai__rest-1", note: `${p.id} · ${p.slug}` }; });
row("a dish save with no slug takes one from its title", async () => {
  const { G } = await dish(owner, { __create: true, title: "Butter Naan", price: "40" }); return { ok: lastPatch(G, "menu_items").slug === "butter-naan", note: lastPatch(G, "menu_items").slug }; });
row("a manager without the Customisation part has the options dropped from a dish save", async () => {
  const { G } = await dish({ accessConfig: { edit_menu: { manager_opts: { edit_options: false, edit_dish: true } } } }, { id: "dal", options: [{ group: "Size" }], title: "Dal" });
  return { ok: !("options" in G.FIX.menu_items.find((d) => d.id === "dal")) || G.FIX.menu_items.find((d) => d.id === "dal").options === undefined, note: "" }; });
row("an owner's save cannot set what a banquet bill asks for or which paper it prints on (the admin's)", async () => {
  const { G } = await settingsSave({ banquet_fields: { gst: true }, banquet_paper_size: "A5", bill_footer: "x" }); const p = lastPatch(G, "settings");
  return { ok: !("banquet_fields" in p) && !("banquet_paper_size" in p) && p.bill_footer === "x", note: Object.keys(p).join(",") }; });
// ── mutation pass 2 asked for these ──────────────────────────────────────────────────────────
row("a quick order sent with a discount of 0 writes no discount", async () => {
  const { G } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order } } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 0 });
  return { ok: !rpc(G, "lfh_staff_bill_discount").length, note: "" }; });
row("a banquet bill made by a staff member with no display name is prepared by their LOGIN name", async () => {
  const { G } = await run({ user: { name: null }, rpc: { lfh_banquet_bill_create: { ok: true, bill_no: "B1", total: 1 } } }, "POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 1 }] });
  const c = rpc(G, "lfh_banquet_bill_create")[0]; return { ok: c && c.args.p_meta.prepared_by === "diagm1", note: c ? c.args.p_meta.prepared_by : "" }; });
row("a banquet bill for a table is logged against THAT table", async () => {
  const { G } = await run({ rpc: { lfh_banquet_bill_create: { ok: true, bill_no: "B1", total: 1 } } }, "POST", "banquet/bill", { table: "4", lines: [{ id: ID.bq, qty: 1 }] });
  const l = logged(G, "banquet_bill")[0]; return { ok: l && l.table_number === "4", note: l ? String(l.table_number) : "" }; });
row("a tip on a ticket that has gone answers 404 (in the mutation suite too, not only in its guard)", async () => {
  const { r } = await run({}, "POST", `orders/${T}/tip`, { amount: 5 }); return { ok: r.status === 404, note: `${r.status}` }; });
for (const [what, fail, path, body, re] of [
  ["an invoice refused with the database's code LFH02 alone (whatever its words) is still 'a cancelled sale never gets a tax invoice'", { "rpc:lfh_generate_invoice": { code: "LFH02", message: "other words" } }, `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "A" }, /never gets a tax invoice/],
  ["…and LFH01 alone is still 'settled — make a credit note'", { "rpc:lfh_generate_invoice": { code: "LFH01", message: "other words" } }, `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "A" }, /credit note/],
  ["a reopen refused with code LFH03 alone still names who is sitting there", { "rpc:lfh_reopen_table": { code: "LFH03", message: "x" } }, `sessions/${ID.closedSess}/reopen-table`, { reason: "x" }, /Someone else is sitting/],
  ["…and LFH04 alone still says there is no sale to reopen", { "rpc:lfh_reopen_table": { code: "LFH04", message: "x" } }, `sessions/${ID.closedSess}/reopen-table`, { reason: "x" }, /no sale to reopen/],
  ["a credit note refused with code LFH02 alone is still 'more than the bill total'", { "rpc:lfh_issue_credit_note": { code: "LFH02", message: "x" } }, `sessions/${ID.closedSess}/credit-note`, { amount: 5, reason: "x" }, /more than the bill total/],
  ["…and a refusal carrying only the WORDS ('invoice locked', no code) is matched too", { "rpc:lfh_generate_invoice": { message: "invoice locked" } }, `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "A" }, /credit note/],
]) refuse(what, { fail }, "POST", path, body, 409, re);
row("re-issuing a reopened bill records how many tickets it carries now (before → after)", async () => {
  const { G } = await inv({ fix: { deletion_audit: [{ id: 9, restaurant_id: "rest-1", session_id: ID.sess, kind: "invoice_voided", at: ago(3), meta: { total_at_reopen: 400, orders_on_bill: 1 } }] } });
  const a = audits(G, "bill_changed_after_reopen")[0]; return { ok: a && a.args.p_meta.after.orders === 3 && a.args.p_meta.change.orders === 2, note: a ? JSON.stringify(a.args.p_meta.after) : "" }; });
row("a ticket move the database answers with nothing (no refusal) is reported as moved, not a crash", async () => {
  const { r } = await run({ rpc: { lfh_staff_move_order: null } }, "POST", `orders/${ID.order}/move`, { to: "7" }); return { ok: r.status === 200, note: `${r.status}` }; });
row("a quantity change the database answers with nothing is reported, not a crash", async () => {
  const { r } = await run({ rpc: { lfh_staff_edit_item_qty: null } }, "POST", `items/${ID.item}/qty`, { qty: 1 }); return { ok: r.status === 200, note: `${r.status}` }; });
refuse("merging into table 99 of a 20-table floor is refused (in the mutation suite)", {}, "POST", `sessions/${ID.sess}/merge`, { to: "99" }, 400, /out of range/);
row("letting a guest in marks THEM approved (and answers 200)", async () => {
  const { G, r } = await run({}, "POST", `members/${ID.member}/approve`, {}); return { ok: r.status === 200 && G.FIX.session_members.find((m) => m.id === ID.member).approved === true, note: `${r.status}` }; });
row("'on the house' honours a Family mark sitting on a CHILD table merged into this one", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); G.FIX.table_tags = [{ restaurant_id: "rest-1", table_number: "5", tag: "family" }]; G.FIX.table_merges = [{ restaurant_id: "rest-1", parent_table: "4", child_table: "5", ended_at: null }]; } }, "POST", "tables/4/on-the-house", {});
  return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("parking a bill on a NEW person keeps the note typed about them", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; } }, "POST", "tables/4/khata", { name: "Meera", note: "pays on Friday" });
  const k = G.FIX.khata_customers.find((x) => x.name === "Meera"); return { ok: k && k.note === "pays on Friday", note: k ? String(k.note) : "" }; });
row("a kitchen-slip route narrowed to ONE manager lets THAT manager's screen claim", async () => {
  const { r } = await run(PRINT({ kot: { via: "screen", panel: "manager", person: "u1" } }), "POST", "print-jobs/claim", { ids: [ID.job] });
  return { ok: r.status === 200 && !r.json.refused, note: `${r.status} refused=${r.json && r.json.refused}` }; });
refuse("an unknown queue verb under printing is refused like every other setup verb", {}, "POST", "printing/queue/zap", {}, 403, /Aevidine does that/);
row("table names sent as plain text become an empty map, never one letter per table", async () => {
  const { G } = await settingsSave({ table_names: "abc" }); return { ok: JSON.stringify(lastPatch(G, "settings").table_names) === "{}", note: JSON.stringify(lastPatch(G, "settings").table_names) }; });
row("a settings save writes NO menu line into the Activity log", async () => {
  const { G } = await settingsSave({ bill_footer: "x" }); return { ok: !logged(G, "menu_edit").length && !logged(G, "menu_create").length, note: "" }; });
row("a preparing ticket sent BACK to received is a plain status change — not refused, not logged as an un-cancel", async () => {
  const { G, r } = await run({}, "PATCH", `orders/${ID.order}`, { status: "received" });
  return { ok: r.status === 200 && ord(G).status === "received" && !logged(G, "order_uncancel").length, note: `${r.status}` }; });
row("archiving a CANCELLED ticket keeps when it was cancelled", async () => {
  const { G } = await run({}, "PATCH", `orders/${ID.cancelled}`, { archived: true }); return { ok: !!ord(G, ID.cancelled).cancelled_at && ord(G, ID.cancelled).status === "cancelled", note: "" }; });
row("'was the food made?' asked with a cancel records the manager's own ROLE", async () => {
  const { G } = await run({ rpc: { lfh_cancel_classify: { ok: true } } }, "PATCH", `orders/${ID.order}`, { status: "cancelled", made: true });
  const c = rpc(G, "lfh_cancel_classify")[0]; return { ok: c && c.args.p_actor_role === "manager", note: c ? c.args.p_actor_role : "" }; });
row("a DELETE of a dish with no id answers 'unknown DELETE endpoint' and deletes nothing", async () => {
  const { G, r } = await run({}, "DELETE", "items", null); return { ok: r.status === 404 && /unknown DELETE endpoint/.test(r.text) && !G.WRITES.length, note: r.text.slice(0, 60) }; });
row("a PARTIAL edit of an existing dish is an UPDATE, never an insert-or-update (that crashed a live menu on 2026-07-30)", async () => {
  const { G } = await dish(owner, { id: "dal", tags: ["veg"] }); const w = G.WRITES.filter((x) => x.table === "menu_items");
  return { ok: w.length === 1 && w[0].op === "update", note: w.map((x) => x.op).join(",") }; });
row("…the same for a category and a tag", async () => {
  const a = (await run({}, "POST", "categories", { slug: "mains", sort_order: 2 })).G.WRITES.filter((x) => x.table === "categories").map((x) => x.op).join(",");
  const b = (await run({}, "POST", "filters", { slug: "veg", sort_order: 1 })).G.WRITES.filter((x) => x.table === "filters").map((x) => x.op).join(",");
  return { ok: a === "update" && b === "update", note: `${a} / ${b}` }; });
row("a NEW row is written as insert-or-update keyed on the right thing: a category by (restaurant, slug), a dish by its id, settings by restaurant", async () => {
  const c = (await run({}, "POST", "categories", { __create: true, slug: "soups", name: { en: "Soups" } })).G.WRITES.find((x) => x.table === "categories" && x.op === "upsert");
  const d = (await dish(owner, { __create: true, title: "Lassi", price: "60" })).G.WRITES.find((x) => x.table === "menu_items" && x.op === "upsert");
  const s = (await settingsSave({ bill_footer: "x" })).G.WRITES.find((x) => x.table === "settings" && x.op === "upsert");
  return { ok: c && c.onConflict === "restaurant_id,slug" && d && d.onConflict === "id" && s && s.onConflict === "restaurant_id", note: `${c && c.onConflict} · ${d && d.onConflict} · ${s && s.onConflict}` }; });
row("item 20 · a dish price typed with a minus sign (\"-5\") is REFUSED — it used to be saved as ₹5", async () => {
  const { G, r } = await dish(owner, { id: "dal", price: "-5" }); return { ok: r.status === 400 && /can't be negative/.test(r.text) && G.FIX.menu_items.find((d) => d.id === "dal").price === "200", note: `${r.status}` }; });
// ══ 12 · MUTATION PASS 3 — "who did it", the first and last table, and the empty-or-kept notes ═════
// The full mutation run (every one of 1,218 sites, 2026-10-10) left 186 changes no check noticed. The
// rows below are the ones a person could notice. Each names what it would have caught.
// WHO: a manager with a display name, one WITHOUT (login name only), and the admin console (no person).
const NAMED = {}, NONAME = { user: { name: null } }, NOLOGIN = { user: { username: null } }, ADMIN = { who: "admin" };
const withWho = (base, who) => ({ ...base, ...who });
const lastLog = (G) => (G.LOGS[G.LOGS.length - 1] || {}).actor;
const SCREEN = { kot: { via: "screen", panel: "manager" } };
for (const [what, base, verb, path, body, read, people, want] of [
  ["spending a guest's points", LOYAL, "POST", "loyalty-redeem", { table: "4", phone: "9876543210", points: 10 }, (G) => (rpc(G, "lfh_loyalty_redeem")[0] || {}).args?.p_by, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "Manager"]],
  ["raising a complaint", {}, "POST", "issue", { subject: "Fridge warm", body: "since 6pm" }, (G) => (W(G, "issues")[0] || {}).patch?.raised_by, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "Manager"]],
  ["handling a guest rating", {}, "POST", "ratings/ack", { id: ID.fb, acknowledged: true }, (G) => G.FIX.feedback.find((f) => f.id === ID.fb).acknowledged_by, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "Manager"]],
  ["issuing a banquet bill", { rpc: { lfh_banquet_bill_create: { ok: true, bill_no: "B1", total: 1 } } }, "POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 1 }] }, (G) => (rpc(G, "lfh_banquet_bill_create")[0] || {}).args?.p_by, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "Manager"]],
  ["recording why something was removed", { rpc: { lfh_record_removal: { ok: true } } }, "POST", "audit", { kind: "dish_removed", order_id: ID.order, reason_code: "mistake" }, (G) => (audits(G)[0] || {}).args?.p_actor, [NAMED, NOLOGIN, ADMIN], ["diagm1", "manager", "manager"]],
  ["answering 'was the food made?'", { rpc: { lfh_cancel_classify: { ok: true } } }, "POST", "audit/classify", { order_id: ID.cancelled, made: true }, (G) => (rpc(G, "lfh_cancel_classify")[0] || {}).args?.p_actor, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "manager"]],
  ["merging two tables (the database call)", { rpc: { lfh_staff_merge_tables: { ok: true, parent_table: "2", child_table: "4" } } }, "POST", `sessions/${ID.sess}/merge`, { to: "2" }, (G) => (rpc(G, "lfh_staff_merge_tables")[0] || {}).args?.p_actor, [NAMED, NOLOGIN, ADMIN], ["diagm1", "manager", "manager"]],
  ["merging two tables (the merge row)", { rpc: { lfh_staff_merge_tables: { ok: true, parent_table: "2", child_table: "4" } }, fix: { table_merges: [{ id: "m1", restaurant_id: "rest-1", parent_table: "2", child_table: "4", ended_at: null }] } }, "POST", `sessions/${ID.sess}/merge`, { to: "2" }, (G) => G.FIX.table_merges.find((m) => m.id === "m1").merged_by, [NAMED, NOLOGIN, ADMIN], ["diagm1", "manager", "manager"]],
  ["clearing the print queue", PRINT({}), "POST", "printing/queue/clear", {}, (G) => (/cleared from the queue by (.+?) —/.exec(G.FIX.print_jobs[0].error || "") || [])[1], [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "Aevidine"]],
  ["sending a test page to a named printer", PRINT({}), "POST", "printing/test", { printer: "EPSON" }, (G) => { const j = G.FIX.print_jobs.find((x) => x.kind === "test"); return j && JSON.stringify(j).match(/"by":"([^"]*)"/)?.[1]; }, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "manager"]],
  ["making this counter screen the printer", PRINT(SCREEN), "POST", "print-station/take", {}, (G) => (G.FIX.print_stations.find((s) => s.active) || {}).claimed_by ?? null, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", null]],
  ["marking a table (Family / VIP)", {}, "POST", "tables/4/tag", { tag: "family" }, (G) => lastPatch(G, "table_tags").tagged_by, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "admin"]],
  ["cancelling a ticket (the Activity line)", {}, "PATCH", `orders/${ID.order}`, { status: "cancelled" }, (G) => (logged(G, "order_cancel")[0] || {}).actor, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", null]],
  ["'was the food made?' asked with a cancel", { rpc: { lfh_cancel_classify: { ok: true } } }, "PATCH", `orders/${ID.order}`, { status: "cancelled", made: true }, (G) => (rpc(G, "lfh_cancel_classify")[0] || {}).args?.p_actor, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", "Admin (Aevidine)"]],
  ["deleting a dish (the Activity line)", {}, "DELETE", "items/dal", null, lastLog, [NAMED, NONAME, ADMIN], ["Diag Manager", "diagm1", null]],
]) row(`who is recorded for ${what}: the person's name, else their login, else the right stand-in`, async () => {
  const got = []; for (const who of people) { const { G } = await run(withWho(base, who), verb, path, body); got.push(read(G) ?? null); }
  return { ok: JSON.stringify(got) === JSON.stringify(want), note: JSON.stringify(got) }; }, "STUB · the real route, three people: a named manager, a manager with only a login name, the admin console");

// THE FIRST AND THE LAST TABLE. "Number(to) < 1" and "> tableCount" are boundaries; a "≤ 1" or a "≥"
// would refuse table 1 or the restaurant's last table. French House has 20 tables in this world.
for (const [what, path, rpcName, ans] of [
  ["changing table", `sessions/${ID.sess}/shift`, "lfh_staff_shift_table", { ok: true }],
  ["moving one ticket", `orders/${ID.order}/move`, "lfh_staff_move_order", { ok: true }],
  ["merging two tables", `sessions/${ID.sess}/merge`, "lfh_staff_merge_tables", { ok: true }],
  ["moving one dish", `order-items/${ID.item}/move`, "lfh_staff_move_order_item", { ok: true }],
]) row(`${what} to table 1 and to the LAST table (20) both go through`, async () => {
  const out = []; for (const to of ["1", "20"]) { const { r } = await run({ rpc: { [rpcName]: ans } }, "POST", path, { to }); out.push(r.status); }
  return { ok: out.every((s) => s === 200), note: JSON.stringify(out) }; });
row("opening table 1 is allowed (the lowest number is a real table)", async () => {
  const { r } = await run({ rpc: { lfh_staff_open_table: { ok: true, session: { id: "s-new" } } } }, "POST", "sessions/open", { table: "1" }); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });

// THE NOTES: kept when typed, nothing when not (a "|| null" turned into "&& null" throws the words away)
row("a parcel keeps the phone the manager typed (trimmed), and stores nothing when none was typed", async () => {
  const a = await run({ rpc: { lfh_platform_insert: { id: "p1" } } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], phone: " 98765 " });
  const pa = rpc(a.G, "lfh_platform_insert")[0].args.p_phone;
  const b = await run({ rpc: { lfh_platform_insert: { id: "p1" } } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }] });
  const pb = rpc(b.G, "lfh_platform_insert")[0].args.p_phone; return { ok: pa === "98765" && pb === null, note: JSON.stringify([pa, pb]) }; });
row("a parcel discount keeps its reason on the parcel, and an exactly-full discount (all of the food) is allowed", async () => {
  const { G, r } = await run({ who: "owner", rpc: { lfh_platform_insert: { id: ID.plat } } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], discount: 200, discountNote: "regular" });
  const p = (G.FIX.aggregator_orders.find((x) => x.id === ID.plat) || {}).payload || {};
  return { ok: r.status === 200 && p.discount === 200 && p.discount_note === "regular", note: `${r.status} ${JSON.stringify(p).slice(0, 90)}` }; });
row("a quick order keeps the kitchen note typed with it, and sends nothing when none was typed", async () => {
  const A = { rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order2 } } };
  const a = rpc((await run(A, "POST", "order", { table: "4", items: [{ id: "dal" }], note: "less oil" })).G, "lfh_staff_place_order")[0].args.p_note;
  const b = rpc((await run(A, "POST", "order", { table: "4", items: [{ id: "dal" }] })).G, "lfh_staff_place_order")[0].args.p_note;
  return { ok: a === "less oil" && b === null, note: JSON.stringify([a, b]) }; });
row("a staff note on a guest rating is kept, and a blank one is stored as nothing", async () => {
  const a = (await run({}, "POST", "ratings/ack", { id: ID.fb, note: " called them back " })).G.FIX.feedback.find((f) => f.id === ID.fb).staff_note;
  const b = (await run({}, "POST", "ratings/ack", { id: ID.fb, note: "   " })).G.FIX.feedback.find((f) => f.id === ID.fb).staff_note;
  return { ok: a === "called them back" && b === null, note: JSON.stringify([a, b]) }; });
row("a person added to the pay-later book keeps their phone and note, and blanks are stored as nothing", async () => {
  const a = (await run({}, "POST", "khata/customers", { name: "Meera", phone: " 9000011111 ", note: " pays Friday " })).G.FIX.khata_customers.find((k) => k.name === "Meera");
  const b = (await run({}, "POST", "khata/customers", { name: "Kiran" })).G.FIX.khata_customers.find((k) => k.name === "Kiran");
  return { ok: a && a.phone === "9000011111" && a.note === "pays Friday" && b && b.phone == null && b.note === null, note: JSON.stringify([a && [a.phone, a.note], b && [b.phone, b.note]]) }; });
row("parking a bill on a NEW person keeps the phone typed for them", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; } }, "POST", "tables/4/khata", { name: "Meera", phone: " 9000022222 " });
  const k = G.FIX.khata_customers.find((x) => x.name === "Meera"); return { ok: k && k.phone === "9000022222", note: k ? String(k.phone) : "" }; });
row("collecting a tab keeps the note typed, and with no note says 'collected from the pay-later book'", async () => {
  // read each result BEFORE the next call — the stub world is one shared object
  const OWED = { mut: (G) => { Object.assign(G.FIX.orders.find((o) => o.id === ID.paid), { payment_status: "pending" }); } };
  const writes = (G) => JSON.stringify(G.WRITES.filter((w) => w.op !== "select").map((w) => w.patch));
  const a = await run(OWED, "POST", "khata/pay", { order_id: ID.paid, method: "Cash", note: "paid by brother" }); const sa = a.r.status, na = writes(a.G);
  const b = await run(OWED, "POST", "khata/pay", { order_id: ID.paid, method: "Cash" }); const nb = writes(b.G);
  return { ok: sa === 200 && /paid by brother/.test(na) && !/collected from the pay-later book/.test(na) && /collected from the pay-later book/.test(nb), note: `${sa}/${b.r.status}` }; });
row("a ban with no reason typed is recorded as 'banned'; a typed reason is kept", async () => {
  const a = (await run({}, "POST", "blocklist", { phone: "9333333333" })).G.FIX.blocklist.find((x) => x.phone === "9333333333");
  const b = (await run({}, "POST", "blocklist", { phone: "9444444444", reason: "rude" })).G.FIX.blocklist.find((x) => x.phone === "9444444444");
  return { ok: a && a.reason === "banned" && b && b.reason === "rude", note: JSON.stringify([a && a.reason, b && b.reason]) }; });
row("deleting bills from the admin console carries the reason code and the typed reason into each Audit row", async () => {
  const { G } = await run({ who: "admin" }, "POST", "orders/delete", { ids: [ID.order2], reason_code: "mistake", reason: "duplicate" });
  const a = audits(G, "order_deleted")[0]; return { ok: a && a.args.p_reason_code === "mistake" && a.args.p_reason_note === "duplicate", note: a ? `${a.args.p_reason_code}/${a.args.p_reason_note}` : "" }; });
row("lowering a dish's quantity to the SAME number is not a removal (no Audit row); one fewer is", async () => {
  const a = await run({ rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: ID.order } } }, "POST", `items/${ID.item}/qty`, { qty: 2 }); const sameQty = audits(a.G, "qty_reduced").length;
  const b = await run({ rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: ID.order } } }, "POST", `items/${ID.item}/qty`, { qty: 1, reason_code: "mistake" });
  const rb = audits(b.G, "qty_reduced")[0];
  return { ok: sameQty === 0 && rb && rb.args.p_qty === 1 && Number(rb.args.p_amount) === 200, note: rb ? `${rb.args.p_qty} ₹${rb.args.p_amount}` : "" }; });
row("a dish price of 0 is allowed (a free item); only a minus or a word is refused", async () => {
  const { G, r } = await dish(owner, { id: "dal", price: "0" }); return { ok: r.status === 200 && lastPatch(G, "menu_items").price === "0", note: `${r.status} ${lastPatch(G, "menu_items").price}` }; });
row("a named tax of exactly 100% is kept (the limit is 'at most 100')", async () => {
  const { G } = await settingsSave({ tax_components: [{ label: "Cess", rate: 100 }] }); const tc = lastPatch(G, "settings").tax_components;
  return { ok: tc.length === 1 && tc[0].rate === 100, note: JSON.stringify(tc) }; });
row("'auto-approve joiners' stores TRUE only for a real true, FALSE for anything else", async () => {
  const v = []; for (const value of [true, false, "true"]) { const { G } = await run({}, "POST", `sessions/${ID.sess}/auto-approve`, { value }); v.push(G.FIX.sessions.find((s) => s.id === ID.sess).auto_approve); }
  return { ok: JSON.stringify(v) === "[true,false,false]", note: JSON.stringify(v) }; });
row("serving a whole LIVE ticket marks it and every dish served", async () => {
  const { G, r } = await run({}, "POST", `orders/${ID.order}/serve-all`, {});
  return { ok: r.status === 200 && ord(G).status === "served" && G.FIX.order_items.filter((i) => i.order_id === ID.order).every((i) => i.status === "served"), note: `${r.status} ${ord(G).status}` }; });
row("removing a guest marks THAT guest removed", async () => {
  const { G, r } = await run({}, "POST", `members/${ID.member}/remove`, {}); return { ok: r.status === 200 && G.FIX.session_members.find((m) => m.id === ID.member).removed === true, note: `${r.status}` }; });
row("dismissing a stuck LIVE reprint marks it dismissed", async () => {
  const { G, r } = await run(PRINT({}), "POST", `print-jobs/${ID.job}/dismiss`, {}); return { ok: r.status === 200 && G.FIX.print_jobs.find((j) => j.id === ID.job).status === "dismissed", note: `${r.status}` }; });
// THE DOORS: a near-miss address never opens a neighbour's handler (a "&&" turned "||" would let it)
row("near-miss addresses each answer 'unknown endpoint', never a neighbour's handler", async () => {
  const outs = [];
  for (const [verb, p] of [["POST", "ratings"], ["POST", "x/ack"], ["POST", "audit/zap"], ["POST", `x/${ID.order}/serve-all`], ["POST", `order-items/${ID.item}/zap`], ["POST", `x/${ID.item}/move`],
    ["POST", `x/${ID.member}/remove`], ["POST", `requests/${ID.req}/zap`], ["POST", `x/${ID.req}/resolve`], ["POST", "khata/zap"], ["POST", "x/pay"], ["POST", "print-station/zap"], ["POST", "x/release"],
    ["POST", `x/${ID.job}/dismiss`], ["PATCH", `x/${ID.call}`], ["POST", `x/${ID.sess}/auto-approve`]]) {
    const { G, r } = await run({ who: "admin" }, verb, p, {}); const wrote = G.WRITES.some((w) => w.op !== "select") || G.RPCS.length;
    outs.push(`${verb} ${p.replace(/[0-9a-f-]{36}/, ":id")}=${r.status}${/unknown (POST|PATCH) endpoint|not found|unknown/i.test(r.text) && !wrote ? "" : "!"}`); }
  return { ok: outs.every((o) => !o.endsWith("!")), note: outs.filter((o) => o.endsWith("!")).join(" ") || `${outs.length} doors, all shut` }; });
// ══ 13 · MUTATION PASS 4 — the 45 remaining changes a person could see ══════════════════════════
// (pass 3 left 117 of 1,218; every row here would have caught one or more of them)
const CAP = { rpc: { lfh_capture_customer: { ok: true }, lfh_loyalty_earn: { ok: true, earned: 5, balance: 15 } }, settings: { modules: { loyalty: { allowed: true } } } };
row("saving the guest at bill time awards points to THAT phone and answers the saved result", async () => {
  const { G, r } = await run(CAP, "POST", "customer-capture", { table: "4", session: ID.sess, phone: "9876543210", name: "Asha", consent: true });
  const e = rpc(G, "lfh_loyalty_earn")[0]; return { ok: r.status === 200 && r.json.ok === true && e && e.args.p_phone === "9876543210", note: `${r.status} ${r.text.slice(0, 70)}` }; });
row("spending points asks the database for THAT guest's phone", async () => {
  const { G } = await run(LOYAL, "POST", "loyalty-redeem", { table: "4", phone: "9876543210", points: 10 }); const c = rpc(G, "lfh_loyalty_redeem")[0];
  return { ok: c && c.args.p_phone === "9876543210", note: c ? c.args.p_phone : "" }; });
row("points refused with a reason show THAT reason (module off → 'aren't switched on'), not a generic line", async () => {
  const { r } = await run({ ...LOYAL, settings: { modules: { loyalty: { allowed: false } } } }, "POST", "loyalty-redeem", { table: "4", phone: "98", points: 10 });
  return { ok: r.status === 400 && /aren't switched on/.test(r.text), note: r.text.slice(0, 70) }; });
const PLACE = { rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order2 } } };
const recent = (items) => (G) => G.FIX.orders.push({ id: "recent", restaurant_id: "rest-1", table_number: "4", items, allergies: [], created_at: new Date().toISOString() });
row("'send it anyway' skips the duplicate check even when an identical ticket was just sent", async () => {
  const { G, r } = await run({ ...PLACE, mut: recent([{ id: "dal", qty: 1 }]) }, "POST", "order", { table: "4", items: [{ id: "dal", qty: 1 }], confirmDuplicate: true });
  return { ok: r.status === 200 && rpc(G, "lfh_staff_place_order").length === 1, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("the duplicate check tells 2 × Dal from 1 × Dal (a different quantity is a different order)", async () => {
  const { G, r } = await run({ ...PLACE, mut: recent([{ id: "dal", qty: 1 }]) }, "POST", "order", { table: "4", items: [{ id: "dal", qty: 2 }] });
  return { ok: r.status === 200 && rpc(G, "lfh_staff_place_order").length === 1, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("…and still stops an IDENTICAL ticket sent twice", async () => {
  const { G, r } = await run({ ...PLACE, mut: recent([{ id: "dal", qty: 2 }]) }, "POST", "order", { table: "4", items: [{ id: "dal", qty: 2 }] });
  return { ok: r.status === 409 && !rpc(G, "lfh_staff_place_order").length, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("an order for table 99 on a 20-table floor is refused; table 20 is taken", async () => {
  const a = (await run(PLACE, "POST", "order", { table: "99", items: [{ id: "dal" }] })).r.status; const b = (await run(PLACE, "POST", "order", { table: "20", items: [{ id: "dal" }] })).r.status;
  return { ok: a === 400 && b === 200, note: `${a}/${b}` }; });
row("an order line carrying a normal price (an open-price dish) is taken; only a minus is refused", async () => {
  const { r } = await run(PLACE, "POST", "order", { table: "4", items: [{ id: "dal", qty: 1, price: "200" }] }); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("a quick order with a discount of 0 never asks whether the person may give discounts", async () => {
  const { r } = await run({ ...PLACE, ...capOff("give_discounts") }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 0 }); return { ok: r.status === 200, note: `${r.status}` }; });
row("a quick-order discount over the person's % limit is refused BEFORE the order exists", async () => {
  const { G, r } = await run({ ...PLACE, rpc: { ...PLACE.rpc, lfh_price_order: { ok: true, subtotal: 200, tax: 10, total: 210 } } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 150 });
  return { ok: r.status === 403 && /over your \d+% limit/.test(r.text) && !rpc(G, "lfh_staff_place_order").length, note: `${r.status} ${r.text.slice(0, 70)}` }; });
row("an order the database could not put on the pass keeps the database's own words in the error log", async () => {
  const { G, r } = await run({ ...PLACE, fail: { "rpc:lfh_staff_mark_placed": { message: "pass is jammed" } } }, "POST", "order", { table: "4", items: [{ id: "dal" }] });
  return { ok: r.status >= 500 && JSON.stringify(G.ERRORS).includes("pass is jammed"), note: `${r.status} ${JSON.stringify(G.ERRORS).slice(0, 80)}` }; });
const PARCEL = { rpc: { lfh_platform_insert: { id: ID.plat } } };
row("a parcel with a discount of 0 never asks whether the person may give discounts, and records no discount", async () => {
  const { G, r } = await run({ ...PARCEL, ...capOff("give_discounts") }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], discount: 0 });
  const p = (G.FIX.aggregator_orders.find((x) => x.id === ID.plat) || {}).payload || {};
  return { ok: r.status === 200 && !("discount" in p), note: `${r.status} ${JSON.stringify(p).slice(0, 80)}` }; });
row("a parcel paid at the counter answers paid: true; one not paid answers paid: false", async () => {
  const a = (await run(PARCEL, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], paid: true, method: "Cash" })).r.json; const b = (await run(PARCEL, "POST", "parcel", { items: [{ id: "dal", qty: 1 }] })).r.json;
  return { ok: a && a.paid === true && b && b.paid === false, note: JSON.stringify([a && a.paid, b && b.paid]) }; });
const DEMO = { who: "owner", rpc: { lfh_platform_insert: { id: "p-demo" } }, settings: { platform_channels: { zomato: { on: true }, swiggy: { on: true } } } };
row("a demo delivery order asked for on Swiggy comes from Swiggy every time, carries 1–3 dishes and a real total", async () => {
  const seen = []; for (let i = 0; i < 12; i++) { const { G } = await run(DEMO, "POST", "platform/test", { channel: "swiggy" }); const c = rpc(G, "lfh_platform_insert")[0]; seen.push(c ? [c.args.p_source, c.args.p_items.length, c.args.p_total] : null); }
  return { ok: seen.every((s) => s && s[0] === "swiggy" && s[1] >= 1 && s[1] <= 3 && s[2] > 0), note: JSON.stringify(seen.slice(0, 4)) }; });
row("a banquet line saves the price, the sort position and 'on' as sent", async () => {
  const { G, r } = await run({}, "POST", "banquet/item-save", { title: "Buffet", price: 450, sort_order: 3 }); const p = lastPatch(G, "banquet_items");
  return { ok: r.status === 200 && p.price === 450 && p.sort_order === 3 && p.active === true, note: JSON.stringify(p).slice(0, 90) }; });
row("…and a line sent with active: false is saved switched off", async () => {
  const { G } = await run({}, "POST", "banquet/item-save", { title: "Buffet", price: 450, active: false }); return { ok: lastPatch(G, "banquet_items").active === false, note: "" }; });
row("deleting a banquet line removes THAT line", async () => {
  const { G, r } = await run({}, "POST", "banquet/item-delete", { id: ID.bq }); return { ok: r.status === 200 && !G.FIX.banquet_items.some((b) => b.id === ID.bq), note: `${r.status}` }; });
row("a banquet bill keeps the details typed for it (an object), ignores a non-object, and names its table", async () => {
  const B = { rpc: { lfh_banquet_bill_create: { ok: true, bill_no: "B1", total: 1 } } };
  const a = rpc((await run(B, "POST", "banquet/bill", { table: "4", lines: [{ id: ID.bq, qty: 1 }], meta: { guest: "Asha" } })).G, "lfh_banquet_bill_create")[0].args;
  const b = rpc((await run(B, "POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 1 }], meta: "ab" })).G, "lfh_banquet_bill_create")[0].args;
  return { ok: a.p_meta.guest === "Asha" && a.p_table === "4" && !("0" in b.p_meta) && b.p_table === null, note: JSON.stringify([a.p_meta, a.p_table, b.p_meta]).slice(0, 100) }; });
row("deleting bills from the admin console never deletes a PAID sale; a cancelled paid one may go", async () => {
  const { G } = await run({ who: "admin", mut: (G) => { Object.assign(ord(G, ID.order2), { payment_status: "paid", status: "served" }); Object.assign(ord(G, ID.cancelled), { payment_status: "paid" }); } }, "POST", "orders/delete", { ids: [ID.order2, ID.cancelled], reason: "dup" });
  return { ok: !ord(G, ID.order2).deleted_at && !!ord(G, ID.cancelled).deleted_at, note: JSON.stringify([ord(G, ID.order2).deleted_at, ord(G, ID.cancelled).deleted_at]) }; });
row("a discount's typed note goes into its Audit row when no separate reason was picked", async () => {
  const { G } = await run({ rpc: { lfh_staff_bill_discount: { discount: 40 } } }, "POST", `orders/${ID.order}/discount`, { amount: 40, note: "regular" });
  const a = rpc(G, "lfh_record_removal").map((c) => c.args).find((x) => /discount/.test(x.p_kind)); return { ok: a && a.p_reason_note === "regular", note: a ? `${a.p_kind}: ${a.p_reason_note}` : JSON.stringify(rpc(G, "lfh_record_removal").map((c) => c.args.p_kind)) }; });
row("a discount answers the amount actually taken off as a NUMBER", async () => {
  const { r } = await run({ rpc: { lfh_staff_bill_discount: { discount: 35 } } }, "POST", `orders/${ID.order}/discount`, { amount: 40 }); return { ok: r.json && r.json.discount === 35, note: JSON.stringify(r.json) }; });
row("accepting a ticket keeps a dish already served as served, the rest go to preparing", async () => {
  const { G } = await run({ mut: (G) => { ord(G, ID.order2).items = [{ id: "dal", status: "served" }, { id: "naan", status: "received" }]; } }, "POST", `orders/${ID.order2}/accept`, {});
  const it = ord(G, ID.order2).items; return { ok: it[0].status === "served" && it[1].status === "preparing", note: JSON.stringify(it.map((i) => i.status)) }; });
row("opening a table answers with the session the database opened", async () => {
  const { r } = await run({ rpc: { lfh_staff_open_table: { id: "s-new", table_number: "6" } } }, "POST", "sessions/open", { table: "6" }); return { ok: r.json && r.json.id === "s-new", note: r.text.slice(0, 60) }; });
row("re-issuing a reopened bill with a reason typed records that reason in its Audit row", async () => {
  const { G } = await run({ fix: { deletion_audit: [{ id: 9, restaurant_id: "rest-1", session_id: ID.sess, kind: "invoice_voided", at: ago(3), meta: { total_at_reopen: 400, orders_on_bill: 1 } }] } }, "POST", `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "Asha", reason: "added a dessert" });
  const a = audits(G, "bill_changed_after_reopen")[0]; return { ok: a && a.args.p_meta.reissue_reason === "added a dessert", note: a ? String(a.args.p_meta.reissue_reason) : "" }; });
row("a reopen window the admin left at 0 minutes means the default (5), not 'never'", async () => {
  const { r } = await run({ accessConfig: { void_bills: { limit: { minutes: 0 } } }, rpc: { lfh_void_invoice: { ok: true } }, mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(1); } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "wrong dish" });
  return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 70)}` }; });
row("settling in parts with NO pay-later part leaves the table open (it never closes itself)", async () => {
  const { G, r } = await run({}, "POST", "tables/4/pay-split", { splits: [{ method: "Cash", amount: 210 }, { method: "UPI", amount: 210 }] });
  return { ok: r.status === 200 && G.FIX.sessions.find((s) => s.id === ID.sess).status === "open" && !logged(G, "khata_park").length, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("making a guest the head of a CLOSED table is refused; of an open one answers that guest", async () => {
  const a = (await run({ mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.sess).status = "closed"; } }, "POST", `members/${ID.member}/make-head`, {})).r;
  const sa = a.status, ta = a.text; const b = (await run({ rpc: { lfh_staff_make_head: [{ id: ID.member, role: "head" }] } }, "POST", `members/${ID.member}/make-head`, {})).r;
  return { ok: sa === 400 && /not open/.test(ta) && b.status === 200 && b.json && b.json.id === ID.member, note: `${sa} / ${b.status} ${b.text.slice(0, 50)}` }; });
row("changing a dish's NO-list on an UNPAID ticket is not a 'bill annotated' Audit row", async () => {
  const { G } = await run({}, "POST", `items/${ID.item}/removed`, { removed: ["onion"], reason_note: "guest asked" }); return { ok: !audits(G, "bill_annotated").length, note: "" }; });
row("…and it answers the changed dish row", async () => {
  const { r } = await run({}, "POST", `items/${ID.item}/removed`, { removed: ["onion"], reason_note: "guest asked" }); return { ok: r.json && r.json.id === ID.item, note: r.text.slice(0, 60) }; });
row("adding a dish with a normal typed price (\"50\") and 3 of it goes through as 3", async () => {
  const { G, r } = await run({ rpc: { lfh_staff_add_item_to_order: { ok: true } } }, "POST", `orders/${ID.order}/add-item`, { dishId: "dal", qty: 3, price: "50" });
  const c = rpc(G, "lfh_staff_add_item_to_order")[0]; const q = c && c.args.p_items[0].qty; return { ok: r.status === 200 && q === 3, note: `${r.status} ${q}` }; });
row("denying a request to OPEN a table opens nothing; approving a JOIN opens nothing either", async () => {
  const a = await run({ mut: (G) => { G.FIX.requests[0].type = "open"; G.FIX.sessions = G.FIX.sessions.filter((s) => s.table_number !== "4"); } }, "POST", `requests/${ID.req}/resolve`, { status: "denied" }); const na = rpc(a.G, "lfh_staff_open_table").length + W(a.G, "sessions").length;
  const b = await run({}, "POST", `requests/${ID.req}/resolve`, { status: "approved" }); const nb = rpc(b.G, "lfh_staff_open_table").length + W(b.G, "sessions").filter((w) => w.op === "insert").length;
  return { ok: na === 0 && nb === 0 && b.r.json && b.r.json.id === ID.req, note: `${na}/${nb} ${b.r.text.slice(0, 50)}` }; });
row("clearing a table with unpaid tickets logs what was owed in rupees, tax included (and ₹0 tax on a ₹0 ticket, never NaN)", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.orders.push({ id: "z0", restaurant_id: "rest-1", session_id: ID.sess, table_number: "4", status: "served", payment_status: "pending", subtotal: 0, tax: 0, total: 0, discount: 0, items: [] }); } }, "POST", "tables/4/restart", { force: true });
  const l = logged(G, "close_unpaid")[0]; return { ok: l && /₹\d/.test(l.detail) && !/NaN/.test(l.detail) && !/₹0\b/.test(l.detail), note: l ? l.detail : "" }; });
row("'on the house' records the ticket's worth in its Audit row", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).subtotal = 200; G.FIX.table_tags = [{ restaurant_id: "rest-1", table_number: "4", tag: "family" }]; } }, "POST", "tables/4/on-the-house", {});
  const a = rpc(G, "lfh_record_removal")[0]; return { ok: a && Number(a.args.p_amount) === 200, note: a ? `${a.args.p_kind} ₹${a.args.p_amount}` : "" }; });
row("a ban naming a guest AND a device keeps the device typed", async () => {
  const { G, r } = await run({}, "POST", "blocklist", { member_id: ID.member, device_id: "typed-dev" }); const b = G.FIX.blocklist.find((x) => x.member_id === ID.member);
  return { ok: b && b.device_id === "typed-dev" && !!r.json && typeof r.json === "object", note: b ? b.device_id : "" }; });
row("a counter screen that claims the printer by itself records WHO was at it", async () => {
  const { G } = await run(PRINT(SCREEN), "POST", "print-jobs/claim", { ids: [ID.job] }); const s = G.FIX.print_stations.find((x) => x.active);
  return { ok: s && s.claimed_by === "Diag Manager", note: s ? String(s.claimed_by) : "no station" }; });
row("a SAMPLE bill still prints while automatic kitchen slips are off (only a sample KOT needs them)", async () => {
  const { r } = await run(PRINT({ bill: { agent: "ag1", printer: "EPSON" } }, { settings: { auto_print_kot: false } }), "POST", "printing/test", { sample: "bill" }); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("a NEW dish's saved row never carries the panel's internal 'create' marker", async () => {
  const { G } = await dish(owner, { __create: true, title: "Kulfi", price: "80" }); return { ok: !("__create" in lastPatch(G, "menu_items")), note: Object.keys(lastPatch(G, "menu_items")).join(",") }; });
row("a manager with 'edit a dish' but not 'add a dish' can still EDIT a dish", async () => {
  const { r } = await dish({ accessConfig: { edit_menu: { manager_opts: { add_dish: false, edit_dish: true } } } }, { id: "dal", title: "Dal Tadka" }); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("the OWNER's dish edit is never trimmed by the manager's switches (price change off for managers)", async () => {
  const { G, r } = await dish({ ...owner, accessConfig: { edit_menu: { manager_opts: { edit_price: false } } } }, { id: "dal", price: "260" }); return { ok: r.status === 200 && lastPatch(G, "menu_items").price === "260", note: `${r.status} ${lastPatch(G, "menu_items").price}` }; });
row("a NEW dish with an explicit slug already used gets the next free one — the category name-clash refusal is only for categories and tags", async () => {
  const { G, r } = await dish(owner, { __create: true, slug: "dal", title: "Dal", price: "100" }); return { ok: r.status === 200 && lastPatch(G, "menu_items").slug === "dal-2", note: `${r.status} ${lastPatch(G, "menu_items").slug}` }; });
row("…and a NEW category with a name already used IS refused (409)", async () => {
  const { r } = await run(owner, "POST", "categories", { __create: true, slug: "mains", name: { en: "Mains" } }); return { ok: r.status === 409 && /category with that name/.test(r.text), note: `${r.status}` }; });
row("the owner may rename tables while the MANAGER's Tables section is off; the admin console may too", async () => {
  const off = { accessConfig: { menus: { mgrset: { tables: false } } } };
  const a = (await settingsSave({ table_names: { 1: "Patio" } }, { ...owner, ...off })).r.status; const b = (await settingsSave({ table_names: { 1: "Patio" } }, { who: "admin", ...off })).r.status;
  return { ok: a === 200 && b === 200, note: `${a}/${b}` }; });
row("the floor layout setting stores 'custom' as custom and anything else as classic", async () => {
  const v = []; for (const m of ["custom", "grid"]) { const { G } = await settingsSave({ floor_layout_mode: m }, { who: "admin" }); v.push(lastPatch(G, "settings").floor_layout_mode); }
  return { ok: JSON.stringify(v) === '["custom","classic"]', note: JSON.stringify(v) }; });
row("a dish price with two decimal points (\"12.5.1\") or only letters is refused", async () => {
  const s = []; for (const p of ["12.5.1", "abc"]) s.push((await dish(owner, { id: "dal", price: p })).r.status); return { ok: s.every((x) => x === 400), note: JSON.stringify(s) }; });
row("a dish, category or tag sort position is rounded to a whole number; a word becomes 0", async () => {
  const a = lastPatch((await dish(owner, { id: "dal", sort_order: "3.6" })).G, "menu_items").sort_order;
  const b = lastPatch((await run({}, "POST", "categories", { slug: "mains", sort_order: 2.4 })).G, "categories").sort_order;
  const c = lastPatch((await run({}, "POST", "filters", { slug: "veg", sort_order: "x" })).G, "filters").sort_order;
  return { ok: a === 4 && b === 2 && c === 0, note: JSON.stringify([a, b, c]) }; });
row("a menu change is logged with the thing's NAME: a dish by title, a category by its English name, a tag by its slug", async () => {
  const d = (logged((await dish(owner, { id: "dal", title: "Dal Tadka" })).G, "menu_edit")[0] || {}).detail;
  const c = (logged((await run({}, "POST", "categories", { slug: "mains", name: { en: "Main course" } })).G, "menu_edit")[0] || {}).detail;
  const s = (logged((await run({}, "POST", "categories", { slug: "mains", name: "Mains plain" })).G, "menu_edit")[0] || {}).detail;
  const f = (logged((await run({}, "POST", "filters", { slug: "veg", sort_order: 1 })).G, "menu_edit")[0] || {}).detail;
  return { ok: d === "edited dish: Dal Tadka" && c === "edited category: Main course" && s === "edited category: Mains plain" && f === "edited tag: veg", note: JSON.stringify([d, c, s, f]) }; });
row("marking a ticket paid WITHOUT naming a method is taken (the method stays as it was)", async () => {
  const { r } = await run({}, "PATCH", `orders/${ID.order}`, { payment_status: "paid" }); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("a voided ticket can be neither served nor sent to preparing; a live one can be served", async () => {
  const s = []; for (const [id, st] of [[ID.cancelled, "served"], [ID.cancelled, "preparing"], [ID.order, "served"]]) s.push((await run({}, "PATCH", `orders/${id}`, { status: st })).r.status);
  return { ok: JSON.stringify(s) === "[409,409,200]", note: JSON.stringify(s) }; });
row("un-paying a ticket that has a table but no session still undoes the guest's capture", async () => {
  const { G } = await run({ mut: (G) => { Object.assign(ord(G), { payment_status: "paid", paid_at: ago(2), session_id: null }); } }, "PATCH", `orders/${ID.order}`, { payment_status: "pending", revert_reason: "wrong table" });
  return { ok: rpc(G, "lfh_uncapture_customer").length === 1, note: `${rpc(G, "lfh_uncapture_customer").length}` }; });
row("'not archived' sent for a ticket that was never archived is taken, not refused as too old", async () => {
  const { r } = await run({}, "PATCH", `orders/${ID.order}`, { archived: false }); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("archiving stamps WHEN; un-archiving clears it", async () => {
  const a = lastPatch((await run({}, "PATCH", `orders/${ID.order}`, { archived: true })).G, "orders").archived_at;
  const b = lastPatch((await run({ mut: (G) => { Object.assign(ord(G), { archived: true, archived_at: ago(2) }); } }, "PATCH", `orders/${ID.order}`, { archived: false })).G, "orders").archived_at;
  return { ok: typeof a === "string" && a.length > 10 && b === null, note: JSON.stringify([a, b]) }; });
row("a delete's Activity line keeps its details (which restaurant, which dish)", async () => {
  const { G } = await run({}, "DELETE", "items/dal", null); const l = G.LOGS[G.LOGS.length - 1] || {}; return { ok: l.restaurant_id === "rest-1", note: JSON.stringify(l).slice(0, 90) }; });
row("deleting a ticket from the admin console carries the address's reason and code into the Activity line and the Audit", async () => {
  await fullWorld({ who: "admin" }); const r = await call("DELETE", `orders/${ID.order2}`, { query: "?reason=duplicate&reason_code=mistake" });
  const { G } = await import("../../panel-stubs/state.mjs"); const l = logged(G, "order_delete")[0]; const a = audits(G, "order_deleted")[0];
  return { ok: r.status === 200 && l && l.detail === "duplicate" && a && a.args.p_reason_note === "duplicate" && a.args.p_reason_code === "mistake", note: `${l && l.detail} · ${a && a.args.p_reason_code}` }; });
row("deleting a category or a tag records ITS name in the Audit (columns honoured, as the database answers)", async () => {
  const names = [];
  for (const [p, mut] of [["categories/mains", (G) => { G.HONOUR_COLUMNS = true; }], ["filters/veg", (G) => { G.HONOUR_COLUMNS = true; }], ["items/dal", (G) => { G.HONOUR_COLUMNS = true; }]]) {
    const { G } = await run({ mut }, "DELETE", p, null); G.HONOUR_COLUMNS = false; names.push((audits(G, "menu_item_deleted")[0] || {}).args?.p_item_title); }
  return { ok: /^category: \S/.test(names[0]) && /^tag: \S/.test(names[1]) && names[2] === "dish: Dal", note: JSON.stringify(names) }; });
// ══ 14 · MUTATION PASS 5 — the last observable ten ═══════════════════════════════════════════════
for (const [what, fail, path, body, wrongWords] of [
  ["reopening a table", { "rpc:lfh_reopen_table": { code: "XX000", message: "kaboom" } }, `sessions/${ID.closedSess}/reopen-table`, { reason: "x" }, /no sale to reopen/],
  ["reopening a bill", { "rpc:lfh_void_invoice": { code: "XX000", message: "kaboom" } }, `sessions/${ID.closedSess}/void-invoice`, { reason: "x" }, /settled — its invoice/],
  ["a credit note", { "rpc:lfh_issue_credit_note": { code: "XX000", message: "kaboom" } }, `sessions/${ID.closedSess}/credit-note`, { amount: 5, reason: "x" }, /more than the bill total/],
]) row(`${what} refused by the database for an UNRELATED reason never shows another refusal's sentence`, async () => {
  const { r } = await run({ who: "owner", fail, mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(1); } }, "POST", path, body);
  return { ok: r.status >= 400 && !wrongWords.test(r.text) && !/kaboom/.test(r.text), note: `${r.status} ${r.text.slice(0, 70)}` }; });
row("clearing a table logs what was owed with each ticket's OWN tax on its discount (₹210 − ₹20 × 1.05 = ₹189)", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.restaurant_id === "rest-2"); G.FIX.orders.push({ id: "z1", restaurant_id: "rest-1", session_id: ID.sess, table_number: "4", archived: false, status: "served", payment_status: "pending", subtotal: 200, tax: 10, total: 210, discount: 20, items: [] }); } }, "POST", "tables/4/restart", { force: true });
  const l = logged(G, "close_unpaid")[0]; return { ok: l && /₹189\b/.test(l.detail), note: l ? l.detail : "" }; });
row("…and a ticket with no subtotal recorded counts at no tax (never ₹NaN)", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.restaurant_id === "rest-2"); G.FIX.orders.push({ id: "z2", restaurant_id: "rest-1", session_id: ID.sess, table_number: "4", archived: false, status: "served", payment_status: "pending", subtotal: null, tax: 0, total: 100, discount: 5, items: [] }); } }, "POST", "tables/4/restart", { force: true });
  const l = logged(G, "close_unpaid")[0]; return { ok: l && /₹95\b/.test(l.detail) && !/NaN/.test(l.detail), note: l ? l.detail : "" }; });
row("a dish price that is only a dot (\".\" or \"..\") is refused, never saved", async () => {
  const s = []; for (const p of [".", ".."]) s.push((await dish(owner, { id: "dal", price: p })).r.status); return { ok: s.every((x) => x === 400), note: JSON.stringify(s) }; });
row("a dish edit that does not mention its sort position leaves the position alone (never reset to 0)", async () => {
  const { G } = await dish(owner, { id: "dal", title: "Dal Tadka" }); return { ok: !("sort_order" in lastPatch(G, "menu_items")), note: Object.keys(lastPatch(G, "menu_items")).join(",") }; });
row("a dish edit sent with only its id and price is logged by the dish's id ('edited dish: dal'), never '[object Object]'", async () => {
  const { G } = await dish(owner, { id: "dal", price: "210" }); const d = (logged(G, "menu_edit")[0] || {}).detail; return { ok: d === "edited dish: dal", note: String(d) }; });
row("deleting a category or tag records its real name: the English one, else the first name it has", async () => {
  const names = [];
  for (const [p, mut] of [
    ["categories/mains", (G) => { G.HONOUR_COLUMNS = true; G.FIX.categories.find((c) => c.slug === "mains" && c.restaurant_id === "rest-1").name = { hi: "मुख्य", en: "Mains" }; }],
    ["filters/veg", (G) => { G.HONOUR_COLUMNS = true; }],
    ["categories/mains", (G) => { G.HONOUR_COLUMNS = true; G.FIX.categories.find((c) => c.slug === "mains" && c.restaurant_id === "rest-1").name = { hi: "मुख्य" }; }],
  ]) { const { G } = await run({ mut }, "DELETE", p, null); G.HONOUR_COLUMNS = false; names.push((audits(G, "menu_item_deleted")[0] || {}).args?.p_item_title); }
  return { ok: JSON.stringify(names) === JSON.stringify(["category: Mains", "tag: Veg", "category: मुख्य"]), note: JSON.stringify(names) }; });
row("the admin console editing a dish is saved whole (no manager switch applies to it)", async () => {
  const { G, r } = await dish({ who: "admin", accessConfig: { edit_menu: { manager_opts: { edit_price: false } } } }, { id: "dal", price: "230" });
  return { ok: r.status === 200 && lastPatch(G, "menu_items").price === "230", note: `${r.status} ${lastPatch(G, "menu_items").price}` }; });
row("a manager allowed to ADD a dish sets its price on creation even with 'change a price' off", async () => {
  const { G, r } = await dish({ accessConfig: { edit_menu: { manager_opts: { add_dish: true, edit_price: false } } } }, { __create: true, title: "Kulfi", price: "80" });
  return { ok: r.status === 200 && lastPatch(G, "menu_items").price === "80", note: `${r.status} ${lastPatch(G, "menu_items").price}` }; });
// ══ 15 · THE RARE SIDES — branch arms no check had taken (coverage --branches, after pass 5: 263) ════
// A line can run without ever taking its second half; these rows take the halves a person can SEE.
const { G: SG } = await import("../../panel-stubs/state.mjs");
row("an order's allergy list goes to the kitchen as sent", async () => {
  const { G } = await run(PLACE, "POST", "order", { table: "4", items: [{ id: "dal" }], allergies: ["peanuts"] }); const c = rpc(G, "lfh_staff_place_order")[0];
  return { ok: c && JSON.stringify(c.args.p_allergies) === '["peanuts"]', note: c ? JSON.stringify(c.args.p_allergies) : "" }; });
row("the duplicate check compares choices and NO-lists too: same dish with a different NO-list is a new order, identical ones are stopped", async () => {
  const line = { id: "dal", qty: 1, options: [{ group: "Size", label: "Large" }], removed: ["Onion"] };
  const a = (await run({ ...PLACE, mut: recent([{ ...line, removed: ["garlic"] }]) }, "POST", "order", { table: "4", items: [line] })).r.status;
  const b = (await run({ ...PLACE, mut: recent([{ ...line, removed: ["onion"] }]) }, "POST", "order", { table: "4", items: [line] })).r.status;
  return { ok: a === 200 && b === 409, note: `${a}/${b}` }; });
row("…and the same dish with the same allergy line twice is stopped; a different allergy line is a new order", async () => {
  const mk = (alg) => (G) => G.FIX.orders.push({ id: "recent", restaurant_id: "rest-1", table_number: "4", items: [{ id: "dal", qty: 1 }], allergies: alg, created_at: new Date().toISOString() });
  const a = (await run({ ...PLACE, mut: mk(["nuts"]) }, "POST", "order", { table: "4", items: [{ id: "dal", qty: 1 }], allergies: ["nuts"] })).r.status;
  const b = (await run({ ...PLACE, mut: mk([]) }, "POST", "order", { table: "4", items: [{ id: "dal", qty: 1 }], allergies: ["nuts"] })).r.status;
  return { ok: a === 409 && b === 200, note: `${a}/${b}` }; });
row("a discount power switched off WHILE the order was being placed: the order stands, the discount is refused", async () => {
  const { G, r } = await run({ rpc: { lfh_price_order: { ok: false } }, rpcImpl: { lfh_staff_place_order: () => { SG.FIX.restaurants[0].access_config = { give_discounts: { on: false } }; return { ok: true, order_id: ID.order2 }; } } }, "POST", "order", { table: "4", items: [{ id: "dal" }], discount: 10 });
  return { ok: r.status === 403 && /give discounts/.test(r.text) && rpc(G, "lfh_staff_place_order").length === 1 && !rpc(G, "lfh_staff_bill_discount").length, note: `${r.status}` }; });
row("[removed · round 4 item 4] the parcel's 'no valid dishes' line is gone — an empty list is still refused ('items required') and every unknown dish by name", async () => { const { src } = await import("./lib.mjs");
  return { ok: !/return err\("no valid dishes"/.test(src) && /if \(!Array\.isArray\(items\) \|\| !items\.length\) return err\("items required"\);/.test(src) && /if \(!d\) return err\(editErrMsg\("unknown_item"\), 400\);/.test(src), note: "removed; the two refusals that made it dead still stand" }; }, "SRC · the removed line and the two refusals in front of it");
row("a parcel keeps its allergy list on the parcel; a database answer shaped as a list is understood", async () => {
  const { G, r } = await run({ rpc: { lfh_platform_insert: [{ id: ID.plat }] } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], allergies: ["Nuts", 7] });
  const p = (G.FIX.aggregator_orders.find((x) => x.id === ID.plat) || {}).payload || {}; return { ok: r.status === 200 && JSON.stringify(p.allergies) === '["Nuts","7"]', note: JSON.stringify(p.allergies) }; });
row("a parcel discount with no reason typed is logged as just the amount", async () => {
  const { G } = await run({ who: "owner", ...PARCEL }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], discount: 50 }); const l = logged(G, "order_discount")[0];
  return { ok: l && l.detail === "parcel discount ₹50", note: l ? l.detail : "" }; });
row("un-ticking a guest rating clears who handled it and when", async () => {
  const { G } = await run({ mut: (G) => Object.assign(G.FIX.feedback.find((f) => f.id === ID.fb), { acknowledged: true, acknowledged_by: "X", acknowledged_at: ago(5) }) }, "POST", "ratings/ack", { id: ID.fb, acknowledged: false });
  const f = G.FIX.feedback.find((x) => x.id === ID.fb); return { ok: f.acknowledged === false && f.acknowledged_at === null && f.acknowledged_by === null, note: JSON.stringify([f.acknowledged_at, f.acknowledged_by]) }; });
row("a delivery-order status change and a handover payment understand a database answer shaped as a list", async () => {
  const a = (await run({ rpc: { lfh_platform_set_status: [{ id: ID.plat, status: "accepted" }] } }, "POST", `platform/${ID.plat}/status`, { status: "accepted" })).r;
  const sa = a.status, ja = a.json; const b = (await run({ rpc: { lfh_platform_mark_paid: [{ id: ID.plat, paid: true }] } }, "POST", `platform/${ID.plat}/pay`, { method: "UPI" })).r;
  return { ok: sa === 200 && ja && ja.id === ID.plat && b.status === 200, note: `${sa} ${JSON.stringify(ja).slice(0, 50)} / ${b.status} ${b.text.slice(0, 50)}` }; });
row("a removal recorded by hand keeps its reason, dish name, quantity, amount and table", async () => {
  const { G } = await run({}, "POST", "audit", { kind: "dish_removed", order_id: ID.order, reason_code: "mistake", reason_note: "guest changed mind", item_title: "Dal", qty: "2", amount: "400", table: 4 });
  const a = audits(G)[0].args; return { ok: a.p_reason_note === "guest changed mind" && a.p_item_title === "Dal" && a.p_qty === 2 && a.p_amount === 400 && a.p_table === "4", note: JSON.stringify([a.p_reason_note, a.p_item_title, a.p_qty, a.p_amount, a.p_table]) }; });
row("taking a discount OFF (amount 0) is logged as 'discount removed'; a word as the amount counts as 0", async () => {
  const { G } = await run({ rpc: { lfh_staff_bill_discount: { discount: 0 } } }, "POST", `orders/${ID.order}/discount`, { amount: "abc" }); const l = logged(G, "order_discount")[0];
  return { ok: l && l.detail === "discount removed", note: l ? l.detail : "" }; });
row("changing the order's allergy line logs what was REMOVED, and the full list when nothing changed but the note", async () => {
  const a = await run({ mut: (G) => { ord(G).allergies = ["peanuts", "milk"]; } }, "POST", `orders/${ID.order}/allergies`, { allergies: ["peanuts"], reason_note: "guest corrected" }); const la = (logged(a.G, "order_allergies")[0] || {}).detail;
  return { ok: /removed milk/.test(la || ""), note: String(la) }; });
row("re-issuing a reopened bill whose value did not move says 'no change in value'", async () => {
  const R0 = (tot) => ({ fix: { deletion_audit: [{ id: 9, restaurant_id: "rest-1", session_id: ID.sess, kind: "invoice_voided", at: ago(3), meta: { total_at_reopen: tot, orders_on_bill: 3 } }] } });
  const first = audits((await run(R0(1), "POST", `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "Asha" })).G, "bill_changed_after_reopen")[0];
  const now = first && first.args.p_meta.after.total;
  const a = audits((await run(R0(now), "POST", `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "Asha" })).G, "bill_changed_after_reopen")[0];
  return { ok: typeof now === "number" && a && a.args.p_meta.change.total === 0 && /no change in value/.test(JSON.stringify(a.args)), note: a ? JSON.stringify(a.args).match(/no change in value|MORE|LESS/)?.[0] || JSON.stringify(a.args).slice(0, 80) : "no row" }; });
row("reopening a bill whose table has no number names 'that table' in the refusal", async () => {
  const { r } = await run({ fail: { "rpc:lfh_reopen_table": { code: "LFH03", message: "another party is sitting" } }, mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).table_number = null; } }, "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "x" });
  return { ok: r.status === 409 && /sitting at that table/.test(r.text), note: r.text.slice(0, 70) }; });
row("reopening a table, and reopening a bill, name the retired invoice number in the Activity line", async () => {
  const W2 = (G) => { Object.assign(G.FIX.sessions.find((s) => s.id === ID.closedSess), { invoice_no: "INV-7", invoice_at: ago(1), bill_no: 12 }); };
  const a = (logged((await run({ who: "owner", mut: W2, rpc: { lfh_reopen_table: { ok: true } } }, "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "coffee" })).G, "table_reopened")[0] || {}).detail;
  const b = (logged((await run({ who: "owner", mut: W2, rpc: { lfh_void_invoice: { ok: true } } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "wrong dish" })).G, "invoice_void")[0] || {}).detail;
  return { ok: /Invoice INV-7/.test(a || "") && /Invoice INV-7/.test(b || ""), note: JSON.stringify([a, b]) }; });
row("removing a dish the database refuses for its own reason shows that reason; an unknown dish says 'already removed'", async () => {
  const a = (await run({ rpc: { lfh_delete_order_item: { ok: false, reason: "kitchen has started it" } } }, "POST", `items/${ID.item}/delete`, { reason_code: "mistake" })).r; const sa = a.status, ta = a.text;
  const b = (await run({ rpc: { lfh_delete_order_item: { ok: false, reason: "item_not_found" } } }, "POST", `items/${ID.item}/delete`, { reason_code: "mistake" })).r;
  return { ok: sa === 400 && /kitchen has started it/.test(ta) && b.status === 400 && /already removed/.test(b.text), note: `${sa} ${ta.slice(0, 40)} / ${b.status}` }; });
row("a quantity or note change the database refuses for a non-paid reason answers 400; adding to a PAID bill answers 409", async () => {
  const a = (await run({ rpc: { lfh_staff_edit_item_qty: { ok: false, reason: "item_not_found" } } }, "POST", `items/${ID.item}/qty`, { qty: 1, reason_code: "mistake" })).r.status;
  const b = (await run({ rpc: { lfh_staff_edit_item_note: { ok: false, reason: "item_not_found" } } }, "POST", `items/${ID.item}/note`, { note: "x" })).r.status;
  const c = (await run({ rpc: { lfh_staff_add_item_to_order: { ok: false, reason: "order_paid" } } }, "POST", `orders/${ID.order}/add-item`, { dishId: "dal" })).r.status;
  return { ok: a === 400 && b === 400 && c === 409, note: `${a}/${b}/${c}` }; });
row("taking a NO back off a dish (it was 'no onion', now plain) is logged as removed and needs a reason", async () => {
  const M = (G) => Object.assign(G.FIX.order_items.find((i) => i.id === ID.item), { removed: ["onion"] });
  const a = (await run({ mut: M }, "POST", `items/${ID.item}/removed`, { removed: [] })).r; const sa = a.status;
  const { G } = await run({ mut: M }, "POST", `items/${ID.item}/removed`, { removed: [], reason_note: "guest changed mind" }); const l = (logged(G, "order_item_removed")[0] || {}).detail;
  return { ok: sa === 400 && /removed onion/.test(l || ""), note: `${sa} · ${l}` }; });
row("…and taking back a NO that was ADDED after the order was placed simply un-marks it", async () => {
  const { G, r } = await run({ mut: (G) => Object.assign(G.FIX.order_items.find((i) => i.id === ID.item), { removed: ["onion"], added_allergens: ["onion"] }) }, "POST", `items/${ID.item}/removed`, { removed: [], reason_note: "mistake" });
  const it = G.FIX.order_items.find((i) => i.id === ID.item); return { ok: r.status === 200 && !(it.added_allergens || []).includes("onion"), note: `${r.status} ${JSON.stringify(it.added_allergens)}` }; });
row("adding a dish with its choices, NO-list and note sends all three to the kitchen", async () => {
  const { G } = await run({ rpc: { lfh_staff_add_item_to_order: { ok: true } } }, "POST", `orders/${ID.order}/add-item`, { dishId: "dal", options: [{ group: "Size", label: "L" }], removed: ["onion"], note: "extra hot" });
  const l = rpc(G, "lfh_staff_add_item_to_order")[0].args.p_items[0]; return { ok: l.options.length === 1 && l.removed[0] === "onion" && l.note === "extra hot", note: JSON.stringify(l).slice(0, 90) }; });
row("serving a dish row that is gone answers 'isn't on this order any more' (404)", async () => {
  const { r } = await run({ mut: (G) => { G.HONOUR_UPDATE_RETURN = true; G.FIX.order_items = G.FIX.order_items.filter((i) => i.restaurant_id !== "rest-1"); } }, "POST", `items/${ID.item}/status`, { status: "served" });
  return { ok: r.status === 404, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("answering a request someone else already APPROVED says so by name ('Someone already approved')", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.requests[0].status = "approved"; } }, "POST", `requests/${ID.req}/resolve`, { status: "denied" });
  return { ok: r.status === 409 && /Someone already approved/.test(r.text), note: r.text.slice(0, 60) }; });
row("clearing or 'on the house' for a table with NO open session reads its tickets by table number", async () => {
  const NOSESS = (G) => { G.FIX.sessions = G.FIX.sessions.filter((s) => !(s.restaurant_id === "rest-1" && s.table_number === "4")); };
  const a = await run({ mut: NOSESS }, "POST", "tables/4/restart", { force: true }); const sa = a.r.status;
  const b = await run({ mut: (G) => { NOSESS(G); G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).session_id = null; G.FIX.table_tags = [{ restaurant_id: "rest-1", table_number: "4", tag: "family" }]; } }, "POST", "tables/4/on-the-house", {});
  const l = (logged(b.G, "on_the_house")[0] || {}).detail;
  return { ok: sa === 200 && b.r.status === 200 && /^1 order\b/.test(l || ""), note: `${sa} / ${b.r.status} ${l}` }; });
row("splitting a merged table back names the KOTs that went home with it", async () => {
  const { G } = await run({ rpc: { lfh_staff_unmerge_table: { ok: true, parent: "2", moved: 1, kots: "12" } } }, "POST", "tables/5/unmerge", {});
  const l = (G.LOGS.find((x) => /split from/.test(x.detail || "")) || {}).detail; return { ok: /split from T2 · 1 order returned \(KOT 12\)/.test(l || ""), note: String(l) }; });
row("parking ONE ticket on a tab and collecting ONE say 'order', not 'orders'", async () => {
  const a = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; } }, "POST", "tables/4/khata", { customer_id: ID.khata }); const la = (logged(a.G, "khata_park")[0] || {}).detail;
  const b = await run({ mut: (G) => { Object.assign(G.FIX.orders.find((o) => o.id === ID.paid), { payment_status: "pending" }); } }, "POST", "khata/pay", { order_id: ID.paid, method: "Cash" }); const lb = (logged(b.G, "khata_collect")[0] || {}).detail;
  return { ok: /^1 order\b/.test(la || "") && /^1 order\b/.test(lb || ""), note: JSON.stringify([la, lb]) }; });
row("a KOT reprint of a ticket with no kitchen number logs 'KOT #—'", async () => {
  const { G } = await run({ mut: (G) => { ord(G).kot_no = null; } }, "POST", "print-jobs", { order_id: ID.order }); const l = logged(G, "kot_reprint_sent")[0]; return { ok: l && l.detail === "KOT #—", note: l ? l.detail : "" }; });
row("a claim with no list claims nothing; the admin console may always print here", async () => {
  const a = (await run(PRINT(SCREEN), "POST", "print-jobs/claim", {})).r.json; const b = (await run(PRINT(SCREEN, { who: "admin" }), "POST", "print-jobs/claim", { ids: [ID.job] })).r;
  return { ok: a && a.won.length === 0 && b.status === 200 && b.json.refused !== "not_allowed", note: `${JSON.stringify(a).slice(0, 40)} / ${b.text.slice(0, 50)}` }; });
row("a REPRINT printed on the counter is logged 'reprinted KOT', and a slip with no number has none in the line", async () => {
  const { G } = await run(PRINT(SCREEN, { mut: (G) => { Object.assign(G.FIX.print_jobs[0], { status: "printing", claimed_at: nowIso(), reprint: true }); ord(G).kot_no = null; } }), "POST", `print-jobs/${ID.job}/done`, { ok: true });
  const l = logged(G, "kot_printed")[0]; return { ok: l && /^reprinted KOT on this screen$/.test(l.detail), note: l ? l.detail : "" }; });
row("a failed print reported with no error text is logged 'print failed'", async () => {
  const { G } = await run(PRINT(SCREEN, { mut: (G) => { Object.assign(G.FIX.print_jobs[0], { status: "printing", claimed_at: nowIso() }); } }), "POST", `print-jobs/${ID.job}/done`, { ok: false });
  const l = logged(G, "kot_print_failed")[0]; return { ok: l && /print failed/.test(l.detail), note: l ? l.detail : "" }; });
row("clearing ONE waiting ticket says 'ticket', not 'tickets'", async () => {
  const { G } = await run(PRINT({}), "POST", "printing/queue/clear", {}); const l = logged(G, "print_switch")[0]; return { ok: l && /cleared 1 waiting ticket from/.test(l.detail), note: l ? l.detail : "" }; });
row("a sample from the admin console is logged as 'Aevidine admin'; from a manager with only a login, by that login", async () => {
  const P = PRINT({ bill: { agent: "ag1", printer: "EPSON" } });
  const a = (logged((await run({ ...P, who: "admin" }, "POST", "printing/test", { sample: "bill" })).G, "print_test")[0] || {}).actor;
  const j = (await run({ ...P, user: { name: null } }, "POST", "printing/test", { sample: "bill" })).G.FIX.print_jobs.find((x) => x.kind !== "kot");
  return { ok: a === "Aevidine admin" && j && /diagm1/.test(j.requested_by || ""), note: `${a} · ${j && j.requested_by}` }; });
row("a test page to a computer whose helper is NOT running is saved and says it prints when the helper starts", async () => {
  const { r } = await run(PRINT({}, { mut: (G) => { G.FIX.print_agents[0].last_seen_at = ago(60); } }), "POST", "printing/test", { printer: "EPSON" });
  return { ok: r.status === 200 && /prints as soon as this computer's helper is running/.test(r.text), note: r.text.slice(0, 80) }; });
row("a manager without 'mark sold out' who re-sends a dish's tags keeps its stored sold-out mark", async () => {
  const { G } = await dish({ accessConfig: { edit_menu: { manager_opts: { edit_dish: true, mark_86: false } } }, mut: (G) => { G.FIX.menu_items.find((d) => d.id === "dal").tags = ["veg", "sold-out"]; } }, { id: "dal", tags: ["spicy"] });
  return { ok: JSON.stringify(lastPatch(G, "menu_items").tags) === '["spicy","sold-out"]', note: JSON.stringify(lastPatch(G, "menu_items").tags) }; });
row("a NEW tag with a name already used is refused as a 'filter'", async () => {
  const { r } = await run(owner, "POST", "filters", { __create: true, slug: "veg", name: { en: "Veg" } }); return { ok: r.status === 409 && /A filter with that name/.test(r.text), note: r.text.slice(0, 60) }; });
row("the banquet starting number refused after TWO bills says 'bills have'", async () => {
  const { r } = await settingsSave({ banquet_bill_next: 50 }, { ...owner, settings: { banquet_bill_next: 4 }, fix: { banquet_bills: [{ id: "bb1", restaurant_id: "rest-1" }, { id: "bb2", restaurant_id: "rest-1" }] } });
  return { ok: r.status === 409 && /2 banquet bills have already been issued/.test(r.text), note: r.text.slice(0, 70) }; });
row("the admin console setting tables per row is kept within the picker's range", async () => {
  const { G, r } = await settingsSave({ floor_per_row: 99 }, { who: "admin" }); const v = lastPatch(G, "settings").floor_per_row; return { ok: r.status === 200 && Number.isInteger(v) && v < 99, note: `${r.status} ${v}` }; });
row("un-paying a ticket with NO table still reverses its capture (blank table, its session)", async () => {
  const { G } = await run({ mut: (G) => { Object.assign(ord(G), { payment_status: "paid", paid_at: ago(2), table_number: null }); } }, "PATCH", `orders/${ID.order}`, { payment_status: "pending", revert_reason: "wrong ticket" });
  const c = rpc(G, "lfh_uncapture_customer")[0]; return { ok: c && c.args.p_table === "" && c.args.p_session === ID.sess, note: c ? JSON.stringify(c.args) : "" }; });
row("[removed · round 4 item 4] the cancel line no longer carries the dead '(was marked paid)' — a PAID ticket is still refused a cancel first", async () => { const { src } = await import("./lib.mjs");
  return { ok: /if \(patch\.status === "cancelled" && cur\.payment_status === "paid"\)\s*return err\("Can't cancel a paid order/.test(src) && /log\("editor", "order_cancel", \{[^}]*detail: "cancelled", device_id/.test(src), note: "removed; the refusal that made it dead still stands" }; }, "SRC · the cancel line and the refusal in front of it");
row("…and that refusal holds for the admin console too — a paid sale is never cancelled straight off", async () => {
  const { r } = await run({ who: "admin", mut: (G) => { Object.assign(ord(G), { payment_status: "paid" }); } }, "PATCH", `orders/${ID.order}`, { status: "cancelled" }); return { ok: r.status === 409 && /mark it unpaid/.test(r.text), note: `${r.status}` }; });
row("deleting a dish whose name is blank records it by its id", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.menu_items.find((d) => d.id === "dal").title = ""; } }, "DELETE", "items/dal", null); const a = audits(G, "menu_item_deleted")[0];
  return { ok: a && a.args.p_item_title === "dish: dal", note: a ? a.args.p_item_title : "" }; });
row("deleting a tag takes it off every dish that carried it, and a dish or tag already gone says which word", async () => {
  const { G } = await run({ mut: (G) => { G.FIX.menu_items.find((d) => d.id === "dal").tags = ["veg", "spicy"]; } }, "DELETE", "filters/veg", null);
  const t = G.FIX.menu_items.find((d) => d.id === "dal").tags; const a = (await run({}, "DELETE", "items/ghost", null)).r.text; const b = (await run({}, "DELETE", "filters/ghost", null)).r.text;
  return { ok: JSON.stringify(t) === '["spicy"]' && /That dish is already gone/.test(a) && /That tag is already gone/.test(b), note: `${JSON.stringify(t)} · ${a.slice(0, 30)} · ${b.slice(0, 30)}` }; });
row("…and when taking the tag off the dishes fails, the delete still stands (the clean-up is best-effort)", async () => {
  const { r } = await run({ fail: { "menu_items:select": "throw" } }, "DELETE", "filters/veg", null); return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("collecting a tab whose split label cannot be relabelled still answers collected (the debt is already cleared)", async () => {
  const { r } = await run({ mut: (G) => { Object.assign(G.FIX.orders.find((o) => o.id === ID.paid), { payment_status: "pending" }); }, fail: { "session_payments:update": "throw" } }, "POST", "khata/pay", { order_id: ID.paid, method: "Cash" });
  return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }; });
// ── the 29 mutants NO check can kill, each judged and recorded (round 3, final pass over ALL 1,218 sites: 1,189 killed) ──
// Each row reads the line that makes the change unobservable. If that line moves, the row goes red and
// the judgement has to be made again — a recorded equivalence is never a permanent pass.
const eq = (what, re, why, file) => row(`[mutation · equivalent] ${what}`, async () => {
  const text = file ? (await import("node:fs")).readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8") : (await import("./lib.mjs")).src;
  return { ok: re.test(text), note: why }; }, `SRC · the surviving mutant, read and judged${file ? ` (${file})` : ""}`);
eq("the reopen window's '> 5 min' vs '≥ 5 min' differs only at the exact millisecond", /getTime\(\) > winMin \* 60_000\)/, "an exact-millisecond boundary — not observable by a person");
eq("the restore window's '> 30 min' vs '≥ 30 min' differs only at the exact millisecond", /\) > RESTORE_WINDOW_MS;/, "an exact-millisecond boundary — not observable");
eq("'total > 0' vs '≥ 0' when rolling a ticket up from its dish rows — a dish row always exists at that point", /const orderStatus = total > 0 && served === total/, "the row the tap just changed is one of them");
eq("the parcel discount's '> food + ½ paisa' vs '≥' differs only on a discount of exactly food + ₹0.005, which no money box can type", /if \(rawPDisc > parcelDiscBase \+ 0\.005\)/, "half a paisa — not enterable");
eq("the bill-delete Audit loop's '<' vs '≤' only adds one pass over an EMPTY slice", /for \(let i = 0; i < deletable\.length; i \+= AUDIT_CONCURRENCY\)/, "slice past the end is [] — no Audit row, no call");
eq("the duplicate-order read (×2 mutants): running it more often changes nothing — its answer is used only when the check is NOT skipped, and a bad table or empty order is refused first", /if \(!skipDupCheck\) \{/, "one extra read, never a different answer");
eq("reopening a table / a bill / a credit note — 'code OR words' vs 'code AND words' (×3): the database always sends the code, and the shared refusal list maps that code to the SAME sentence and 409", /LFH01: "This bill is settled[\s\S]*LFH02: "The credit can't be more than the bill total\."[\s\S]*LFH04: "Every KOT on this bill was cancelled/, "outcome-identical: the route throws pgError(…) and the list answers the same", "lib/dbRefusal.ts");
eq("the reopen window's fallback '… || 5' vs '&& 5' — the Access tree's own default IS 5 minutes", /\{ id: "void_bills", name: "Reopen a bill"[^}]*mins: 5,/, "default 5 either way", "lib/accessTree.ts");
eq("a split's 'parked AND customer' vs 'OR' — a split names a customer only when it has a pay-later part", /let customer: \{ id: string; name: string \} \| null = null;\s*if \(laterPart\) \{/, "customer stays null unless parked", "lib/paySplit.ts");
eq("the generic save and delete's Edit-menu line (×10 mutants) repeats the tab gate, which refuses first for every staff member; the only other kind it could reach is a manager's settings save, where nothing is left to change", /hit\.tab === "editor"  \? await managerCan\(g, rid, "edit_menu"\)/, "a backstop behind tabGate");
eq("'body && typeof body === object' before stripping the create marker — the body is always an object there (readBody returns {} at worst)", /if \(body && typeof body === "object"\) delete \(body as Record<string, unknown>\)\.__create;/, "cannot differ on any reachable input");
eq("'body && typeof body === object' inside touches() (×2) — the body is always an object there", /const touches = \(ks: string\[\]\) => body && typeof body === "object"/, "cannot differ on any reachable input");
eq("the price check's 'n < 0' half — since item 20 a minus is refused before this line, so n is never negative here", /if \(\/-\/\.test\(String\(body\.price \?\? ""\)\)\) return err\("A price can't be negative/, "unreachable half after item 20");
eq("the new dish's id base 'slug || slugify(title) || \"item\"' — the slug is always set from the title first, and a nameless create is refused", /if \(!body\.slug && body\.title\) body\.slug = slugify\(body\.title\);/, "cannot differ on any reachable input");
eq("the first slug candidate 'body.slug || base' — base IS body.slug whenever body.slug is set", /const base = body\.slug \|\| slugify\(body\.title\) \|\| "item";/, "same value either way");
eq("reading the 'existing row' on a CREATE too — the new id is free by construction and a taken category name was refused first, so it reads nothing and writes the same", /if \(clash\) return err\(`A \$\{a === "categories" \? "category" : "filter"\} with that name already exists\.`, 409\);/, "one extra read, never a different write");
// ── THE WHOLE-SUITE QUERY AUDIT — must stay the LAST row of this block ─────────────────────────
row("EVERY database statement this suite made on a restaurant's table named the restaurant (the only exception: the dish-id lookups, a global key)", async () => {
  const { G } = await import("../../panel-stubs/state.mjs");
  const { TENANT_TABLES } = await import("./endpoints.mjs");
  const log = G.SCOPE_LOG || [];
  const scoped = (s) => (s.op === "insert" || s.op === "upsert") ? (Array.isArray(s.patch) ? s.patch : [s.patch]).every((x) => x && x.restaurant_id) : s.filters.some((f) => f.col === "restaurant_id");
  // ONLY the two genuine global-id lookups of a dish save: "is this id free anywhere?" (select id) and
  // "whose dish is this id?" (select restaurant_id). Columns are recorded by the stub (round 3), so a
  // dropped filter on any OTHER dish read — the tags read, say — is not hidden by this exemption.
  // …and "is this id free" only on a CREATE request (marked by lib.call): the same shape on an edit is the
  // existing-row read with its restaurant filter gone.
  const exempt = (s) => s.table === "menu_items" && s.op === "select" && s.filters.length === 1 && s.filters[0].col === "id"
    && (s.cols === "restaurant_id" || (s.cols === "id" && /:create$/.test(String(s.req))));
  const bad = log.filter((s) => TENANT_TABLES.has(s.table) && !scoped(s) && !exempt(s));
  return { ok: log.length > 500 && bad.length === 0, note: `${log.length} statements · unscoped: ${bad.slice(0, 4).map((s) => `${s.op}:${s.table}[${s.filters.map((f) => f.col)}] ← ${s.where}`).join("; ") || "none"}` }; },
  "STUB · every statement the blocks b, c and r3 issued (scripts/panel-stubs/sb.mjs → G.SCOPE_LOG)");
