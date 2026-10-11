// Section F — Access & permissions (/restaurants/access-tree), a restaurant's Settings tab
// (/restaurants/settings, with the per-table QR codes) and the platform Settings page (/settings).
// Read for every rule; driven on reads and refusals only — no switch moves (another terminal flips
// access switches on the shared database while this runs, so this section never writes one).
import { restoreOnExit } from "../restore.mjs";

export default function section(c) {
  const A = "app/api/admin/restaurants/access-tree/route.ts";
  // BELT AND BRACES. Every POST in this section is a path that must REFUSE, so nothing should change —
  // but a refusal that one day starts succeeding would leave French House changed. So the three
  // permission columns, the two menu lists and every table's QR code are read before the first POST
  // and put back on exit, on a throw, and on an interruption (verify:test-safety rules 11 and the QR
  // rule). Only the values that DIFFER are written back, so a clean run writes nothing at all.
  let saved = null;
  const capture = async () => {
    if (saved) return;
    saved = {
      rest: (await c.sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${c.FH}`)).json[0],
      set: (await c.sq(`settings?select=menu_languages,menu_currencies&restaurant_id=eq.${c.FH}`)).json[0],
      codes: (await c.sq(`table_qr_codes?select=table_number,code&restaurant_id=eq.${c.FH}&limit=600`)).json,
    };
    restoreOnExit("French House · access columns, menu lists and table QR codes (T29 section F)", async () => {
      const r = (await c.sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${c.FH}`)).json[0];
      if (JSON.stringify(r) !== JSON.stringify(saved.rest)) await c.sq(`restaurants?id=eq.${c.FH}`, { method: "PATCH", body: JSON.stringify(saved.rest) });
      const st = (await c.sq(`settings?select=menu_languages,menu_currencies&restaurant_id=eq.${c.FH}`)).json[0];
      if (JSON.stringify(st) !== JSON.stringify(saved.set)) await c.sq(`settings?restaurant_id=eq.${c.FH}`, { method: "PATCH", body: JSON.stringify(saved.set) });
      const now = new Map(((await c.sq(`table_qr_codes?select=table_number,code&restaurant_id=eq.${c.FH}&limit=600`)).json || []).map((x) => [x.table_number, x.code]));
      for (const x of saved.codes) if (now.get(x.table_number) !== x.code) await c.sq(`table_qr_codes?restaurant_id=eq.${c.FH}&table_number=eq.${x.table_number}`, { method: "PATCH", body: JSON.stringify({ code: x.code }) });
    });
  };
  const RS = "app/api/admin/restaurants/settings/route.ts";
  const ST = "app/api/admin/settings/route.ts";
  const tree = async (rid) => (c.cache[`t${rid}`] ||= await c.req(`/api/admin/restaurants/access-tree?restaurant_id=${rid}`));

  c.sec("F · Access & permissions — the state, cross-checked");
  c.phase("French House's state answers, and is the state alone (no 25 KB model riding along)", "GET", async () => { const r = await tree(c.FH); return r.status === 200 && Object.keys(r.json).join() === "state" || `${r.status} ${Object.keys(r.json || {})}`; });
  c.phase("its manager grants are exactly what the restaurants row stores", "compare grants with manager_permissions", async () => {
    const g = (await tree(c.FH)).json.state.grants; const mp = (await c.sq(`restaurants?select=manager_permissions&id=eq.${c.FH}`)).json[0].manager_permissions || {};
    const wrong = Object.keys(g).filter((k) => k in mp && mp[k] !== g[k]);
    return wrong.length === 0 || `differs on ${wrong.join(", ")}`;
  });
  c.phase("its guest features are exactly what the settings row stores", "compare features with settings.features", async () => {
    const f = (await tree(c.FH)).json.state.features; const sf = (await c.sq(`settings?select=features&restaurant_id=eq.${c.FH}`)).json[0].features || {};
    const wrong = Object.keys(f).filter((k) => k in sf && !!sf[k] !== !!f[k]);
    return wrong.length === 0 || `differs on ${wrong.join(", ")}`;
  });
  c.phase("its waiter tri-states are read straight from their columns", "compare tablet_* settings", async () => {
    const st = (await tree(c.FH)).json.state.settings; const cols = Object.keys(st).filter((k) => k.startsWith("tablet_"));
    const row = (await c.sq(`settings?select=${cols.join(",")}&restaurant_id=eq.${c.FH}`)).json[0];
    const wrong = cols.filter((k) => row[k] !== st[k]);
    return wrong.length === 0 || wrong.join(", ");
  });
  c.phase("no delivery-app KEY appears in the state — only whether each channel is on", "search the answer", async () => !/"(key|api_key)"\s*:\s*"[^"]/.test((await tree(c.FH)).text) || "a key value in the state");
  c.phase("Aangan's state is its own, and differs from French House's (read only — it is the control)", "GET for Aangan; compare", async () => {
    const a = await tree(c.AANGAN), f = await tree(c.FH);
    return a.status === 200 && JSON.stringify(a.json.state) !== JSON.stringify(f.json.state) || "identical to French House";
  });
  c.phase("a malformed restaurant id is refused in words", "GET restaurant_id=nope", async () => { const r = await c.req("/api/admin/restaurants/access-tree?restaurant_id=nope"); return r.status === 400 || `${r.status}`; });

  c.sec("F · Access & permissions — read for every rule");
  c.phase("every allow-list is derived from the one model (lib/accessTree), never retyped", `read ${A} imports`, () => /from "@\/lib\/accessTree"/.test(c.raw(A)) && /FEATURE_KEYS, SETTING_KEYS, CHOICE_KEYS/.test(c.raw(A)));
  c.phase("first save wins, the loser is told — the clash gate runs before any merge", "read POST order", () => { const s = c.clean(A); return s.indexOf("expectClash(req, rid)") < s.indexOf("const patch = obj(body.patch ?? body)"); });
  c.phase("a discount ceiling is clamped to what its own dropdown offers", "read the limit branch", () => /Math\.max\(0, Math\.min\(n, ceiling\)\)/.test(c.clean(A)));
  c.phase("a pick-one sub-option only takes one of its own choices (T18 item 18)", "read the opts branch", () => /isn't one of the choices for/.test(c.clean(A)));
  c.phase("a menu with no language or no currency is refused, never saved blank", "read the list branch", () => /pick at least one\./.test(c.clean(A)));
  c.phase("everything is validated before anything is written", "read POST order", () => { const s = c.clean(A); return s.indexOf("pick at least one") < s.indexOf('sb.from("restaurants").update(restUpdate)'); });
  c.phase("a save that landed nowhere says so, never 'Saved'", "read the end of POST", () => /Nothing in that change could be saved — this screen does not own/.test(c.clean(A)));
  c.phase("a guest-facing switch reaches guests NOW — the menu cache is dropped with expire:0", "read the revalidate", () => /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(c.clean(A)));
  c.phase("every save is in the Activity log, and a credential's VALUE never is", "read describeAccessPatch + the log call", () => /`\$\{k\} key: \$\{a === "clear" \? "removed" : "saved"\}`/.test(c.clean(A)) && /logAction\("admin", "access_change"/.test(c.clean(A)));
  c.phase("a stored delivery key survives a save that does not retype it ('' leaves it alone)", "read the creds branch → applyChannelKey", () => /next\[k\] = applyChannelKey\(obj\(next\[k\]\), v\)/.test(c.clean(A)));
  c.phase("unknown permission ids collect nothing in access_config", "read the write-back", () => /if \(KNOWN_CONFIG_IDS\.has\(permId\)\) root\[permId\] = entry;/.test(c.clean(A)));

  c.sec("F · Access & permissions — driven refusals (nothing written)");
  const save = async (patch) => { await capture(); return c.req("/api/admin/restaurants/access-tree", { method: "POST", body: { restaurant_id: c.FH, patch } }); };
  const snap = async () => JSON.stringify((await c.sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${c.FH}`)).json[0]);
  c.phase("a guest menu with NO language is refused and nothing moves", "POST settings.menu_languages: []", async () => {
    const b = await snap(); const l0 = JSON.stringify((await c.sq(`settings?select=menu_languages&restaurant_id=eq.${c.FH}`)).json[0]);
    const r = await save({ settings: { menu_languages: [] }, grants: { edit_menu: true } });
    const l1 = JSON.stringify((await c.sq(`settings?select=menu_languages&restaurant_id=eq.${c.FH}`)).json[0]);
    return r.status === 400 && /pick at least one/.test(r.json?.error) && b === await snap() && l0 === l1 || `${r.status} ${r.json?.error}`;
  });
  c.phase("…the grant riding in the same patch did NOT land either (validated first, written after)", "same patch, re-read the grant", async () => {
    const b = await snap(); await save({ settings: { menu_currencies: [] }, grants: { view_ratings: true } }); return b === await snap() || "half the patch landed";
  });
  c.phase("a pick-one sent as `true` is refused in words", "POST config.maintenance.manager_opts.who = true", async () => {
    const b = await snap(); const r = await save({ config: { maintenance: { manager_opts: { who: true } } } });
    return r.status === 400 && b === await snap() || `${r.status}`;
  });
  c.phase("an on/off sub-option sent as a word is refused", "POST config.edit_menu.manager_opts.add_dish = 'yes'", async () => {
    const b = await snap(); const r = await save({ config: { edit_menu: { manager_opts: { add_dish: "yes" } } } });
    return r.status === 400 && b === await snap() || `${r.status}`;
  });
  c.phase("a patch of only unknown owner sections says nothing could be saved", "POST sections.zz", async () => { const r = await save({ sections: { zz_nope: true } }); return r.status === 400 || `${r.status}`; });
  c.phase("a patch of only unknown delivery channels says the same", "POST channels.zz", async () => { const r = await save({ channels: { zz_nope: true } }); return r.status === 400 || `${r.status}`; });
  c.phase("a save for a malformed restaurant is refused before anything is read", "POST restaurant_id=nope", async () => { const r = await c.req("/api/admin/restaurants/access-tree", { method: "POST", body: { restaurant_id: "nope", patch: {} } }); return r.status === 400 || `${r.status}`; });

  c.sec("F · a restaurant's Settings tab — cross-checked, and read for every rule");
  const rs = async (rid) => (c.cache[`rs${rid}`] ||= await c.req(`/api/admin/restaurants/settings?restaurant_id=${rid}`));
  c.phase("French House's settings answer with its own slug", "GET; compare the slug", async () => {
    const r = await rs(c.FH); const s = (await c.sq(`restaurants?select=slug&id=eq.${c.FH}`)).json[0].slug;
    return r.status === 200 && r.json.slug === s || `${r.json?.slug} vs ${s}`;
  });
  c.phase("every table 1..table_count has a QR code, and no more", "count the codes", async () => {
    const r = (await rs(c.FH)).json; const n = Math.min(Math.max(Math.round(Number(r.settings.table_count)) || 12, 1), 500);
    return Object.keys(r.codes).length === n && Object.keys(r.codes).every((k) => Number(k) >= 1 && Number(k) <= n) || `${Object.keys(r.codes).length} for ${n}`;
  });
  c.phase("…each code is 8 characters from the no-lookalike alphabet (no 0, O, 1, I, L)", "check each", async () => Object.values((await rs(c.FH)).json.codes).every((x) => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(x)) || "a code outside the alphabet");
  c.phase("…no two tables share a code", "compare", async () => { const v = Object.values((await rs(c.FH)).json.codes); return new Set(v).size === v.length || "duplicate codes"; });
  c.phase("…and each matches the stored code for that table", "compare with table_qr_codes", async () => {
    const codes = (await rs(c.FH)).json.codes; const rows = (await c.sq(`table_qr_codes?select=table_number,code&restaurant_id=eq.${c.FH}&limit=600`)).json;
    const m = new Map(rows.map((x) => [String(x.table_number), x.code]));
    return Object.entries(codes).every(([t, code]) => m.get(t) === code) || "a code differs from the database";
  });
  c.phase("Aangan's codes are its own (read only)", "GET Aangan; every code is stored under Aangan", async () => {
    const r = (await rs(c.AANGAN)).json; const v = Object.values(r.codes);
    const rows = (await c.sq(`table_qr_codes?select=restaurant_id&code=in.(${v.join(",")})`)).json;
    return rows.length === v.length && rows.every((x) => x.restaurant_id === c.AANGAN) || "a code belongs to another restaurant";
  });
  c.phase("the tab reads and writes only its own named columns", `read ${RS}`, () => /const SELECT = SETTINGS_COLS\.join\(", "\)/.test(c.clean(RS)) && !/select\("\*"\)\.eq\("restaurant_id", rid\)/.test(c.clean(RS)));
  c.phase("a typo can never move a restaurant onto another tax posture (unknown → 'excl', 'none')", "read sanitize", () => /out\.price_tax_mode = v === "incl" \|\| v === "composition" \? v : "excl"/.test(c.clean(RS)) && /=== "inclusive" \? "inclusive" : "none"/.test(c.clean(RS)));
  c.phase("the GST rate is held to 0-50% (the database's own range, T30 item 18)", "read sanitize", () => /v >= 0 && v <= 0\.5 \? v : null/.test(c.clean(RS)));
  c.phase("tables are held to 1-500, seats to 1-30, table names to 24 characters", "read sanitize", () => /Math\.min\(Math\.max\(n, 1\), 500\)/.test(c.clean(RS)) && /Math\.min\(Math\.max\(n, 1\), 30\)/.test(c.clean(RS)) && /slice\(0, 24\)/.test(c.clean(RS)));
  c.phase("the retired kitchen-ticket target column can no longer be written", "read SETTINGS_COLS", () => !/"kot_print_target"/.test(c.clean(RS)));
  c.phase("the banquet starting number is refused once a banquet bill exists, and on a failed count", "read the lock", () => /if \(issued\.error \|\| cur\.error\)/.test(c.clean(RS)) && /already been issued, so the starting number can't be changed/.test(c.clean(RS)));
  c.phase("a save with nothing in it is refused", "POST with only the restaurant id", async () => { await capture(); const r = await c.req("/api/admin/restaurants/settings", { method: "POST", body: { restaurant_id: c.FH } }); return r.status === 400 && /nothing to save/.test(r.json?.error) || `${r.status}`; });
  c.phase("renewing table 0's QR code is refused (only tables 1-500 have one)", "POST regen_code table 0", async () => { await capture(); const r = await c.req("/api/admin/restaurants/settings", { method: "POST", body: { restaurant_id: c.FH, action: "regen_code", table: 0 } }); return r.status === 400 || `${r.status}`; });

  c.sec("F · the platform Settings page");
  c.phase("it names the stack it is pointed at — this run is the backup/test stack", "GET; read environment", async () => { const r = await c.req("/api/admin/settings"); c.cache.st = r.json; return r.json.environment?.name === "Backup / test" && r.json.environment.live === false || JSON.stringify(r.json.environment); });
  c.phase("…and carries no key or address, only the short project name", "search the answer", async () => !/supabase\.co|eyJ|service_role/.test(JSON.stringify(c.cache.st)) || "an address or key in the answer");
  c.phase("its retention lock is exactly what app_config stores", "compare with the log_retention_lock row", async () => {
    const row = (await c.sq("app_config?select=value&key=eq.log_retention_lock")).json[0];
    const want = row ? { locked: row.value?.locked === true, at: row.value?.at ?? null } : { locked: false, at: null };
    return JSON.stringify(c.cache.st.retentionLock) === JSON.stringify(want) || `${JSON.stringify(c.cache.st.retentionLock)} vs ${JSON.stringify(want)}`;
  });
  c.phase("the audit-years options are the owner's five", "read auditYearOptions", async () => JSON.stringify(c.cache.st.auditYearOptions) === "[1,3,5,7,10]");
  c.phase("a save with nothing to change is refused", "POST {}", async () => { const r = await c.req("/api/admin/settings", { method: "POST", body: {} }); return r.status === 400 || `${r.status}`; });
  c.phase("a failed lock read refuses the page instead of drawing the lock OFF (item 7)", `read ${ST}`, () => /if \("error" in lock\) return adminFail\(/.test(c.clean(ST)));
  c.phase("the windows are capped at a month, and audit years snap to the offered set, longer on a tie", "read the clamps", () => /Math\.min\(Math\.max\(n, 1\), 30\)/.test(c.clean(ST)) && /o > best\) \? o : best, 10\)/.test(c.clean(ST)));
  c.phase("turning the lock on never rewrites any restaurant's windows", "read POST: the lock write is separate from the settings update", () => { const s = c.clean(ST); return /if \(!Object\.keys\(patch\)\.length && lockWrote\)/.test(s); });
}
