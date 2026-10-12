// Section I — the smaller routes behind a restaurant's page in the console: health, the remembered
// create form, branding + logo, the bill preview, and the four switch routes (Google review, delivery
// channels, quick features, staff features). The headline check here is MULTI-RESTAURANT: every live
// restaurant's answers are its OWN — the project's recurring fault is restaurant #1's branding showing
// on another restaurant. All reads; every restaurant other than French House is only ever read.
export default function section(c) {
  const live = async () => (c.cache.live ||= (await c.sq("restaurants?select=id,name,slug,logo_url&deleted_at=is.null&order=name&limit=200")).json);

  c.sec("I · every restaurant's own — the bill preview, for each live restaurant");
  c.phase("every live restaurant's bill preview is headed with that restaurant's own name, never French House's", "GET the preview for each; read the header", async () => {
    const bad = [];
    for (const r of await live()) {
      const s = (await c.sq(`settings?select=restaurant_name&restaurant_id=eq.${r.id}`)).json[0];
      const want = (s?.restaurant_name || r.name || "").trim();
      const p = await c.req(`/api/admin/restaurants/bill-preview?rid=${r.id}&mode=bill`);
      const text = p.text.replace(/<[^>]+>/g, " ");
      if (p.status !== 200 || (want && !text.toLowerCase().includes(want.toLowerCase().slice(0, 12)))) bad.push(`${r.name} (${p.status})`);
      if (r.id !== c.FH && /LITTLE FRENCH HOUSE/i.test(text) && !/french house/i.test(want)) bad.push(`${r.name} shows French House`);
    }
    return bad.length === 0 || bad.join(", ");
  });
  c.phase("…and no preview of any of them leaks code text (undefined, NaN, [object Object], ${)", "read every rendered page", async () => {
    const bad = [];
    for (const r of await live()) for (const m of ["bill", "kot"]) {
      const p = await c.req(`/api/admin/restaurants/bill-preview?rid=${r.id}&mode=${m}`);
      const t = p.text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
      if (/\bundefined\b|\bNaN\b|\[object Object\]|\$\{/.test(t)) bad.push(`${r.name}/${m}`);
    }
    return bad.length === 0 || bad.join(", ");
  });
  c.phase("a preview with no restaurant named is refused in words, not drawn as restaurant #1 (item 6)", "GET ?mode=bill",
    async () => { const r = await c.req("/api/admin/restaurants/bill-preview?mode=bill"); return r.status === 400 && !/French House/i.test(r.text) || `${r.status}`; });
  c.phase("the preview writes nothing and invents no money: its figures are one fixed sample", `read lib-backed route`, () => !/\.(insert|update|upsert|delete)\(/.test(c.clean("app/api/admin/restaurants/bill-preview/route.ts")));

  c.sec("I · every restaurant's own — branding and logo");
  c.phase("every live restaurant's branding answer is its own row's values", "GET branding for each; compare with the row", async () => {
    const bad = [];
    for (const r of await live()) {
      const g = await c.req(`/api/admin/restaurants/branding?restaurant_id=${r.id}`);
      const row = (await c.sq(`restaurants?select=accent_color,logo_url,logo_text,tagline&id=eq.${r.id}`)).json[0];
      if (g.status !== 200 || g.json.accent_color !== (row.accent_color ?? null) || g.json.logo_url !== (row.logo_url ?? null) || g.json.logo_text !== (row.logo_text ?? null)) bad.push(r.name);
    }
    return bad.length === 0 || bad.join(", ");
  });
  c.phase("no restaurant other than French House is handed French House's logo", "compare logo_url across restaurants", async () => {
    const fh = (await live()).find((x) => x.id === c.FH)?.logo_url;
    if (!fh) return { ok: true, note: "French House has no logo, so none can be shared" };
    const share = (await live()).filter((x) => x.id !== c.FH && x.logo_url === fh);
    return share.length === 0 || share.map((x) => x.name).join(", ");
  });
  c.phase("a stored logo lives in that restaurant's own folder", "every logo_url path starts with its restaurant id", async () => {
    const bad = (await live()).filter((x) => x.logo_url && !x.logo_url.includes(`/branding/${x.id}/`));
    return bad.length === 0 || bad.map((x) => x.name).join(", ");
  });
  c.phase("a branding save validates every colour as hex and drops any that is not", "read the route", () => /isHexColor\(a\)/.test(c.clean("app/api/admin/restaurants/branding/route.ts")) && /sanitizeBrandTheme\(body\.theme\)/.test(c.clean("app/api/admin/restaurants/branding/route.ts")));
  c.phase("…and a branding save with nothing in it is refused", "POST with only the id", async () => { const r = await c.req("/api/admin/restaurants/branding", { method: "POST", body: { restaurant_id: c.FH } }); return r.status === 400 && /Nothing to update/.test(r.json?.error) || `${r.status}`; });
  c.phase("…the three texts are capped (title 120, tagline 80, logo text 60)", "read the slices", () => { const s = c.clean("app/api/admin/restaurants/branding/route.ts"); return /slice\(0, 120\)/.test(s) && /slice\(0, 80\)/.test(s) && /slice\(0, 60\)/.test(s); });
  c.phase("a logo is a raster image of at most 1 MB — never SVG", "read the logo route", () => { const s = c.clean("app/api/admin/restaurants/logo/route.ts"); return /1048576/.test(s) && !/svg\+xml":/.test(s); });
  c.phase("…replacing a logo clears the old file so storage keeps only the current one", "read purgeLogos before upload", () => { const s = c.clean("app/api/admin/restaurants/logo/route.ts"); return s.indexOf("await purgeLogos(rid)") < s.indexOf(".upload(path"); });
  c.phase("…and a logo for a malformed restaurant is refused before storage is touched", "POST restaurant_id=nope", async () => { const f = new FormData(); f.set("restaurant_id", "nope"); f.set("file", new File([new Uint8Array(10)], "x.png", { type: "image/png" })); const r = await c.req("/api/admin/restaurants/logo", { method: "POST", form: f }); return r.status === 400 || `${r.status}`; });

  c.sec("I · every restaurant's own — the switches (quick features, and the three jobs Access now holds)");
  const eachLive = (label, path, check) => c.phase(label, `GET ${path} for every live restaurant; compare with its settings row`, async () => {
    const bad = [];
    for (const r of await live()) { const g = await c.req(`${path}?restaurant_id=${r.id}`); const s = (await c.sq(`settings?select=*&restaurant_id=eq.${r.id}`)).json[0] || {}; if (g.status !== 200 || !check(g.json, s)) bad.push(r.name); }
    return bad.length === 0 || bad.join(", ");
  });
  eachLive("Quick features: banquet / auto-print / pay match each restaurant's own columns", "/api/admin/restaurants/quick-features",
    (j, s) => j.auto_print_kot === (s.auto_print_kot_allowed === true && s.auto_print_kot === true) && j.auto_print_kot_allowed === (s.auto_print_kot_allowed === true) && j.banquet === (s.banquet_allowed === true && (s.banquet_owner_control !== true || s.banquet_enabled !== false)));
  // ── THE THREE RETIRED DOORS (round 2, item 13) — Google review, delivery channels, staff features.
  // No screen called them; Access & permissions does all three jobs. Each phase below keeps its id
  // and now checks the job where it really lives.
  const GONE = ["google-review", "platform-channels", "staff-features"];
  c.phase("the retired staff-features door is gone, and no screen, script or library still calls it", "the files are absent; grep app, components, lib and public", async () => {
    const { existsSync, readdirSync } = await import("node:fs");
    if (GONE.some((g) => existsSync(`${c.ROOT}app/api/admin/restaurants/${g}/route.ts`))) return "a retired route file is back";
    const walk = (d) => readdirSync(`${c.ROOT}${d}`, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" ? [] : e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(t|j)sx?$|\.mjs$/.test(e.name) ? [`${d}/${e.name}`] : []);
    // Code only, comments stripped: a comment recording that a door was retired is history, not a caller.
    const hits = ["app", "components", "lib", "public"].flatMap(walk).filter((f) => GONE.some((g) => c.clean(f).includes(`/api/admin/restaurants/${g}`)));
    return hits.length === 0 || `still called from ${hits.join(", ")}`;
  });
  const access = async (rid) => (c.cache[`acc${rid}`] ||= (await c.req(`/api/admin/restaurants/access-tree?restaurant_id=${rid}`)).json?.state);
  c.phase("Access shows each live restaurant's OWN Google review link and a legal review mode", "GET the Access state for every live restaurant; compare with its settings row", async () => {
    const bad = [];
    for (const r of await live()) { const st = await access(r.id); const s = (await c.sq(`settings?select=google_review_url,google_review_mode&restaurant_id=eq.${r.id}`)).json[0] || {};
      if ((st?.settings?.google_review_url ?? null) !== (s.google_review_url ?? null) && !(st?.settings?.google_review_url === "" && !s.google_review_url)) bad.push(r.name);
      if (!["off", "google", "google_plus_normal", "google_after_normal"].includes(st?.settings?.google_review_mode)) bad.push(`${r.name} (mode)`); }
    return bad.length === 0 || bad.join(", ");
  });
  c.phase("Access shows each live restaurant's OWN delivery-channel on/off", "compare state.channels with settings.platform_channels", async () => {
    const bad = [];
    for (const r of await live()) { const st = await access(r.id); const s = (await c.sq(`settings?select=platform_channels&restaurant_id=eq.${r.id}`)).json[0] || {};
      if (!["zomato", "swiggy", "website"].every((k) => st?.channels?.[k] === (s.platform_channels?.[k]?.on === true))) bad.push(r.name); }
    return bad.length === 0 || bad.join(", ");
  });
  c.phase("the quick-feature route refuses a malformed restaurant id, and the three retired doors are simply not there", "GET quick-features ?restaurant_id=nope; GET each retired path signed in", async () => {
    const q = await c.req("/api/admin/restaurants/quick-features?restaurant_id=nope"); if (q.status !== 400) return `quick-features answered ${q.status}`;
    for (const g of GONE) { const r = await c.req(`/api/admin/restaurants/${g}?restaurant_id=${c.FH}`); if (r.status !== 404) return `${g} answered ${r.status}`; }
    return true;
  });
  c.phase("…an unknown quick feature, and an unknown delivery channel on Access, are refused without writing", "POST each with a made-up name; compare the settings row", async () => {
    const b = JSON.stringify((await c.sq(`settings?select=*&restaurant_id=eq.${c.FH}`)).json[0]);
    const a = await c.req("/api/admin/restaurants/quick-features", { method: "POST", body: { restaurant_id: c.FH, feature: "teleport", on: true } });
    const p = await c.req("/api/admin/restaurants/access-tree", { method: "POST", body: { restaurant_id: c.FH, patch: { channels: { teleport: true } } } });
    const after = JSON.stringify((await c.sq(`settings?select=*&restaurant_id=eq.${c.FH}`)).json[0]);
    return a.status === 400 && p.status === 400 && b === after || `${a.status}/${p.status}`;
  });
  c.phase("…a Google review link that is not a web address is refused on Access (item 23)", "POST google_review_url='ftp://example.com'", async () => {
    const b = (await c.sq(`settings?select=google_review_url&restaurant_id=eq.${c.FH}`)).json[0].google_review_url;
    const r = await c.req("/api/admin/restaurants/access-tree", { method: "POST", body: { restaurant_id: c.FH, patch: { settings: { google_review_url: "ftp://example.com" } } } });
    const a = (await c.sq(`settings?select=google_review_url&restaurant_id=eq.${c.FH}`)).json[0].google_review_url;
    return r.status === 400 && /https:\/\//.test(r.json?.error) && a === b || `${r.status} ${r.json?.error}`;
  });
  c.phase("…and so is one pasted without its https:// — it would send a guest to a page of our own site", "POST google_review_url='g.page/r/abc/review'", async () => {
    const b = (await c.sq(`settings?select=google_review_url&restaurant_id=eq.${c.FH}`)).json[0].google_review_url;
    const r = await c.req("/api/admin/restaurants/access-tree", { method: "POST", body: { restaurant_id: c.FH, patch: { settings: { google_review_url: "g.page/r/abc/review" } } } });
    const a = (await c.sq(`settings?select=google_review_url&restaurant_id=eq.${c.FH}`)).json[0].google_review_url;
    return r.status === 400 && a === b || `${r.status}`;
  });
  c.phase("a delivery key keeps its one rule ('' leaves it, null clears it) now that Access is its only writer", "read access-tree: it goes through lib/channelKey", () => /applyChannelKey/.test(c.clean("app/api/admin/restaurants/access-tree/route.ts")));

  c.sec("I · health and the remembered create form");
  c.phase("health has one row per live restaurant and no money field", "GET; compare with a head count", async () => {
    const r = await c.req("/api/admin/restaurants/health"); const n = await c.count("restaurants", "deleted_at=is.null");
    return r.status === 200 && r.json.health.length === n && !/₹|revenue|amount|total/.test(r.text) || `${r.json?.health?.length} vs ${n}`;
  });
  c.phase("…and French House's 'open issues' is a real count, never more than the issues still open on record", "compare with a head count of its unresolved issues", async () => {
    const h = (await c.req("/api/admin/restaurants/health")).json.health.find((x) => x.restaurant_id === c.FH);
    const n = await c.count("issues", `restaurant_id=eq.${c.FH}&status=neq.resolved&status=neq.closed`);
    return typeof h.open_issues === "number" && h.open_issues <= n + 0 && h.open_issues >= 0 || { ok: false, note: `health ${h.open_issues}, open issues ${n}` };
  });
  c.phase("the remembered create form is exactly what app_config stores (or null the first time)", "compare with the row", async () => {
    const r = await c.req("/api/admin/restaurants/create-defaults"); const row = (await c.sq("app_config?select=value&key=eq.restaurant_creation_defaults")).json[0];
    return JSON.stringify(r.json.defaults) === JSON.stringify(row ? row.value : null) || "differs";
  });
  c.phase("…and it remembers panels and the sample menu only — no permission set", "read the stored keys", async () => { const d = (await c.req("/api/admin/restaurants/create-defaults")).json.defaults; return !d || Object.keys(d).every((k) => ["panels", "seedMenu"].includes(k)) || Object.keys(d).join(","); });
}
