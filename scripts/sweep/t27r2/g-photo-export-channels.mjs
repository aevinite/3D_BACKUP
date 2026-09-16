/**
 * G · three read-thin routes: a person's PHOTO, the recovery BACKUP, and the delivery CHANNELS.
 *
 * users/photo 30.6 rows per hundred lines · export 31.7 · platform-channels 32.8. The backup is the
 * one file in the admin console that deliberately contains money, and the one that must strip every
 * secret before it leaves the building — both worth checking by reading the produced file, not the
 * code. The photo route is where round 1 found the phantom "photo removed" record.
 */
export default function section(c) {
  const { phase, sec, req, sq, made, FH, AANGAN, NOSUCH, DB_WORDS, SECRETS } = c;
  sec("G · a person's photo, the recovery backup, and the delivery channels");

  // ── users/photo ──────────────────────────────────────────────────────────────────────────────
  const FP = "app/api/admin/users/photo/route.ts";
  const PP = "/api/admin/users/photo";
  phase("the photo route's sign-in gate runs before the first database call", "compare positions",
    () => c.gateFirst(FP));
  phase("an SVG is refused — one served from public storage can run script when its URL is opened",
    "read the accepted types", () => { const s = c.clean(FP); return /"image\/png"|"image\/jpeg"|"image\/webp"/.test(s) && !/svg/i.test(s); });
  phase("a photo is capped at 2MB", "read the size check", () => /2 \* 1048576/.test(c.clean(FP)));
  phase("REMOVING A PHOTO THAT IS NOT THERE WRITES NO RECORD (round 1, item 2)",
    "the had-a-photo test exists and guards the log",
    () => {
      // Read the DELETE handler's own body. The first draft used indexOf across the whole file and
      // found the UPLOAD's logAction — which is of course before the removal's guard — so it
      // reported the round-1 fix as missing. Withdrawn; the fix is there and driven two phases down.
      const s = c.clean(FP);
      const at = s.indexOf("export async function DELETE");
      const body = at < 0 ? "" : s.slice(at);
      return /const hadPhoto = /.test(body) && body.indexOf("hadPhoto") < body.indexOf('logAction("admin", "user_set_photo"');
    });
  phase("…and it says so in plain words rather than claiming a removal",
    "read the answer", () => /There was no photo to remove/.test(c.clean(FP)));
  phase("the person read answers for its own failure, so a blip is not 'User not found.'",
    "check personOr inspects the error", () => /if \(q\.error\) return \{ res: adminFail/.test(c.clean(FP)));
  phase("writing the photo URL leaves the rest of the person's profile alone",
    "read setUrl's merge", () => /const next = \{ \.\.\.\(current \|\| \{\}\) \}/.test(c.clean(FP)));
  phase("removing it deletes the KEY rather than storing an empty one", "read setUrl",
    () => /else delete next\.photo_url/.test(c.clean(FP)));
  phase("the photo cannot be changed without being signed in", "DELETE with no cookie",
    async () => (await req(`${PP}?id=${made.userId}`, { method: "DELETE", cookie: "" })).status === 401);
  phase("a malformed person id is refused in words", "DELETE with a junk id",
    async () => { const r = await req(`${PP}?id=nope`, { method: "DELETE" }); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("an unknown person says so", "DELETE an unknown uuid",
    async () => (await req(`${PP}?id=${NOSUCH}`, { method: "DELETE" })).status === 404);
  phase("removing a photo nobody has answers honestly and writes nothing",
    "DELETE for the throwaway login, then read the record",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); const r = await req(`${PP}?id=${made.userId}`, { method: "DELETE" }); const rows = (await c.actionsSince(since, ["user_set_photo"])).filter((x) => (x.detail || "").includes(made.userName)); return r.status === 200 && r.json?.removed === false && rows.length === 0; });
  phase("…and the answer explains why nothing happened", "read the message",
    async () => /no photo to remove/i.test((await req(`${PP}?id=${made.userId}`, { method: "DELETE" })).json?.message || ""));
  phase("a photo upload with no file is refused before anything is stored", "POST an empty form",
    async () => { const fd = new FormData(); fd.append("id", made.userId); const r = await req(PP, { method: "POST", raw: fd }); return r.status === 400 && /Missing file/.test(r.json?.error || ""); });
  phase("a file that is not an image is refused by TYPE, not stored and checked later",
    "POST a text file",
    async () => { const fd = new FormData(); fd.append("id", made.userId); fd.append("file", new File(["hello"], "x.txt", { type: "text/plain" })); const r = await req(PP, { method: "POST", raw: fd }); return r.status === 400 && /PNG, JPG or WEBP/.test(r.json?.error || ""); });
  phase("an SVG is refused even though it is an image", "POST an SVG",
    async () => { const fd = new FormData(); fd.append("id", made.userId); fd.append("file", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })); const r = await req(PP, { method: "POST", raw: fd }); return r.status === 400; });
  phase("a real photo is stored, and the person's profile points at it",
    "POST a tiny PNG and read the profile back",
    async () => {
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+Y0VnAAAAAElFTkSuQmCC"), (ch) => ch.charCodeAt(0));
      const fd = new FormData(); fd.append("id", made.userId); fd.append("file", new File([png], "p.png", { type: "image/png" }));
      const r = await req(PP, { method: "POST", raw: fd });
      const prof = (await sq(`staff_users?select=profile&id=eq.${made.userId}`)).json?.[0]?.profile || {};
      return r.status === 200 && typeof r.json?.url === "string" && prof.photo_url === r.json.url;
    });
  phase("…and now removing it DOES report a removal, and writes the record",
    "DELETE and read both",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); const r = await req(`${PP}?id=${made.userId}`, { method: "DELETE" }); const rows = (await c.actionsSince(since, ["user_set_photo"])).filter((x) => /photo removed/.test(x.detail || "")); return r.json?.removed === true && rows.length > 0; });
  phase("…and the profile no longer points at anything", "read the profile",
    async () => { const prof = (await sq(`staff_users?select=profile&id=eq.${made.userId}`)).json?.[0]?.profile || {}; return prof.photo_url === undefined; });
  phase("no answer from the photo route carries a hash or a PIN", "scan the replies",
    async () => !SECRETS.test((await req(`${PP}?id=${made.userId}`, { method: "DELETE" })).text));

  // ── export ───────────────────────────────────────────────────────────────────────────────────
  const FE = "app/api/admin/restaurants/export/route.ts";
  const PE = "/api/admin/restaurants/export";
  // ── ONE DOWNLOAD, REUSED — a shared dev database is not ours alone ─────────────────────────────
  // The recovery backup is a whole-restaurant read: for French House (12k activity rows and a
  // year of orders) it answers in 3-4 seconds idle and 6-11 under the load of four other sweep
  // terminals. The first draft of this section called it THIRTEEN times, which is ~90 seconds of
  // somebody else's database for one file's worth of checks. The phases below all ask questions of
  // the SAME file, so it is fetched once per restaurant and kept.
  //
  // Not a product fault: the route's own header says it is "a rare, deliberate admin action, so a
  // full scoped read is acceptable — it is NOT a hot/polled path", every table is capped at 100k,
  // and it is the one admin path where money is present by design. Ten seconds for a disaster-
  // recovery download of a year-old restaurant is the right trade. Being gentle is the harness's job.
  const cache = new Map();
  const backup = async (rid = FH) => {
    if (cache.has(rid)) return cache.get(rid);
    const r = await req(`${PE}?rid=${rid}`);
    let j = null; try { j = JSON.parse(r.text); } catch { /* not json */ }
    cache.set(rid, j);
    return j;
  };
  phase("the backup cannot be downloaded without being signed in", "GET with no cookie",
    async () => (await req(`${PE}?rid=${FH}`, { cookie: "" })).status === 401);
  phase("a malformed restaurant id is refused in words", "GET with a junk rid",
    async () => { const r = await req(`${PE}?rid=nope`); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("an unknown restaurant says so", "GET an unknown uuid",
    async () => (await req(`${PE}?rid=${NOSUCH}`)).status === 404);
  phase("the file arrives as a download, named for the restaurant and the day",
    "read the Content-Disposition",
    async () => { const r = await req(`${PE}?rid=${FH}`); const d = r.headers.get("content-disposition") || ""; return /attachment; filename="backup-.+-\d{4}-\d{2}-\d{2}\.json"/.test(d); });
  phase("…and is never cached", "read Cache-Control",
    async () => /no-store/.test((await req(`${PE}?rid=${FH}`)).headers.get("cache-control") || ""));
  phase("the file says what it is, and which restaurant it is for", "read its _meta",
    async () => { const b = await backup(); return b?._meta?.kind === "aevidine-restaurant-recovery-backup" && b._meta.restaurantId === FH; });
  phase("it SAYS it contains money, rather than hiding that", "read containsFinancials",
    async () => (await backup())?._meta?.containsFinancials === true);
  phase("it says whether it is complete, so a restore script can branch on it",
    "read `complete`", async () => typeof (await backup())?._meta?.complete === "boolean");
  phase("a complete backup names no failed table", "read `failed`",
    async () => { const b = await backup(); return Array.isArray(b._meta.failed) && (b._meta.complete === (b._meta.failed.length === 0)); });
  phase("NO PASSWORD HASH LEAVES THE BUILDING in that file", "scan every staff row",
    async () => { const b = await backup(); return Array.isArray(b.staff_users) && b.staff_users.every((u) => !("password_hash" in u) && !("password_shown" in u) && !("pin_hash" in u)); });
  phase("NO DELIVERY-APP KEY LEAVES THE BUILDING either", "scan the settings rows in the file",
    async () => { const b = await backup(); const rows = Array.isArray(b.settings) ? b.settings : []; return rows.every((s) => { const pc = s.platform_channels || {}; return Object.values(pc).every((v) => !v || (!v.key && !v.api_key)); }); });
  phase("the money trail really is in the file — it is what you rebuild a restaurant from",
    "check the four money tables are keys in it",
    async () => { const b = await backup(); return ["invoice_events", "credit_notes", "session_payments", "deletion_audit"].every((k) => k in b); });
  phase("every table in the file is scoped to this restaurant and nobody else",
    "walk every row of every table and check restaurant_id",
    async () => { const b = await backup(); for (const [k, v] of Object.entries(b)) { if (k === "_meta" || k === "restaurant" || !Array.isArray(v)) continue; if (v.some((r) => r && r.restaurant_id && r.restaurant_id !== FH)) return false; } return true; });
  phase("the restaurant's own row is in the file", "read `restaurant`",
    async () => (await backup())?.restaurant?.id === FH);
  phase("every table this backup promises is present as a key, even when empty",
    "compare the file's keys against the TABLES list in the source",
    async () => { const b = await backup(); const m = c.clean(FE).match(/const TABLES = \[([\s\S]*?)\] as const/); const names = m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : []; return names.length > 0 && names.every((n) => n in b); });
  phase("a table that could not be read carries an error in its place, not silence",
    "read the source's failure handling",
    () => /backup\[t\] = \{ error: q\.error\.message \}; failed\.push\(t\)/.test(c.clean(FE)));
  phase("every table read is capped, so one huge restaurant cannot exhaust the server",
    "read the cap", () => /const CAP = 100_000/.test(c.clean(FE)));
  phase("the download is written into the record, because money left the building",
    "read staff_actions",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); await req(`${PE}?rid=${FH}`); return (await c.actionsSince(since, ["restaurant_export"])).length > 0; });
  phase("the control restaurant's backup contains only its own rows",
    "download Aangan's and check every restaurant_id",
    async () => { const b = await backup(AANGAN); for (const [k, v] of Object.entries(b)) { if (k === "_meta" || k === "restaurant" || !Array.isArray(v)) continue; if (v.some((r) => r && r.restaurant_id && r.restaurant_id !== AANGAN)) return false; } return b.restaurant.id === AANGAN; });

  // ── platform-channels ────────────────────────────────────────────────────────────────────────
  const FC = "app/api/admin/restaurants/platform-channels/route.ts";
  const PC = "/api/admin/restaurants/platform-channels";
  phase("the channels route's sign-in gate runs before the first database call", "compare positions",
    () => { const s = c.clean(FC); return s.indexOf("tokenIsValid") < s.indexOf("sb.from"); });
  phase("the KEY VALUE is never returned to the browser — only whether one is saved",
    "read present()", () => { const s = c.clean(FC); return /hasKey: typeof stored === "string" && stored\.length > 0/.test(s); });
  phase("a channel this route does not know is refused", "POST an unknown channel",
    async () => { const r = await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "deliveroo", on: true } }); return r.status === 400 && /unknown channel/.test(r.json?.error || ""); });
  phase("the channels cannot be read without being signed in", "GET with no cookie",
    async () => (await req(`${PC}?restaurant_id=${FH}`, { cookie: "" })).status === 401);
  phase("a malformed restaurant id is refused in words", "GET with a junk id",
    async () => { const r = await req(`${PC}?restaurant_id=nope`); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("an unknown restaurant is refused on a save, before it writes", "POST an unknown rid",
    async () => (await req(PC, { method: "POST", body: { restaurant_id: NOSUCH, channel: "zomato", on: true } })).status === 404);
  phase("the answer reports all three channels, each with its on/off and whether a key is saved",
    "GET and read the shape",
    async () => { const j = (await req(`${PC}?restaurant_id=${FH}`)).json; return ["zomato", "swiggy", "website"].every((k) => j?.channels?.[k] && typeof j.channels[k].on === "boolean" && typeof j.channels[k].hasKey === "boolean"); });
  phase("turning one channel on does not touch the other two", "flip one and compare the others",
    async () => { const before = (await req(`${PC}?restaurant_id=${FH}`)).json.channels; const r = await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "zomato", on: !before.zomato.on } }); const after = r.json.channels; return after.swiggy.on === before.swiggy.on && after.website.on === before.website.on; });
  phase("saving a key reports that a key is saved, and never echoes it",
    "POST a key and read the answer",
    async () => { const r = await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "swiggy", key: "T27R2-CHANNEL-SECRET" } }); return r.json?.channels?.swiggy?.hasKey === true && !r.text.includes("T27R2-CHANNEL-SECRET"); });
  phase('a key sent as "" LEAVES the stored one alone — the form saves without retyping it',
    "save a key, then save with an empty string",
    async () => { await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "swiggy", key: "T27R2-KEEP" } }); await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "swiggy", key: "" } }); const pc = (await sq(`settings?select=platform_channels&restaurant_id=eq.${FH}`)).json?.[0]?.platform_channels || {}; return (pc.swiggy?.key || pc.swiggy?.api_key) === "T27R2-KEEP"; });
  phase("a key sent as null CLEARS it, deliberately", "save null",
    async () => { await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "swiggy", key: null } }); const pc = (await sq(`settings?select=platform_channels&restaurant_id=eq.${FH}`)).json?.[0]?.platform_channels || {}; return !pc.swiggy?.key && !pc.swiggy?.api_key; });
  phase("this route and the Access screen now agree about what an empty key means",
    "both go through lib/channelKey", () => /import \{ applyChannelKey, channelKeyAction \}/.test(c.clean(FC)));
  phase("a legacy api_key is still READ, so a restaurant split before 2026-08-13 is not asked twice",
    "read the fallback in present()", () => /\(cell as \{ api_key\?: unknown \}\)\.api_key/.test(c.clean(FC)));
  phase("the change is written into the record, naming the channel and never the key",
    "save a key and read the log",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "zomato", on: true, key: "T27R2-LOGCHECK" } }); const rows = await c.actionsSince(since, ["platform_channel"]); return rows.length > 0 && rows.every((r) => !(r.detail || "").includes("T27R2-LOGCHECK")) && rows.some((r) => /zomato/.test(r.detail || "")); });
  phase("…and it says a key was set, without saying what it was", "read that line",
    async () => { const since = new Date(Date.now() - 15000).toISOString(); await req(PC, { method: "POST", body: { restaurant_id: FH, channel: "zomato", on: true, key: "T27R2-WORDS" } }); return (await c.actionsSince(since, ["platform_channel"])).some((r) => /key set/.test(r.detail || "")); });
  phase("no answer from any of these three routes carries a database sentence",
    "replay the refusals across all three",
    async () => {
      const t = [];
      t.push((await req(`${PP}?id=nope`, { method: "DELETE" })).text);
      t.push((await req(`${PE}?rid=nope`)).text);
      t.push((await req(PC, { method: "POST", body: { restaurant_id: "nope", channel: "zomato" } })).text);
      return t.every((x) => !DB_WORDS.test(x));
    });
}
