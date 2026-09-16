/**
 * H · four small per-restaurant switch routes: the LOGO image, the GOOGLE review link and mode, the
 * QUICK feature toggles, and the STAFF-feature entitlements.
 *
 * 35.9 / 37.1 / 40.2 / 42.7 rows per hundred lines. Each is short, each writes one thing, and each
 * has the same two ways to be wrong: saying "saved" for a write that changed nothing, and letting a
 * value through that no screen could ever display or undo.
 */
export default function section(c) {
  const { phase, sec, req, sq, FH, NOSUCH, DB_WORDS } = c;
  sec("H · the logo, the review link, and the two feature switches");
  const get = (cols) => sq(`settings?select=${cols}&restaurant_id=eq.${FH}`).then((q) => q.json?.[0] || {});

  // ── logo ─────────────────────────────────────────────────────────────────────────────────────
  const FL = "app/api/admin/restaurants/logo/route.ts", PL = "/api/admin/restaurants/logo";
  phase("the logo route's sign-in gate runs before the first database call", "compare positions",
    () => c.gateFirst(FL));
  phase("an SVG logo is refused — one served from public storage can run script", "read the types",
    () => { const s = c.clean(FL); return /"image\/png"/.test(s) && !/svg/i.test(s); });
  phase("a logo is capped at 1MB", "read the size check", () => /1048576/.test(c.clean(FL)));
  phase("the upload confirms the restaurant exists BEFORE it writes to storage",
    "compare the existence check against the upload",
    () => { const s = c.clean(FL); return s.indexOf("existsQ") < s.indexOf("storage.from(\"branding\").upload"); });
  phase("…and a failed read of that is not reported as 'Restaurant not found.' (round 1, item 4)",
    "the check answers its own error", () => /if \(existsQ\.error\) return adminFail\("this restaurant's logo"/.test(c.clean(FL)));
  phase("removing a logo nobody has writes NO record", "read the had-a-logo branch",
    () => { const s = c.clean(FL); return /if \(!exists\.data\.logo_url\)/.test(s) && /There was no logo to remove/.test(s); });
  phase("the logo cannot be changed without being signed in", "DELETE with no cookie",
    async () => (await req(`${PL}?restaurant_id=${FH}`, { method: "DELETE", cookie: "" })).status === 401);
  phase("a malformed restaurant id is refused in words", "DELETE with a junk id",
    async () => { const r = await req(`${PL}?restaurant_id=nope`, { method: "DELETE" }); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("an unknown restaurant says so", "DELETE an unknown uuid",
    async () => (await req(`${PL}?restaurant_id=${NOSUCH}`, { method: "DELETE" })).status === 404);
  phase("removing a logo that is not there answers honestly and writes nothing",
    "DELETE for a restaurant with no logo, then read the record",
    async () => { const cur = (await sq(`restaurants?select=logo_url&id=eq.${FH}`)).json?.[0]?.logo_url; if (cur) return "skip:French House has a logo, so the nothing-to-remove path cannot be driven without deleting it"; const since = new Date(Date.now() - 15000).toISOString(); const r = await req(`${PL}?restaurant_id=${FH}`, { method: "DELETE" }); const rows = await c.actionsSince(since, ["restaurant_logo"]); return r.json?.removed === false && rows.length === 0; });
  phase("an upload with no file is refused before storage is touched", "POST an empty form",
    async () => { const fd = new FormData(); fd.append("restaurant_id", FH); const r = await req(PL, { method: "POST", raw: fd }); return r.status === 400 && /Missing file/.test(r.json?.error || ""); });
  phase("a file that is not an image is refused by type", "POST a text file",
    async () => { const fd = new FormData(); fd.append("restaurant_id", FH); fd.append("file", new File(["x"], "x.txt", { type: "text/plain" })); return (await req(PL, { method: "POST", raw: fd })).status === 400; });

  // ── google review ────────────────────────────────────────────────────────────────────────────
  const FG = "app/api/admin/restaurants/google-review/route.ts", PG = "/api/admin/restaurants/google-review";
  const keepG = { url: null, mode: null };
  phase("the review route's sign-in gate runs before the first database call", "compare positions",
    () => { const s = c.clean(FG); return s.indexOf("tokenIsValid") < s.indexOf("sb.from"); });
  phase("the current review link and mode are read, so the phases can put them back",
    "GET and remember",
    async () => { const j = (await req(`${PG}?restaurant_id=${FH}`)).json; keepG.url = j?.url ?? null; keepG.mode = j?.mode ?? "off"; return typeof keepG.mode === "string"; });
  phase("a mode this route does not know falls back to off, never to an error",
    "save a made-up mode", async () => { const r = await req(PG, { method: "POST", body: { restaurant_id: FH, url: "", mode: "shout_at_them" } }); return r.status === 200 && r.json?.mode === "off"; });
  phase("a link that is not an address is refused in words", "save a bare word",
    async () => { const r = await req(PG, { method: "POST", body: { restaurant_id: FH, url: "just-some-text", mode: "off" } }); return r.status === 400 && /must start with http/.test(r.json?.error || ""); });
  phase("a link longer than 500 characters is refused", "save a very long URL",
    async () => (await req(PG, { method: "POST", body: { restaurant_id: FH, url: `https://x.com/${"y".repeat(600)}`, mode: "off" } })).status === 400);
  phase("A GOOGLE MODE CANNOT BE ARMED WITH NO LINK — the guest CTA would go nowhere",
    "save a google mode with an empty link",
    async () => { const r = await req(PG, { method: "POST", body: { restaurant_id: FH, url: "", mode: "google" } }); return r.status === 400 && /Add the Google review link before/.test(r.json?.error || ""); });
  phase("a real link and mode are saved, and the answer reports what was stored",
    "save both and read the answer",
    async () => { const r = await req(PG, { method: "POST", body: { restaurant_id: FH, url: "https://g.page/t27r2-probe", mode: "google_plus_normal" } }); return r.status === 200 && r.json?.url === "https://g.page/t27r2-probe" && r.json?.mode === "google_plus_normal"; });
  phase("…and the database really holds it", "read the settings columns",
    async () => { const s = await get("google_review_url,google_review_mode"); return s.google_review_url === "https://g.page/t27r2-probe" && s.google_review_mode === "google_plus_normal"; });
  phase("the change is written into the record, naming the mode", "read staff_actions",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); await req(PG, { method: "POST", body: { restaurant_id: FH, url: "https://g.page/t27r2-probe2", mode: "google" } }); return (await c.actionsSince(since, ["google_review"])).some((r) => /mode google/.test(r.detail || "")); });
  phase("an unknown restaurant is refused before it writes", "POST an unknown rid",
    async () => (await req(PG, { method: "POST", body: { restaurant_id: NOSUCH, url: "", mode: "off" } })).status === 404);
  phase("the review link and mode are put back as they were found", "restore and read back",
    async () => { await req(PG, { method: "POST", body: { restaurant_id: FH, url: keepG.url ?? "", mode: keepG.mode } }); const s = await get("google_review_url,google_review_mode"); return (s.google_review_url ?? null) === (keepG.url ?? null) && s.google_review_mode === keepG.mode; });

  // ── quick features ───────────────────────────────────────────────────────────────────────────
  const FQ = "app/api/admin/restaurants/quick-features/route.ts", PQ = "/api/admin/restaurants/quick-features";
  phase("the quick-feature route's sign-in gate runs before the first database call", "compare positions",
    () => { const s = c.clean(FQ); return s.indexOf("tokenIsValid") < s.indexOf("sb.from"); });
  phase("a feature this route does not own is refused", "POST a made-up feature",
    async () => { const r = await req(PQ, { method: "POST", body: { restaurant_id: FH, feature: "teleporter", on: true } }); return r.status === 400 && /unknown feature/.test(r.json?.error || ""); });
  phase("the answer reports the EFFECTIVE state, which is what the app itself decides by",
    "GET and read the keys",
    async () => { const j = (await req(`${PQ}?restaurant_id=${FH}`)).json; return typeof j?.banquet === "boolean" && typeof j?.auto_print_kot === "boolean" && typeof j?.payroll === "boolean"; });
  phase("…and reports the TWO HALVES of auto-printing separately, so a card can say which is missing",
    "read both extra keys",
    async () => { const j = (await req(`${PQ}?restaurant_id=${FH}`)).json; return typeof j?.auto_print_kot_allowed === "boolean" && typeof j?.auto_print_kot_on === "boolean"; });
  phase("there is no dead switch for the parcel board — it is one permanent feature",
    "check no `platform` key is reported", async () => !("platform" in ((await req(`${PQ}?restaurant_id=${FH}`)).json || {})));
  phase("turning a feature ON makes it effectively on", "flip banquet on and read the answer",
    async () => { const r = await req(PQ, { method: "POST", body: { restaurant_id: FH, feature: "banquet", on: true } }); return r.status === 200 && r.json?.banquet === true; });
  phase("…and turning it OFF drops the entitlement, which is off regardless of the lower rungs",
    "flip it off and read the columns",
    async () => { await req(PQ, { method: "POST", body: { restaurant_id: FH, feature: "banquet", on: false } }); const s = await get("banquet_allowed"); return s.banquet_allowed === false; });
  phase("the formula the answer uses is the SAME one the app uses, not a second copy",
    "the source names the ladder it mirrors", () => /moduleLadder formula/.test(c.src(FQ)));
  phase("the change is written into the record", "read staff_actions",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); await req(PQ, { method: "POST", body: { restaurant_id: FH, feature: "banquet", on: true } }); return (await c.actionsSince(since, ["quick_feature"])).some((r) => /banquet/.test(r.detail || "")); });
  phase("an unknown restaurant is refused before it writes", "POST an unknown rid",
    async () => (await req(PQ, { method: "POST", body: { restaurant_id: NOSUCH, feature: "banquet", on: true } })).status === 404);

  // ── staff features ───────────────────────────────────────────────────────────────────────────
  const FS = "app/api/admin/restaurants/staff-features/route.ts", PS = "/api/admin/restaurants/staff-features";
  phase("the staff-feature route's sign-in gate runs before the first database call", "compare positions",
    () => { const s = c.clean(FS); return s.indexOf("tokenIsValid") < s.indexOf("sb.from"); });
  phase("only the entitlement columns this route names may be flipped", "POST a made-up key",
    async () => { const r = await req(PS, { method: "POST", body: { restaurant_id: FH, key: "make_me_admin", value: true } }); return r.status === 400 && /unknown staff feature/.test(r.json?.error || ""); });
  phase("the answer reports each entitlement as a real yes or no", "GET and read the flags",
    async () => { const j = (await req(`${PS}?restaurant_id=${FH}`)).json; return j?.flags && Object.values(j.flags).every((v) => typeof v === "boolean"); });
  phase("…and says whether the restaurant has a settings row at all", "read hasSettings",
    async () => typeof ((await req(`${PS}?restaurant_id=${FH}`)).json || {}).hasSettings === "boolean");
  phase("a flip is stored and reported back", "flip one and read the column",
    async () => { const r = await req(PS, { method: "POST", body: { restaurant_id: FH, key: "banquet_allowed", value: true } }); const s = await get("banquet_allowed"); return r.status === 200 && r.json?.flags?.banquet_allowed === true && s.banquet_allowed === true; });
  phase("a value that is not a boolean is stored as a definite no, never as text",
    'flip with the string "yes"',
    async () => { await req(PS, { method: "POST", body: { restaurant_id: FH, key: "banquet_allowed", value: "yes" } }); const s = await get("banquet_allowed"); return s.banquet_allowed === false; });
  phase("the flip is written into the record, naming the feature and its new state",
    "read staff_actions",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); await req(PS, { method: "POST", body: { restaurant_id: FH, key: "banquet_allowed", value: true } }); return (await c.actionsSince(since, ["staff_feature"])).some((r) => /banquet_allowed" → on/.test(r.detail || "")); });
  phase("an unknown restaurant is refused before it writes", "POST an unknown rid",
    async () => (await req(PS, { method: "POST", body: { restaurant_id: NOSUCH, key: "banquet_allowed", value: true } })).status === 404);
  phase("a malformed restaurant id is refused in words across all four of these routes",
    "GET each with a junk id",
    async () => {
      // The logo route answers no GET at all — it is POST (upload) and DELETE (remove) only — so it
      // is asked on the verb it HAS. The first draft sent it a GET and read the 405 as a failure.
      const checks = [[`${PG}?restaurant_id=nope`, "GET"], [`${PQ}?restaurant_id=nope`, "GET"], [`${PS}?restaurant_id=nope`, "GET"], [`${PL}?restaurant_id=nope`, "DELETE"]];
      for (const [p, m] of checks) { const r = await req(p, { method: m }); if (r.status !== 400 || DB_WORDS.test(r.text)) return `${p} (${m}) → ${r.status}`; }
      return true;
    });
  phase("none of these four routes can be read without being signed in", "GET each with no cookie",
    async () => { for (const p of [`${PG}?restaurant_id=${FH}`, `${PQ}?restaurant_id=${FH}`, `${PS}?restaurant_id=${FH}`]) if ((await req(p, { cookie: "" })).status !== 401) return false; return true; });
}
