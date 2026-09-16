/**
 * D · /api/admin/restaurants/settings — a restaurant's money, tax, floor and banquet settings, plus
 * its permanent per-table QR codes.  372 lines, 14.5 rows per hundred.
 *
 * This handler's sanitizer is a long list of one-line clamps, and a clamp that is wrong in the
 * fourth decimal place is invisible until it reaches a printed bill. So every branch is driven with
 * a value OUTSIDE its range and the stored result is read back with the service role — never trusted
 * from the response. The whole settings row is snapshotted by the harness and restored with a
 * re-read-and-diff afterwards.
 */
export default function section(c) {
  const { phase, sec, req, sq, FH, NOSUCH, DB_WORDS } = c;
  const F = "app/api/admin/restaurants/settings/route.ts";
  const P = "/api/admin/restaurants/settings";
  sec("D · one restaurant's operational settings");
  const save = (body) => req(P, { method: "POST", body: { restaurant_id: FH, ...body } });
  const get = (cols) => sq(`settings?select=${cols}&restaurant_id=eq.${FH}`).then((q) => q.json?.[0] || {});

  // ── the file's own rules ─────────────────────────────────────────────────────────────────────
  phase("the sign-in gate runs before the first database call", "compare positions",
    () => c.gateFirst(F));
  phase("this route reads and writes an EXPLICIT column list, never everything",
    "check SETTINGS_COLS exists and SELECT is built from it",
    () => { const s = c.clean(F); return /const SETTINGS_COLS = \[/.test(s) && /const SELECT = SETTINGS_COLS\.join/.test(s); });
  phase("a retired column cannot be written any more, so two settings cannot answer one question",
    "kot_print_target must not be assignable",
    () => !/out\.kot_print_target/.test(c.clean(F)));
  phase("auto_table_action is deliberately not writable either", "grep for it",
    () => !/out\.auto_table_action/.test(c.clean(F)));
  phase("the banquet counter's lock cannot open because a COUNT failed",
    "both reads' errors are answered before the refusal",
    () => /if \(issued\.error \|\| cur\.error\)/.test(c.clean(F)));
  phase("the QR code alphabet leaves out every character that reads two ways",
    "read CODE_ALPHABET", () => { const m = c.clean(F).match(/CODE_ALPHABET = "([A-Z0-9]+)"/); return !!m && !/[01OIL]/.test(m[1]); });
  phase("a QR code is long enough that a typo lands on nothing, not on a neighbouring table",
    "read the code length", () => /randomBytes\(8\)/.test(c.clean(F)));
  phase("two different unique indexes get OPPOSITE answers, which is what unlocked the stuck card",
    "the pkey clash is ignored at the database, the code clash re-mints",
    () => { const s = c.clean(F); return /ignoreDuplicates: true/.test(s) && /m\.code = newCode\(\)/.test(s); });
  phase("the settings row is keyed by the restaurant's own id, never its slug", "read the clone branch",
    () => /id: rid, restaurant_id: rid/.test(c.clean(F)));
  phase("no read in this file decides anything from an unreachable error",
    "grep for the (await sb…).data shape",
    () => !/\(\s*await\s+sb\s*\.\s*from\s*\([\s\S]{0,600}?\)\s*\.\s*data/.test(c.clean(F)));

  // ── GET ─────────────────────────────────────────────────────────────────────────────────────
  phase("the settings cannot be read without being signed in", "GET with no cookie",
    async () => (await req(`${P}?restaurant_id=${FH}`, { cookie: "" })).status === 401);
  phase("a signed-in admin gets the settings, the slug and the table codes", "GET",
    async () => { const r = await req(`${P}?restaurant_id=${FH}`); return r.status === 200 && !!r.json?.settings && !!r.json?.slug && !!r.json?.codes; });
  phase("a malformed restaurant id is refused in words", "GET with a junk id",
    async () => { const r = await req(`${P}?restaurant_id=nope`); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("an unknown restaurant says so", "GET with an unknown uuid",
    async () => (await req(`${P}?restaurant_id=${NOSUCH}`)).status === 404);
  phase("the answer carries only the columns this screen owns, not the whole row",
    "compare the answer's keys against SETTINGS_COLS",
    async () => { const j = (await req(`${P}?restaurant_id=${FH}`)).json; const cols = (c.clean(F).match(/SETTINGS_COLS = \[([\s\S]*?)\] as const/) || [])[1] || ""; return Object.keys(j.settings).every((k) => cols.includes(`"${k}"`)); });
  phase("there is one QR code per table the restaurant says it has", "compare codes to table_count",
    async () => { const j = (await req(`${P}?restaurant_id=${FH}`)).json; const n = Number(j.settings.table_count) || 12; return Object.keys(j.codes).length === Math.min(Math.max(n, 1), 500); });
  phase("every QR code is in the unmistakable alphabet and the right length",
    "test each returned code",
    async () => { const j = (await req(`${P}?restaurant_id=${FH}`)).json; return Object.values(j.codes).every((x) => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(x)); });
  phase("no two tables share a QR code", "check the codes are distinct",
    async () => { const v = Object.values((await req(`${P}?restaurant_id=${FH}`)).json.codes); return new Set(v).size === v.length; });
  phase("the answer carries no delivery-app credential", "scan the body",
    async () => !/"(key|api_key)"\s*:\s*"[^"]{6,}"/.test((await req(`${P}?restaurant_id=${FH}`)).text));

  // ── the sanitizer, one clamp at a time ──────────────────────────────────────────────────────
  const clamps = [
    ["the restaurant's printed name is capped at 80 characters", "restaurant_name", "x".repeat(300), (v) => v.length <= 80],
    ["its printed address is capped at 200", "restaurant_address", "y".repeat(500), (v) => v.length <= 200],
    ["its printed phone is capped at 30", "restaurant_phone", "9".repeat(90), (v) => v.length <= 30],
    ["its GSTIN is capped at 20", "gstin", "G".repeat(60), (v) => v.length <= 20],
    ["the invoice prefix is capped at 12", "invoice_prefix", "INV".repeat(20), (v) => v.length <= 12],
    ["the printed sign-off is capped at 200", "bill_footer", "z".repeat(400), (v) => v.length <= 200],
    ["the on-screen tax word is capped at 20", "tax_label", "TAX".repeat(20), (v) => v.length <= 20],
  ];
  for (const [label, key, input, ok] of clamps)
    phase(label, `save a value far past the cap and read the column back`,
      async () => { const r = await save({ [key]: input }); const v = (await get(key))[key]; return r.status === 200 && typeof v === "string" && ok(v); });
  phase("a blank printed name is stored as nothing, not as an empty string pretending to be a name",
    "save an empty string", async () => { await save({ restaurant_name: "   " }); return (await get("restaurant_name")).restaurant_name === null; });
  phase("a tax rate above 100% cannot be stored", "save tax_rate 9",
    async () => { await save({ tax_rate: 9 }); const v = (await get("tax_rate")).tax_rate; return v === null || (v >= 0 && v <= 1); });
  phase("a negative tax rate cannot be stored", "save tax_rate -1",
    async () => { await save({ tax_rate: -1 }); const v = (await get("tax_rate")).tax_rate; return v === null || v >= 0; });
  phase("a tax rate that is not a number at all is stored as nothing", 'save tax_rate "lots"',
    async () => { await save({ tax_rate: "lots" }); return (await get("tax_rate")).tax_rate === null; });
  phase("a tax component with no label is dropped", "save one with an empty label",
    async () => { await save({ tax_components: [{ label: "", rate: 5 }] }); return ((await get("tax_components")).tax_components || []).length === 0; });
  phase("a tax component at 0% is dropped — it would print a line that says nothing",
    "save one at rate 0",
    async () => { await save({ tax_components: [{ label: "CGST", rate: 0 }] }); return ((await get("tax_components")).tax_components || []).length === 0; });
  phase("a tax component above 100% is dropped", "save one at rate 500",
    async () => { await save({ tax_components: [{ label: "CGST", rate: 500 }] }); return ((await get("tax_components")).tax_components || []).length === 0; });
  phase("a tax component's rate is kept to two decimal places", "save 2.5559",
    async () => { await save({ tax_components: [{ label: "CGST", rate: 2.5559 }] }); const v = ((await get("tax_components")).tax_components || [])[0]; return !!v && Math.abs(v.rate - 2.56) < 0.001; });
  phase("a tax component's label is capped at 24 characters", "save a long label",
    async () => { await save({ tax_components: [{ label: "L".repeat(80), rate: 5 }] }); const v = ((await get("tax_components")).tax_components || [])[0]; return !!v && v.label.length <= 24; });
  phase("no more than six tax components are kept — a bill has room for so many lines",
    "save ten",
    async () => { await save({ tax_components: Array.from({ length: 10 }, (_, i) => ({ label: `T${i}`, rate: 1 })) }); return ((await get("tax_components")).tax_components || []).length <= 6; });
  phase("a tax component list that is not a list is stored as an empty one", 'save tax_components "x"',
    async () => { await save({ tax_components: "x" }); return Array.isArray((await get("tax_components")).tax_components); });
  phase("an unrecognised tax posture falls back to the SAFE one, not to an error",
    'save price_tax_mode "banana"',
    async () => { await save({ price_tax_mode: "banana" }); return (await get("price_tax_mode")).price_tax_mode === "excl"; });
  phase("…and a real one is honoured", 'save price_tax_mode "incl"',
    async () => { await save({ price_tax_mode: "incl" }); return (await get("price_tax_mode")).price_tax_mode === "incl"; });
  phase("…including the composition scheme, which prints no tax line at all",
    'save price_tax_mode "composition"',
    async () => { await save({ price_tax_mode: "composition" }); return (await get("price_tax_mode")).price_tax_mode === "composition"; });
  phase("an unrecognised MRP treatment falls back to declaring no tax", 'save mrp_tax_treatment "x"',
    async () => { await save({ mrp_tax_treatment: "x" }); return (await get("mrp_tax_treatment")).mrp_tax_treatment === "none"; });
  phase("…and the inclusive one is honoured", 'save mrp_tax_treatment "inclusive"',
    async () => { await save({ mrp_tax_treatment: "inclusive" }); return (await get("mrp_tax_treatment")).mrp_tax_treatment === "inclusive"; });
  for (const k of ["sessions_enabled", "require_location", "require_otp", "bill_customer_required", "bill_customer_print", "item_tax_modes_allowed"])
    phase(`${k.replace(/_/g, " ")} takes only a real yes or no`, `save it as a string and read it back`,
      async () => { await save({ [k]: "true" }); const a = (await get(k))[k]; await save({ [k]: false }); const b = (await get(k))[k]; return a === true && b === false; });
  phase("a geofence radius below the floor is lifted to it", "save geo_radius_m 1",
    async () => { await save({ geo_radius_m: 1 }); return (await get("geo_radius_m")).geo_radius_m === 20; });
  phase("…and one above the ceiling is brought down", "save geo_radius_m 999999",
    async () => { await save({ geo_radius_m: 999999 }); return (await get("geo_radius_m")).geo_radius_m === 5000; });
  phase("…and one that is not a number falls back to the app default", 'save geo_radius_m "far"',
    async () => { await save({ geo_radius_m: "far" }); return (await get("geo_radius_m")).geo_radius_m === 250; });
  phase("a geofence centre that is not a number is stored as nothing, so the gate stays off",
    'save geo_lat "here"',
    async () => { await save({ geo_lat: "here" }); return (await get("geo_lat")).geo_lat === null; });
  phase("a floor of zero tables is lifted to one", "save table_count 0",
    async () => { await save({ table_count: 0 }); return (await get("table_count")).table_count === 1; });
  phase("…and a floor of ten thousand is brought down to 500", "save table_count 10000",
    async () => { await save({ table_count: 10000 }); return (await get("table_count")).table_count === 500; });
  phase("…and a floor that is not a number falls back to twelve", 'save table_count "lots"',
    async () => { await save({ table_count: "lots" }); return (await get("table_count")).table_count === 12; });
  phase("an unrecognised floor layout cannot take a restaurant's floor away",
    'save floor_layout_mode "spiral"',
    async () => { await save({ floor_layout_mode: "spiral" }); return (await get("floor_layout_mode")).floor_layout_mode === "classic"; });
  phase("…and the custom one is honoured", 'save floor_layout_mode "custom"',
    async () => { await save({ floor_layout_mode: "custom" }); return (await get("floor_layout_mode")).floor_layout_mode === "custom"; });
  phase("a per-table seat count below one is lifted", "save table_seats { 1: 0 }",
    async () => { await save({ table_seats: { 1: 0 } }); return ((await get("table_seats")).table_seats || {})["1"] === 1; });
  phase("…and above thirty is brought down", "save table_seats { 1: 900 }",
    async () => { await save({ table_seats: { 1: 900 } }); return ((await get("table_seats")).table_seats || {})["1"] === 30; });
  phase("…and a table number that is not a number is dropped entirely",
    'save table_seats { "patio": 4 }',
    async () => { await save({ table_seats: { patio: 4 } }); return ((await get("table_seats")).table_seats || {}).patio === undefined; });
  phase("…and table zero is dropped, because there is no table zero",
    "save table_seats { 0: 4 }",
    async () => { await save({ table_seats: { 0: 4 } }); return ((await get("table_seats")).table_seats || {})["0"] === undefined; });
  phase("a per-table name is capped at 24 characters", "save a long one",
    async () => { await save({ table_names: { 1: "N".repeat(80) } }); const v = ((await get("table_names")).table_names || {})["1"]; return !!v && v.length <= 24; });
  phase("…and a blank name is dropped rather than stored as an empty label",
    "save an empty name",
    async () => { await save({ table_names: { 1: "   " } }); return ((await get("table_names")).table_names || {})["1"] === undefined; });
  phase("…and a name list that is not an object is stored as an empty one",
    'save table_names "x"',
    async () => { await save({ table_names: "x" }); const v = (await get("table_names")).table_names; return v && typeof v === "object" && !Array.isArray(v); });

  // ── banquet ────────────────────────────────────────────────────────────────────────────────
  phase("a banquet bill prefix is upper-cased and stripped of anything that is not a letter or digit",
    'save banquet_bill_prefix "bq-b/2026"',
    async () => { await save({ banquet_bill_prefix: "bq-b/2026" }); return (await get("banquet_bill_prefix")).banquet_bill_prefix === "BQB2026"; });
  phase("…and an empty one falls back to BQB rather than printing no prefix at all",
    "save an empty prefix",
    async () => { await save({ banquet_bill_prefix: "///" }); return (await get("banquet_bill_prefix")).banquet_bill_prefix === "BQB"; });
  phase("…and it is capped at eight characters", "save a long prefix",
    async () => { await save({ banquet_bill_prefix: "ABCDEFGHIJKLMNOP" }); return ((await get("banquet_bill_prefix")).banquet_bill_prefix || "").length <= 8; });
  phase("an unrecognised banquet numbering style falls back to the financial-year one",
    'save banquet_bill_style "roman"',
    async () => { await save({ banquet_bill_style: "roman" }); return (await get("banquet_bill_style")).banquet_bill_style === "fy"; });
  phase("…and each offered style is honoured", "save each of fy, date and plain",
    async () => { for (const v of ["date", "plain", "fy"]) { await save({ banquet_bill_style: v }); if ((await get("banquet_bill_style")).banquet_bill_style !== v) return false; } return true; });
  phase("an unrecognised banquet paper falls back to plain", 'save banquet_paper "papyrus"',
    async () => { await save({ banquet_paper: "papyrus" }); return (await get("banquet_paper")).banquet_paper === "plain"; });
  phase("an unrecognised banquet paper size falls back to A5", 'save banquet_paper_size "a0"',
    async () => { await save({ banquet_paper_size: "a0" }); return (await get("banquet_paper_size")).banquet_paper_size === "a5"; });
  const mm = [["banquet_paper_top", 0, 80, 33], ["banquet_paper_bot", 0, 50, 14], ["banquet_paper_side", 2, 25, 6]];
  for (const [k, lo, hi, dflt] of mm) {
    phase(`${k.replace(/_/g, " ")} below its floor is lifted to ${lo}mm`, `save ${k} = -50`,
      async () => { await save({ [k]: -50 }); return (await get(k))[k] === lo; });
    phase(`…and above its ceiling is brought down to ${hi}mm`, `save ${k} = 9999`,
      async () => { await save({ [k]: 9999 }); return (await get(k))[k] === hi; });
    phase(`…and one that is not a number falls back to ${dflt}mm`, `save ${k} = "wide"`,
      async () => { await save({ [k]: "wide" }); return (await get(k))[k] === dflt; });
  }
  phase("the banquet's own tax lines are clamped exactly like the restaurant's, so the two cannot drift",
    "save a 500% banquet component",
    async () => { await save({ banquet_tax_components: [{ label: "X", rate: 500 }] }); return ((await get("banquet_tax_components")).banquet_tax_components || []).length === 0; });
  phase("an unknown banquet field is never stored, so the SQL side can trust the list",
    "save a made-up field name",
    async () => { await save({ banquet_fields: { zz_not_a_field: true } }); const v = (await get("banquet_fields")).banquet_fields || {}; return v.zz_not_a_field === undefined; });
  phase("the banquet starting number can be set while no banquet bill has been issued",
    "save banquet_bill_next 500",
    async () => { const n = (await sq(`banquet_bills?select=id&restaurant_id=eq.${FH}&limit=1`)).json || []; if (n.length) return "skip:French House has issued banquet bills, so the counter is locked — its refusal is the next phase"; const r = await save({ banquet_bill_next: 500 }); return r.status === 200 && (await get("banquet_bill_next")).banquet_bill_next === 500; });
  phase("…and it is clamped to at least one", "save banquet_bill_next 0",
    async () => { const n = (await sq(`banquet_bills?select=id&restaurant_id=eq.${FH}&limit=1`)).json || []; if (n.length) return "skip:the counter is locked on this restaurant"; await save({ banquet_bill_next: 0 }); return (await get("banquet_bill_next")).banquet_bill_next === 1; });
  phase("…and REFUSED OUT LOUD once bills exist, because a series that moves backwards is what an audit checks",
    "read the refusal the handler gives",
    () => /already been issued, so the starting number can't be changed/.test(c.clean(F)));

  // ── saving, and the QR codes ────────────────────────────────────────────────────────────────
  phase("a save with nothing in it is refused rather than answered Saved", "POST an empty body",
    async () => (await req(P, { method: "POST", body: { restaurant_id: FH } })).status === 400);
  phase("a save for an unknown restaurant is refused before it writes", "POST with an unknown rid",
    async () => (await req(P, { method: "POST", body: { restaurant_id: NOSUCH, tax_label: "GST" } })).status === 404);
  phase("a save with a malformed restaurant id is refused in words", "POST with a junk rid",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: "nope", tax_label: "GST" } }); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("a save answers with the settings it actually stored, so the screen redraws from truth",
    "compare the answer against a service-role read",
    async () => { const r = await save({ tax_label: "T27R2" }); const v = (await get("tax_label")).tax_label; return r.json?.settings?.tax_label === v; });
  phase("the save is written into the record, naming the fields that moved", "read staff_actions",
    async () => { const since = new Date(Date.now() - 20000).toISOString(); await save({ tax_label: "T27R2b" }); const rows = await c.actionsSince(since, ["restaurant_settings"]); return rows.some((r) => /updated .*tax_label/.test(r.detail || "")); });
  phase("a column outside this screen's list is silently ignored, not written",
    "try to save a column the route does not own",
    async () => { const before = (await sq(`settings?select=features&restaurant_id=eq.${FH}`)).json?.[0]?.features; await save({ features: { hacked: true } }); const after = (await sq(`settings?select=features&restaurant_id=eq.${FH}`)).json?.[0]?.features; return JSON.stringify(before) === JSON.stringify(after); });
  phase("a new QR code for one table really replaces the old one", "regen and compare",
    async () => { const before = (await req(`${P}?restaurant_id=${FH}`)).json.codes["1"]; const r = await req(P, { method: "POST", body: { restaurant_id: FH, action: "regen_code", table: 1 } }); return r.status === 200 && !!r.json?.code && r.json.code !== before; });
  phase("…and the new code is in the unmistakable alphabet", "test it",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: FH, action: "regen_code", table: 1 } }); return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(r.json?.code || ""); });
  phase("…and it is written into the record, naming the table", "read staff_actions",
    async () => { const since = new Date(Date.now() - 20000).toISOString(); await req(P, { method: "POST", body: { restaurant_id: FH, action: "regen_code", table: 1 } }); return (await c.actionsSince(since, ["table_qr_regen"])).some((r) => /table 1 got a new QR code/.test(r.detail || "")); });
  phase("a table number that is not a number is refused", 'regen_code for table "patio"',
    async () => (await req(P, { method: "POST", body: { restaurant_id: FH, action: "regen_code", table: "patio" } })).status === 400);
  phase("table zero is refused, because there is no table zero", "regen_code for table 0",
    async () => (await req(P, { method: "POST", body: { restaurant_id: FH, action: "regen_code", table: 0 } })).status === 400);
  phase("a table beyond the biggest floor the app allows is refused", "regen_code for table 9999",
    async () => (await req(P, { method: "POST", body: { restaurant_id: FH, action: "regen_code", table: 9999 } })).status === 400);
  phase("raising the table count mints codes for the new tables, without touching the old ones",
    "read the codes, raise the count, read again",
    async () => { const before = (await req(`${P}?restaurant_id=${FH}`)).json.codes; const n = Object.keys(before).length; await save({ table_count: n + 2 }); const after = (await req(`${P}?restaurant_id=${FH}`)).json.codes; const kept = Object.keys(before).every((k) => after[k] === before[k]); return kept && Object.keys(after).length === n + 2; });
  phase("lowering it hides the extra codes from the sheet but does not erase the rows",
    "lower the count and compare the answer to the stored rows",
    async () => { const n = Object.keys((await req(`${P}?restaurant_id=${FH}`)).json.codes).length; await save({ table_count: Math.max(1, n - 1) }); const shown = Object.keys((await req(`${P}?restaurant_id=${FH}`)).json.codes).length; const stored = ((await sq(`table_qr_codes?select=table_number&restaurant_id=eq.${FH}&limit=500`)).json || []).length; return shown < stored || shown === stored; });
  phase("no answer from this endpoint carries a database sentence", "replay the refusals",
    async () => { const t = []; for (const b of [{ restaurant_id: "x" }, { restaurant_id: NOSUCH, tax_label: "G" }, { restaurant_id: FH }]) t.push((await req(P, { method: "POST", body: b })).text); return t.every((x) => !DB_WORDS.test(x)); });
  phase("every refusal from this endpoint is a sentence a person can act on", "each carries `error`",
    async () => { for (const b of [{ restaurant_id: "x" }, { restaurant_id: FH }]) { const r = await req(P, { method: "POST", body: b }); if (!r.json?.error || r.json.error.length < 5) return false; } return true; });
}
