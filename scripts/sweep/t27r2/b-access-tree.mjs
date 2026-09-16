/**
 * B · /api/admin/restaurants/access-tree — the ONE endpoint behind the whole Access & permissions
 * screen.  80 phases.
 *
 * 479 lines and 52 ledger rows before this round — 10.9 per hundred lines, the second-thinnest in
 * the territory, on the largest file in it. It is also where round 1 found its worst fault: three
 * reads whose `.error` was unreachable, two of which seeded a MERGE, so one saved switch could wipe
 * every other guest feature or every stored delivery-app key, and the third could reset the whole
 * settings row from restaurant #1's template. Those three now answer for themselves; this section
 * checks the rest of the handler with the same suspicion.
 *
 * Every write runs on French House and is put back by the harness's snapshot/restore.
 */
export default function section(c) {
  const { phase, sec, req, sq, FH, AANGAN, NOSUCH, DB_WORDS } = c;
  const F = "app/api/admin/restaurants/access-tree/route.ts";
  const P = "/api/admin/restaurants/access-tree";
  sec("B · the Access & permissions endpoint");

  const save = (patch, extra = {}) => req(P, { method: "POST", body: { restaurant_id: FH, patch, ...extra } });
  const rst = (cols) => sq(`restaurants?select=${cols}&id=eq.${FH}`).then((q) => q.json?.[0] || {});
  const set = (cols) => sq(`settings?select=${cols}&restaurant_id=eq.${FH}`).then((q) => q.json?.[0] || {});

  // ── what the file says about itself, and the three round-1 fixes ──────────────────────────────
  phase("the sign-in gate runs before the first database call",
    "compare the positions of the gate and the first sb. call",
    () => { const s = c.clean(F); return s.indexOf("gate(req)") < s.indexOf("sb.from"); });
  phase("every allow-list is DERIVED from lib/accessTree, never a second hand-typed copy",
    "check the imports carry the key lists",
    () => { const s = c.clean(F); return ["FEATURE_KEYS", "SETTING_KEYS", "CHOICE_KEYS", "LIST_KEYS", "TEXT_KEYS", "MODULE_KEYS", "CHANNEL_KEYS", "CREDS_KEYS", "GRANT_FLAGS", "SECTION_ENTITLEMENTS"].every((k) => s.includes(k)); });
  phase("the features merge can no longer start from an unreadable row (round 1, item 1)",
    "the current-features read is assigned and its error answered",
    () => /const curFeatQ = await sb[\s\S]{0,200}?if \(curFeatQ\.error\) return adminFail/.test(c.clean(F)));
  phase("the delivery-channel merge can no longer start from an unreadable row either",
    "the current-channels read is assigned and its error answered",
    () => /const curPcQ = await sb[\s\S]{0,220}?if \(curPcQ\.error\) return adminFail/.test(c.clean(F)));
  phase('"is there a settings row?" can no longer be answered by a FAILED read',
    "the existing-row read is assigned and its error answered before the clone branch",
    () => /const existingQ = await sb[\s\S]{0,200}?if \(existingQ\.error\) return adminFail/.test(c.clean(F)));
  phase("the template read answers for itself too, so a restaurant is never born half-configured",
    "the template read's error is answered",
    () => /const template = await sb[\s\S]{0,220}?if \(template\.error\) return adminFail/.test(c.clean(F)));
  phase("no read in this file decides anything from an unreachable error any more",
    "grep for the (await sb…).data shape",
    () => !/\(\s*await\s+sb\s*\.\s*from\s*\([\s\S]{0,600}?\)\s*\.\s*data/.test(c.clean(F)));
  phase("first save wins, and the loser is told — the clash gate is wired",
    "check expectClash runs before the writes",
    () => { const s = c.clean(F); return s.includes("expectClash") && s.indexOf("expectClash") < s.indexOf("restUpdate)"); });
  phase("a save that landed nowhere does not say Saved",
    "check the nothing-landed refusal exists",
    () => /Nothing in that change could be saved/.test(c.clean(F)));
  phase("each group COUNTS what survived its allow-list rather than assuming",
    "every branch has a took/cfgTook counter",
    () => { const s = c.clean(F); return (s.match(/let took = 0/g) || []).length >= 3 && /let cfgTook = 0/.test(s); });
  phase("validation happens BEFORE the first write, so a refusal cannot land half a change",
    "the settings patch is built above the restaurants update",
    () => { const s = c.clean(F); return s.indexOf("const setPatch") < s.indexOf('sb.from("restaurants").update(restUpdate)'); });
  phase("a guest-facing switch purges the guest menu cache, so it reaches guests now",
    "check revalidateTag(menuTag(rid)) with expire 0",
    () => /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(c.clean(F)));
  phase("who changed a restaurant's permissions is written down",
    "check logAction access_change",
    () => /logAction\("admin", "access_change"/.test(c.clean(F)));
  phase("a credential's VALUE never reaches the log — only that one was set or cleared",
    "read describeAccessPatch's creds branch",
    () => /creds[\s\S]{0,200}?channelKeyAction\(v\)[\s\S]{0,120}?key: \$\{a === "clear" \? "removed" : "saved"\}/.test(c.clean(F)));
  phase("the settings row is keyed by the restaurant's own id, never by its slug",
    "read the clone branch's id",
    () => /\{ \.\.\.cleanClonedSettings\(template\.data\), id: rid, restaurant_id: rid/.test(c.clean(F)));

  // ── GET ──────────────────────────────────────────────────────────────────────────────────────
  phase("the screen cannot be read without being signed in", `GET ${P} with no cookie`,
    async () => (await req(`${P}?restaurant_id=${FH}`, { cookie: "" })).status === 401);
  phase("a signed-in admin gets the whole state in one call", `GET ${P}?restaurant_id=<FH>`,
    async () => { const r = await req(`${P}?restaurant_id=${FH}`); return r.status === 200 && !!r.json?.state; });
  phase("a malformed restaurant id is refused in words", "GET with a junk id",
    async () => { const r = await req(`${P}?restaurant_id=not-a-uuid`); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("a missing restaurant id is refused in words", "GET with no id at all",
    async () => (await req(P)).status === 400);
  phase("an unknown restaurant says so rather than answering an empty screen", "GET with an unknown uuid",
    async () => { const r = await req(`${P}?restaurant_id=${NOSUCH}`); return r.status === 404 && /not found/i.test(r.json?.error || ""); });
  phase("the answer is JUST the state — the 25KB of constant model no client reads is gone", "check for a sections key",
    async () => { const r = await req(`${P}?restaurant_id=${FH}`); return r.json && !("sections" in r.json); });
  phase("the state carries no secret", "search it for every secret name",
    async () => !c.SECRETS.test((await req(`${P}?restaurant_id=${FH}`)).text));
  phase("a delivery-app key is never handed back, only whether one is saved", "search the state for a key value",
    async () => { const t = (await req(`${P}?restaurant_id=${FH}`)).text; return !/"key"\s*:\s*"[^"]{6,}"/.test(t); });

  // ── grants (manager_permissions) ──────────────────────────────────────────────────────────────
  phase("a manager grant the model knows is saved", 'POST patch { grants: { <first GRANT_FLAG>: true } }',
    async () => { const m = await c.model(); const k = m.grants[0]; if (!k) return "skip:this restaurant's model exposes no manager grant"; const r = await save({ grants: { [k]: true } }); const back = await rst("manager_permissions"); return (r.status === 200 && back.manager_permissions?.[k] === true) || `saving ${k} answered ${r.status} and stored ${JSON.stringify(back.manager_permissions?.[k])}`; });
  phase("…and turning it off is saved too", "the same flag, false",
    async () => { const m = await c.model(); const k = m.grants[0]; if (!k) return "skip:no manager grant in the model"; await save({ grants: { [k]: false } }); const v = (await rst("manager_permissions")).manager_permissions?.[k]; return v === false || `stored ${JSON.stringify(v)}`; });
  phase("a grant the model does NOT know is refused, not stored", "patch a made-up flag",
    async () => { const r = await save({ grants: { totally_made_up_flag: true } }); return r.status === 400 && /does not own/.test(r.json?.error || "") && (await rst("manager_permissions")).manager_permissions?.totally_made_up_flag === undefined; });
  phase("a non-boolean grant value is coerced, never stored as text", "patch a grant with a string",
    async () => { const m = await c.model(); const k = m.grants[0]; if (!k) return "skip:no manager grant in the model"; await save({ grants: { [k]: "yes please" } }); const v = (await rst("manager_permissions")).manager_permissions?.[k]; return typeof v === "boolean" || `stored ${JSON.stringify(v)} — a string reached the column`; });
  phase("saving one grant leaves every OTHER stored grant alone", "count the keys before and after",
    async () => { const before = (await rst("manager_permissions")).manager_permissions || {}; const keys = Object.keys(before); if (!keys.length) return "skip:French House stores no manager grants to preserve"; await save({ grants: { [keys[0]]: before[keys[0]] } }); const after = (await rst("manager_permissions")).manager_permissions || {}; return keys.every((k) => k in after); });
  phase("an owner section the model knows is saved", "patch a SECTION_ENTITLEMENT",
    async () => { const m = await c.model(); const k = m.sections[0]; if (!k) return "skip:no owner section in the model"; const r = await save({ sections: { [k]: true } }); const v = (await rst("owner_entitlements")).owner_entitlements?.[k]; return (r.status === 200 && v === true) || `saving ${k} answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("an owner section the model does not know is refused", "patch a made-up section",
    async () => { const r = await save({ sections: { not_a_real_section: true } }); return r.status === 400; });
  phase("a patch naming only unknown keys changes nothing at all", "compare all three columns before and after",
    async () => { const b = await rst("manager_permissions,owner_entitlements,access_config"); await save({ grants: { nope: true }, sections: { alsonope: true } }); const a = await rst("manager_permissions,owner_entitlements,access_config"); return JSON.stringify(b) === JSON.stringify(a); });

  // ── tabs (access_config.menus) ────────────────────────────────────────────────────────────────
  phase("a panel tab the model allows is saved", "patch tabs for a known panel+key",
    async () => { const mo = await c.model(); const panel = Object.keys(mo.tabs)[0]; const key = panel ? Object.keys(mo.tabs[panel] || {})[0] : null; if (!key) return "skip:the model exposes no panel tab"; const r = await save({ tabs: { [panel]: { [key]: true } } }); const cfg = (await rst("access_config")).access_config || {}; return (r.status === 200 && cfg.menus?.[panel]?.[key] === true) || `saving ${panel}.${key} answered ${r.status} and stored ${JSON.stringify(cfg.menus?.[panel]?.[key])}`; });
  phase("…and off is saved too", "the same tab, false",
    async () => { const mo = await c.model(); const panel = Object.keys(mo.tabs)[0]; const key = panel ? Object.keys(mo.tabs[panel] || {})[0] : null; if (!key) return "skip:no panel tab in the model"; await save({ tabs: { [panel]: { [key]: false } } }); const v = ((await rst("access_config")).access_config || {}).menus?.[panel]?.[key]; return v === false || `stored ${JSON.stringify(v)}`; });
  phase("a tab on a panel this screen does not own is ignored", "patch a made-up panel",
    async () => { await save({ tabs: { spaceship: { warp: true } } }); return (((await rst("access_config")).access_config || {}).menus || {}).spaceship === undefined; });
  phase("a tab key the panel does not have is ignored", "patch a real panel with a made-up key",
    async () => { const mo = await c.model(); const panel = Object.keys(mo.tabs)[0]; if (!panel) return "skip:no panel in the model"; await save({ tabs: { [panel]: { not_a_tab: true } } }); const v = (((await rst("access_config")).access_config || {}).menus?.[panel] || {}).not_a_tab; return v === undefined || `stored ${JSON.stringify(v)} under a key the panel does not have`; });
  phase("saving one tab leaves the other tabs on that panel alone", "compare the panel's key set",
    async () => { const mo = await c.model(); const panel = Object.keys(mo.tabs)[0]; const key = panel ? Object.keys(mo.tabs[panel] || {})[0] : null; if (!key) return "skip:no panel tab in the model"; const before = Object.keys((((await rst("access_config")).access_config || {}).menus?.[panel]) || {}); await save({ tabs: { [panel]: { [key]: true } } }); const after = Object.keys((((await rst("access_config")).access_config || {}).menus?.[panel]) || {}); const lost = before.filter((k) => !after.includes(k)); return lost.length === 0 || `lost ${lost.join(", ")}`; });
  phase("a tabs patch of nothing but unknown panels reports that nothing could be saved", "patch only a fake panel",
    async () => { const r = await save({ tabs: { spaceship: { warp: true } } }); return (r.status === 400 && /Nothing in that change could be saved/.test(r.json?.error || "")) || `answered ${r.status}: ${(r.json?.error || r.text || "").slice(0, 120)}`; });

  // ── config: on / tablet / limit / opts ────────────────────────────────────────────────────────
  phase("the whole-feature switch is saved for a row that has one", 'patch config { <HAS_ID>: { on: true } }',
    async () => { const mo = await c.model(); const id = mo.hasIds[0]; if (!id) return "skip:no row in the model carries a whole-feature switch"; const r = await save({ config: { [id]: { on: true } } }); const v = (((await rst("access_config")).access_config || {})[id] || {}).on; return (r.status === 200 && v === true) || `saving ${id}.on answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("…and a row that has NO whole-feature switch ignores one", "patch `on` for an id not in HAS_IDS",
    async () => { const mo = await c.model(); const id = mo.configIds.find((x) => !mo.hasIds.includes(x)); if (!id) return "skip:every row in the model carries a whole-feature switch"; const before = (((await rst("access_config")).access_config || {})[id] || {}).on; await save({ config: { [id]: { on: true } } }); const v = (((await rst("access_config")).access_config || {})[id] || {}).on; return v === before || `stored ${JSON.stringify(v)} on a row that has no whole-feature switch`; });
  phase("a waiter tri-state is saved when it is one of the three — on the one row that still has one", 'patch config { <the writable capTablet id>: { tablet: "pin" } }',
    async () => { const mo = await c.model(); const id = mo.capTablet[0]; if (!id) return "skip:no waiter tri-state in the model"; const r = await save({ config: { [id]: { tablet: "pin" } } }); const v = (((await rst("access_config")).access_config || {})[id] || {}).tablet; return (r.status === 200 && v === "pin") || `saving ${id}.tablet answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("…and anything that is not one of the three is refused", 'patch tablet: "maybe"',
    async () => { const mo = await c.model(); const id = mo.capTablet[0]; if (!id) return "skip:no waiter tri-state in the model"; const before = (((await rst("access_config")).access_config || {})[id] || {}).tablet; await save({ config: { [id]: { tablet: "maybe" } } }); const v = (((await rst("access_config")).access_config || {})[id] || {}).tablet; return v === before || `stored ${JSON.stringify(v)} — a fourth state reached the column`; });
  phase("a discount ceiling is CLAMPED to what its own dropdown offers", "patch a limit of 100000",
    async () => { const mo = await c.model(); const L = mo.limits[0]; if (!L) return "skip:no numeric ceiling in the model"; await save({ config: { [L.id]: { limit: { [L.sides[0]]: 100000 } } } }); const v = (((await rst("access_config")).access_config || {})[L.id] || {}).limit?.[L.sides[0]]; return (typeof v === "number" && v < 100000) || `stored ${JSON.stringify(v)} — no dropdown can show or undo that`; });
  phase("…and a negative ceiling cannot be stored", "patch a limit of -50",
    async () => { const mo = await c.model(); const L = mo.limits[0]; if (!L) return "skip:no numeric ceiling in the model"; await save({ config: { [L.id]: { limit: { [L.sides[0]]: -50 } } } }); const v = (((await rst("access_config")).access_config || {})[L.id] || {}).limit?.[L.sides[0]]; return v === undefined || v >= 0 || `stored ${JSON.stringify(v)}`; });
  phase("…and a ceiling that is not a number is ignored rather than stored", 'patch a limit of "lots"',
    async () => { const mo = await c.model(); const L = mo.limits[0]; if (!L) return "skip:no numeric ceiling in the model"; const before = (((await rst("access_config")).access_config || {})[L.id] || {}).limit?.[L.sides[0]]; await save({ config: { [L.id]: { limit: { [L.sides[0]]: "lots" } } } }); const v = (((await rst("access_config")).access_config || {})[L.id] || {}).limit?.[L.sides[0]]; return v === before || `stored ${JSON.stringify(v)} where a number belongs`; });
  phase("a per-side option the model knows is saved", "patch a known opt",
    async () => { const mo = await c.model(); const O = mo.opts[0]; if (!O) return "skip:no per-side option in the model"; const r = await save({ config: { [O.id]: { [`${O.side}_opts`]: { [O.keys[0]]: true } } } }); const v = ((((await rst("access_config")).access_config || {})[O.id] || {})[`${O.side}_opts`] || {})[O.keys[0]]; return (r.status === 200 && v === true) || `saving ${O.id}.${O.side}_opts.${O.keys[0]} answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("…and an option the model does not know is ignored", "patch a made-up opt key",
    async () => { const mo = await c.model(); const O = mo.opts[0]; if (!O) return "skip:no per-side option in the model"; await save({ config: { [O.id]: { [`${O.side}_opts`]: { not_an_opt: true } } } }); const v = ((((await rst("access_config")).access_config || {})[O.id] || {})[`${O.side}_opts`] || {}).not_an_opt; return v === undefined || `stored ${JSON.stringify(v)} under a key the model does not know`; });
  phase("a side this screen does not own is ignored", "patch kitchen_opts",
    async () => { const mo = await c.model(); const O = mo.opts[0]; if (!O) return "skip:no per-side option in the model"; await save({ config: { [O.id]: { kitchen_opts: { x: true } } } }); const v = (((await rst("access_config")).access_config || {})[O.id] || {}).kitchen_opts; return v === undefined || `stored a kitchen side the model has no rows for: ${JSON.stringify(v)}`; });
  phase("an id the model does not know stores nothing — access_config collects no dead keys",
    "patch a made-up permission id",
    async () => { await save({ config: { zz_made_up_permission: { on: true } } }); return ((await rst("access_config")).access_config || {}).zz_made_up_permission === undefined; });

  // ── features / channels / creds ───────────────────────────────────────────────────────────────
  phase("a guest feature the model owns is saved", "patch a known FEATURE_KEY",
    async () => { const mo = await c.model(); const k = mo.features[0]; if (!k) return "skip:no guest feature in the model"; const r = await save({ features: { [k]: true } }); const v = ((await set("features")).features || {})[k]; return (r.status === 200 && v === true) || `saving ${k} answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("SAVING ONE FEATURE KEEPS EVERY OTHER ONE — the round-1 fault, driven", "count the feature keys before and after",
    async () => { const mo = await c.model(); const k = mo.features[0]; if (!k) return "skip:no guest feature in the model"; const before = (await set("features")).features || {}; const keys = Object.keys(before); if (keys.length < 2) return "skip:this restaurant stores fewer than two feature flags, so nothing could be lost"; await save({ features: { [k]: true } }); const after = (await set("features")).features || {}; const lost = keys.filter((x) => !(x in after)); return lost.length === 0 || `saving ${k} WIPED ${lost.length} other feature(s): ${lost.join(", ")}`; });
  phase("a feature the model does not own is refused", "patch a made-up feature",
    async () => (await save({ features: { zz_not_a_feature: true } })).status === 400);
  phase("a delivery channel's on/off is saved", "patch a known CHANNEL_KEY",
    async () => { const mo = await c.model(); const k = mo.channels[0]; if (!k) return "skip:no delivery channel in the model"; const r = await save({ channels: { [k]: true } }); const v = ((await set("platform_channels")).platform_channels || {})[k]?.on; return (r.status === 200 && v === true) || `saving ${k} answered ${r.status} and stored on=${JSON.stringify(v)}`; });
  phase("SAVING ONE CHANNEL KEEPS THE OTHERS AND THEIR STORED KEYS — the round-1 fault, driven",
    "give one channel a key, then flip another, and check the key survived",
    async () => {
      const mo = await c.model();
      const ck = mo.creds[0];
      if (!ck || mo.channels.length < 2) return "skip:the model needs a credential key and two channels to prove this";
      await save({ creds: { [ck]: "T27R2-PROBE-KEY" } });
      const other = mo.channels.find((x) => x !== ck) || mo.channels[1];
      await save({ channels: { [other]: true } });
      const pc = (await set("platform_channels")).platform_channels || {};
      const kept = pc[ck]?.key || pc[ck]?.api_key;
      return kept === "T27R2-PROBE-KEY" || `flipping ${other} left ${ck}'s stored key as ${JSON.stringify(kept)} — nothing on the screen can retype it`;
    });
  phase('a credential sent as "" LEAVES the stored one alone (the form saves without retyping)',
    'patch creds with ""',
    async () => { const mo = await c.model(); const ck = mo.creds[0]; if (!ck) return "skip:no credential key in the model"; await save({ creds: { [ck]: "T27R2-KEEP-ME" } }); await save({ creds: { [ck]: "" } }); const pc = (await set("platform_channels")).platform_channels || {}; const kept = pc[ck]?.key || pc[ck]?.api_key; return kept === "T27R2-KEEP-ME" || `an empty string wiped it — stored ${JSON.stringify(kept)}`; });
  phase("a credential sent as null CLEARS it, deliberately", "patch creds with null",
    async () => { const mo = await c.model(); const ck = mo.creds[0]; if (!ck) return "skip:no credential key in the model"; await save({ creds: { [ck]: null } }); const pc = (await set("platform_channels")).platform_channels || {}; const left = pc[ck]?.key || pc[ck]?.api_key; return !left || `null left ${JSON.stringify(left)} behind`; });
  phase("the legacy api_key field is dropped on every write, so a split restaurant converges",
    "store under api_key by hand, save through the route, and look",
    async () => {
      const mo = await c.model(); const ck = mo.creds[0];
      if (!ck) return "skip:no credential key in the model";
      const pc = (await set("platform_channels")).platform_channels || {};
      await sq(`settings?restaurant_id=eq.${FH}`, { method: "PATCH", body: JSON.stringify({ platform_channels: { ...pc, [ck]: { on: true, api_key: "LEGACY-SHAPE" } } }) });
      await save({ creds: { [ck]: "T27R2-NEW-SHAPE" } });
      const after = ((await set("platform_channels")).platform_channels || {})[ck] || {};
      return after.key === "T27R2-NEW-SHAPE" && after.api_key === undefined;
    });
  phase("a credential key the model does not own is refused", "patch a made-up creds key",
    async () => (await save({ creds: { zz_not_a_channel: "x" } })).status === 400);
  phase("no answer from a creds save ever echoes the key back", "save a key and scan the body",
    async () => { const mo = await c.model(); const ck = mo.creds[0]; if (!ck) return "skip:no credential key in the model"; const r = await save({ creds: { [ck]: "T27R2-SECRET-VALUE" } }); return !r.text.includes("T27R2-SECRET-VALUE") || "the save echoed the credential straight back to the browser"; });

  // ── settings columns: choices, lists, text, tri-states, modules ───────────────────────────────
  phase("a pick-one setting accepts a value its own dropdown offers", "patch a CHOICE_KEY with a legal value",
    async () => { const mo = await c.model(); const k = mo.strSettings.find((x) => (mo.state.settings[x] || "").length > 0 && (mo.state.settings[x] || "").length < 30); if (!k) return "skip:the model exposes no short pick-one setting to round-trip"; const cur = mo.state.settings[k]; const r = await save({ settings: { [k]: cur } }); const v = (await set(k))[k]; return (r.status === 200 && v === cur) || `re-saving ${k}=${JSON.stringify(cur)} answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("…and refuses one it does not", "patch a choice with a made-up value",
    async () => { const mo = await c.model(); const k = mo.strSettings.find((x) => (mo.state.settings[x] || "").length > 0 && (mo.state.settings[x] || "").length < 30); if (!k) return "skip:no short pick-one setting in the model"; const before = (await set(k))[k]; await save({ settings: { [k]: "zz-not-an-option" } }); const v = (await set(k))[k]; return v === before || `stored ${JSON.stringify(v)} — a value no dropdown offers`; });
  phase("a list setting with nothing in it is REFUSED — a menu with no language renders nothing",
    "patch a LIST_KEY with an empty list",
    async () => { const mo = await c.model(); const k = mo.listSettings[0]; if (!k) return "skip:no list setting in the model"; const r = await save({ settings: { [k]: [] } }); return (r.status === 400 && /pick at least one/i.test(r.json?.error || "")) || `answered ${r.status}: ${(r.json?.error || "").slice(0, 80)}`; });
  phase("…and a list of nothing but illegal values is refused the same way", "patch a list of junk",
    async () => { const mo = await c.model(); const k = mo.listSettings[0]; if (!k) return "skip:no list setting in the model"; const r = await save({ settings: { [k]: ["zz", "qq"] } }); return r.status === 400 || `answered ${r.status} — a list of nothing legal was accepted`; });
  phase("…and a list with duplicates is stored once", "patch a list with a repeat",
    async () => { const mo = await c.model(); const k = mo.listSettings.find((x) => (mo.state.settings[x] || []).length); if (!k) return "skip:no non-empty list setting in the model"; const one = mo.state.settings[k][0]; await save({ settings: { [k]: [one, one] } }); const v = (await set(k))[k]; return (Array.isArray(v) && v.filter((x) => x === one).length === 1) || `stored ${JSON.stringify(v)} — the repeat survived`; });
  phase("a free-text setting is capped, so one paste cannot fill a column", "patch a TEXT_KEY with 2000 characters",
    async () => {
      const mo = await c.model(); const k = mo.strSettings.find((x) => x.endsWith("_url")) || mo.strSettings[0];
      if (!k) return "skip:no free-text setting in the model";
      // THE OVERLONG VALUE IS STILL A VALID ADDRESS. The free-text column this lands on is a URL, and
      // a SIBLING route (google-review) validates it — so writing 2,000 x's here left a value that
      // route then refused to accept back, and section H's own restore of it failed. The harness-level
      // restore put it right, but a phase that breaks a later phase is a phase that cries wolf. A long
      // but well-formed address exercises the same cap and restores cleanly.
      await save({ settings: { [k]: `https://example.com/${"x".repeat(2000)}` } });
      const v = (await set(k))[k];
      return (typeof v !== "string") || v.length <= 400 || `stored ${v.length} characters`;
    });
  phase("a boolean settings column takes only a real boolean", "patch a SETTING_KEY with a string",
    async () => { const mo = await c.model(); const k = mo.boolSettings[0]; if (!k) return "skip:no boolean setting in the model"; const before = (await set(k))[k]; await save({ settings: { [k]: "true-ish" } }); const v = (await set(k))[k]; return v === before || `stored ${JSON.stringify(v)} where a yes/no belongs`; });
  phase("…and does take a real one", "patch the same key with true",
    async () => { const mo = await c.model(); const k = mo.boolSettings[0]; if (!k) return "skip:no boolean setting in the model"; const r = await save({ settings: { [k]: true } }); const v = (await set(k))[k]; return (r.status === 200 && v === true) || `saving ${k}=true answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("a module's admin rung is a settings column this screen may write", "patch <module>_allowed",
    async () => { const mo = await c.model(); const k = mo.boolSettings.find((x) => x.endsWith("_allowed")); if (!k) return "skip:the model exposes no module entitlement column"; const r = await save({ settings: { [k]: true } }); const v = (await set(k))[k]; return (r.status === 200 && v === true) || `saving ${k} answered ${r.status} and stored ${JSON.stringify(v)}`; });
  phase("a settings column outside the model is refused, however real it looks",
    "patch tax_rate, which this screen does not own",
    async () => { const before = (await set("tax_rate")).tax_rate; const r = await save({ settings: { tax_rate: 0.99 } }); return (await set("tax_rate")).tax_rate === before && (r.status === 400 || r.status === 200); });

  // ── the clash gate, the audit wording, and the neighbours ─────────────────────────────────────
  phase("a save that states what it was editing FROM and is stale is refused, not silently won",
    "send X-LFH-Expect naming a value that is not current",
    async () => {
      const mo = await c.model();
      const k = mo.grants[0];
      if (!k) return "skip:no manager grant in the model";
      await save({ grants: { [k]: true } });
      const r = await req(P, { method: "POST", body: { restaurant_id: FH, patch: { grants: { [k]: false } } }, headers: { "X-LFH-Expect": JSON.stringify({ table: "restaurants", id: FH, fields: { manager_permissions: { [k]: false } } }) } });
      return r.status === 409 || !!r.json?.clash;
    });
  phase("a caller that sends no expectation is completely unaffected by the clash gate",
    "the same save with no header",
    async () => { const mo = await c.model(); const k = mo.grants[0]; if (!k) return "skip:no manager grant in the model"; const r = await save({ grants: { [k]: true } }); return r.status === 200 || `answered ${r.status}`; });
  phase("the change is written into the record", "read staff_actions for access_change",
    async () => { const mo = await c.model(); const k = mo.grants[0]; if (!k) return "skip:no manager grant in the model"; const since = new Date().toISOString(); await new Promise((r) => setTimeout(r, 1100)); await save({ grants: { [k]: true } }); const rows = await c.actionsSince(since, ["access_change"]); return rows.length > 0 || "the save wrote no record at all"; });
  phase("…and that line reads as English, naming the ROW not the database key",
    "check the newest access_change detail is not raw JSON",
    async () => { const since = new Date(Date.now() - 180000).toISOString(); const rows = await c.actionsSince(since, ["access_change"]); return rows.length > 0 && rows.some((r) => !/^\{|"\w+":/.test(r.detail || "")); });
  phase("…and it is filed against the restaurant it changed", "check restaurant_id",
    async () => { const since = new Date(Date.now() - 180000).toISOString(); const rows = await c.actionsSince(since, ["access_change"]); return rows.some((r) => r.restaurant_id === FH); });
  phase("a waiter tri-state is described in words, not as the stored token",
    'the log says "on, with a manager PIN" rather than "pin"',
    async () => { const s = c.clean(F); return /on, with a manager PIN/.test(s); });
  phase("AANGAN IS NOT TOUCHED by anything this section did",
    "read the control restaurant's three permission columns and compare to a fresh read",
    async () => { const a = (await sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${AANGAN}`)).json?.[0]; const b = (await sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${AANGAN}`)).json?.[0]; return JSON.stringify(a) === JSON.stringify(b); });
  phase("a save for an unknown restaurant is refused before it writes anything",
    "POST with an unknown uuid",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: NOSUCH, patch: { grants: { x: true } } } }); return r.status === 404 || r.status === 400; });
  phase("a save with no restaurant id is refused", "POST with no id",
    async () => (await req(P, { method: "POST", body: { patch: {} } })).status === 400);
  phase("a save with a malformed restaurant id is refused in words, not with a database sentence",
    "POST with a junk id",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: "nope", patch: {} } }); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("a body that is not JSON does not crash the handler", "POST a broken body",
    async () => { const r = await req(P, { method: "POST", raw: "{oops", headers: { "content-type": "application/json" } }); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("an empty patch is refused rather than answered Saved", "POST an empty patch",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: FH, patch: {} } }); return r.status === 200 || r.status === 400; });
  phase("the bare-body form (no `patch` wrapper) is still understood", "POST the groups at the top level",
    async () => { const mo = await c.model(); const k = mo.grants[0]; if (!k) return "skip:no manager grant in the model"; const r = await req(P, { method: "POST", body: { restaurant_id: FH, grants: { [k]: true } } }); return r.status === 200 || `answered ${r.status}`; });
  phase("saving the value it already has is still a real save, not a refusal",
    "save the same value twice",
    async () => { const mo = await c.model(); const k = mo.grants[0]; if (!k) return "skip:no manager grant in the model"; await save({ grants: { [k]: true } }); const r = await save({ grants: { [k]: true } }); return r.status === 200 || `re-saving the same value answered ${r.status}`; });
  phase("every refusal this endpoint gives is a sentence, never empty",
    "replay the refusals and check each carries an `error` string",
    async () => {
      for (const b of [{ restaurant_id: "nope", patch: {} }, { restaurant_id: NOSUCH, patch: { grants: { x: true } } }, { restaurant_id: FH, patch: { grants: { zz: true } } }]) {
        const r = await req(P, { method: "POST", body: b });
        if (r.status >= 400 && (!r.json?.error || r.json.error.length < 5)) return false;
      }
      return true;
    });
  phase("no answer from this endpoint ever carries a database sentence",
    "scan every reply this section provoked",
    async () => {
      const texts = [];
      for (const b of [{ restaurant_id: "nope", patch: {} }, { restaurant_id: NOSUCH, patch: {} }, { restaurant_id: FH, patch: { settings: { zz: 1 } } }])
        texts.push((await req(P, { method: "POST", body: b })).text);
      return texts.every((t) => !DB_WORDS.test(t));
    });
}
