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

  c.sec("I · every restaurant's own — the four switch routes");
  const eachLive = (label, path, check) => c.phase(label, `GET ${path} for every live restaurant; compare with its settings row`, async () => {
    const bad = [];
    for (const r of await live()) { const g = await c.req(`${path}?restaurant_id=${r.id}`); const s = (await c.sq(`settings?select=*&restaurant_id=eq.${r.id}`)).json[0] || {}; if (g.status !== 200 || !check(g.json, s)) bad.push(r.name); }
    return bad.length === 0 || bad.join(", ");
  });
  eachLive("Quick features: banquet / auto-print / pay match each restaurant's own columns", "/api/admin/restaurants/quick-features",
    (j, s) => j.auto_print_kot === (s.auto_print_kot_allowed === true && s.auto_print_kot === true) && j.auto_print_kot_allowed === (s.auto_print_kot_allowed === true) && j.banquet === (s.banquet_allowed === true && (s.banquet_owner_control !== true || s.banquet_enabled !== false)));
  eachLive("Staff features: the two entitlement flags match each restaurant's own columns", "/api/admin/restaurants/staff-features",
    (j, s) => j.flags.auto_print_kot_allowed === !!s.auto_print_kot_allowed && j.flags.banquet_allowed === !!s.banquet_allowed);
  eachLive("Google review: each restaurant's own link and a legal mode", "/api/admin/restaurants/google-review",
    (j, s) => j.url === (s.google_review_url ?? null) && ["off", "google", "google_plus_normal", "google_after_normal"].includes(j.mode));
  eachLive("Delivery channels: each restaurant's own on/off, and whether a key is stored — never the key", "/api/admin/restaurants/platform-channels",
    (j, s) => ["zomato", "swiggy", "website"].every((k) => j.channels[k].on === (s.platform_channels?.[k]?.on === true)) && !/"key"\s*:\s*"/.test(JSON.stringify(j)));
  c.phase("the four switch routes refuse a malformed restaurant id in words", "GET each with restaurant_id=nope", async () => {
    for (const p of ["quick-features", "staff-features", "google-review", "platform-channels"]) { const r = await c.req(`/api/admin/restaurants/${p}?restaurant_id=nope`); if (r.status !== 400) return `${p} answered ${r.status}`; }
    return true;
  });
  c.phase("…and refuse an unknown feature / staff feature / channel name without writing", "POST each with a made-up name", async () => {
    const b = JSON.stringify((await c.sq(`settings?select=*&restaurant_id=eq.${c.FH}`)).json[0]);
    const a = await c.req("/api/admin/restaurants/quick-features", { method: "POST", body: { restaurant_id: c.FH, feature: "teleport", on: true } });
    const s = await c.req("/api/admin/restaurants/staff-features", { method: "POST", body: { restaurant_id: c.FH, key: "teleport_allowed", value: true } });
    const p = await c.req("/api/admin/restaurants/platform-channels", { method: "POST", body: { restaurant_id: c.FH, channel: "teleport", on: true } });
    const after = JSON.stringify((await c.sq(`settings?select=*&restaurant_id=eq.${c.FH}`)).json[0]);
    return a.status === 400 && s.status === 400 && p.status === 400 && b === after || `${a.status}/${s.status}/${p.status}`;
  });
  c.phase("…and a Google link that is not http(s) is refused", "POST url=ftp://x", async () => { const r = await c.req("/api/admin/restaurants/google-review", { method: "POST", body: { restaurant_id: c.FH, url: "ftp://example.com", mode: "google" } }); return r.status === 400 && /http/.test(r.json?.error) || `${r.status}`; });
  c.phase("…and so is a link over 500 characters", "POST a 600-character url", async () => { const r = await c.req("/api/admin/restaurants/google-review", { method: "POST", body: { restaurant_id: c.FH, url: "https://x.com/" + "a".repeat(600), mode: "google" } }); return r.status === 400 && /too long/.test(r.json?.error) || `${r.status}`; });
  c.phase("a delivery key save from either screen means the same thing ('' leaves it, null clears it)", "read both routes: they call lib/channelKey", () => /applyChannelKey/.test(c.clean("app/api/admin/restaurants/platform-channels/route.ts")) && /applyChannelKey/.test(c.clean("app/api/admin/restaurants/access-tree/route.ts")));

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
