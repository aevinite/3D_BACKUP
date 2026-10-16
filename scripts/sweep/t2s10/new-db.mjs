// scripts/sweep/t2s10/new-db.mjs — sweep #10 T2, NEW checks, block D (P171351–P171450): the static
// files this territory owns that had ZERO driven rows — the two config.json files, the four GLBs and
// the 41 French House dish photos — checked byte by byte, served by the running app, and matched
// against the dish rows that point at them. Plus the dish rows' 3D tags (mig 402). READ-ONLY: every
// query is a select with a column list and a limit.   node scripts/sweep/t2s10/new-db.mjs --base URL
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { check, run, idGen, F, raw, ROOT, BASE } from "./lib.mjs";
import { sb, FH } from "./env.mjs";
const id = idGen(171351);
const C = (file, what, how, fn) => check(id(), file, what, how, fn);
const cfg = { Croissant: JSON.parse(raw(F.cCroissant)), Waffle: JSON.parse(raw(F.cWaffle)) };
const MODELS = ["croissant_small.glb", "croissant-optimized.glb", "waffle_small.glb", "waffle-optimized.glb"];
const glb = (n) => readFileSync(join(ROOT, "public/models", n));
const AEV = (await sb.from("restaurants").select("id").eq("slug", "aevidine").single()).data?.id;
const dishes3d = (await sb.from("menu_items").select("restaurant_id,slug,title,is4d,model_folder,model_small_url,model_optimized_url,model_tags,model_front_view").eq("is4d", true).in("restaurant_id", [FH, AEV]).limit(50)).data || [];
const fhDishes = (await sb.from("menu_items").select("slug,image").eq("restaurant_id", FH).limit(500)).data || [];
const photos = readdirSync(join(ROOT, "public/dishes/french-house"));

// ── the two static configs ────────────────────────────────────────────────────────────────────────
for (const [name, c] of Object.entries(cfg)) {
  const file = name === "Croissant" ? F.cCroissant : F.cWaffle;
  C(file, `${name}: the file is valid JSON`, "parse it", () => typeof c === "object");
  C(file, `${name}: it holds NO tags and NO frontView (mig 402 — one source, the dish row)`, "read the keys", () => !("tags" in c) && !("frontView" in c));
  C(file, `${name}: it says where they went, so nobody puts them back`, "read _movedOut", () => /menu_items\.model_tags/.test(c._movedOut || "") && /Do not put them back/.test(c._movedOut || ""));
  C(file, `${name}: every model it names exists in public/models`, "stat each", () => ["modelUrl", "smallUrl", "optimizedUrl"].every((k) => c[k] && statSync(join(ROOT, "public", c[k])).isFile()));
  C(file, `${name}: the small model is the smaller of the two`, "compare sizes", () => statSync(join(ROOT, "public", c.smallUrl)).size < statSync(join(ROOT, "public", c.optimizedUrl)).size);
  C(file, `${name}: the old single modelUrl is the SMALL one, so an old reader opens fast`, "compare", () => c.modelUrl === c.smallUrl);
  C(file, `${name}: the model files are named after this folder (no cross-wired dish)`, "read", () => [c.smallUrl, c.optimizedUrl].every((u) => u.toLowerCase().includes(name.toLowerCase())));
  C(file, `${name}: title and subtitle are real words`, "read", () => typeof c.title === "string" && c.title.trim().length > 2 && typeof c.subtitle === "string" && c.subtitle.trim().length > 2);
  C(file, `${name}: served by the app as JSON`, "GET it on the running app", async () => { const r = await fetch(`${BASE}/content/items/${name}/config.json`); const ok = r.status === 200 && /json/.test(r.headers.get("content-type") || ""); return { ok, note: `${r.status} ${r.headers.get("content-type")}` }; });
}
C(F.cCroissant, "the two configs are the only folders in public/content/items", "list the directory", () => JSON.stringify(readdirSync(join(ROOT, "public/content/items")).sort()) === '["Croissant","Waffle"]');
// ── the four GLB files ────────────────────────────────────────────────────────────────────────────
for (const n of MODELS) {
  const file = `public/models/${n}`;
  const b = glb(n);
  C(file, `${n}: a binary glTF (magic 'glTF', version 2)`, "read the 12-byte header", () => b.toString("ascii", 0, 4) === "glTF" && b.readUInt32LE(4) === 2);
  C(file, `${n}: the header's length is the file's length (not truncated)`, "compare", () => ({ ok: b.readUInt32LE(8) === b.length, note: `${b.readUInt32LE(8)} / ${b.length}` }));
  C(file, `${n}: its scene description parses and declares asset version 2.0 with at least one mesh`, "parse the JSON chunk", () => { const len = b.readUInt32LE(12); const j = JSON.parse(b.toString("utf8", 20, 20 + len)); return { ok: j.asset?.version === "2.0" && (j.meshes?.length || 0) > 0, note: `${j.meshes?.length} mesh(es), ext ${(j.extensionsUsed || []).join(",") || "none"}` }; });
  C(file, `${n}: served whole by the running app`, "GET it, count the bytes", async () => { const r = await fetch(`${BASE}/models/${n}`); const ab = await r.arrayBuffer(); return { ok: r.status === 200 && ab.byteLength === b.length, note: `${r.status}, ${ab.byteLength} bytes, ${r.headers.get("content-type")}` }; });
}
C("public/models/croissant-optimized.glb", "every file in public/models is used by a config", "list and compare", () => { const used = new Set(Object.values(cfg).flatMap((c) => [c.smallUrl, c.optimizedUrl].map((u) => u.split("/").pop()))); const all = readdirSync(join(ROOT, "public/models")); return { ok: all.every((x) => used.has(x)), note: all.join(", ") }; });
// The header comes from vercel.json, not from Next — so it is measured where it is applied, on the
// deployed backup site (a local `next start` answers max-age=0 for every public file, by design).
C("public/models/croissant_small.glb", "the files are long-cached where they are served (vercel.json: a year, immutable)", "HEAD each on the deployed backup site", async () => { const r = await fetch(`https://3-d-backup.vercel.app/models/croissant_small.glb`, { method: "HEAD" }); const cc = r.headers.get("cache-control") || ""; return { ok: /max-age=\d{5,}|immutable/.test(cc), note: cc || "(none)" }; });
// ── the 41 French House dish photos ──────────────────────────────────────────────────────────────
const refd = new Set(fhDishes.map((d) => d.image).filter((u) => (u || "").startsWith("/dishes/french-house/")).map((u) => u.split("/").pop()));
C("public/dishes/french-house/buddha-bowl.webp", `every one of the ${photos.length} files is a real WebP (RIFF…WEBP)`, "read each header", () => { const bad = photos.filter((p) => { const b = readFileSync(join(ROOT, "public/dishes/french-house", p)); return b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP"; }); return { ok: !bad.length, note: bad.join(", ") || `${photos.length} ok` }; });
C("public/dishes/french-house/buddha-bowl.webp", "…and each header's size matches its file (none truncated)", "RIFF length + 8 = file size", () => { const bad = photos.filter((p) => { const b = readFileSync(join(ROOT, "public/dishes/french-house", p)); return b.readUInt32LE(4) + 8 !== b.length; }); return { ok: !bad.length, note: bad.join(", ") || "all whole" }; });
C("public/dishes/french-house/buddha-bowl.webp", "every French House dish that points into this folder finds its file", "match the dish rows' image to the folder", () => { const miss = [...refd].filter((f) => !photos.includes(f)); return { ok: !miss.length, note: miss.length ? `missing: ${miss.join(", ")}` : `${refd.size} referenced, all present` }; });
C("public/dishes/french-house/buddha-bowl.webp", "files no French House dish points at (kept, harmless — listed)", "the other direction", () => { const orphan = photos.filter((p) => !refd.has(p)); return { ok: true, note: orphan.length ? `${orphan.length} unused: ${orphan.slice(0, 6).join(", ")}${orphan.length > 6 ? "…" : ""}` : "none" }; });
C("public/dishes/french-house/buddha-bowl.webp", "no photo is heavier than 400 KB on a diner's data", "stat each", () => { const big = photos.map((p) => [p, statSync(join(ROOT, "public/dishes/french-house", p)).size]).filter(([, s]) => s > 400 * 1024); return { ok: !big.length, note: big.map(([p, s]) => `${p} ${Math.round(s / 1024)}KB`).join(", ") || `max ${Math.round(Math.max(...photos.map((p) => statSync(join(ROOT, "public/dishes/french-house", p)).size)) / 1024)} KB` }; });
C("public/dishes/french-house/buddha-bowl.webp", "a sample photo is served as image/webp by the running app", "GET one", async () => { const r = await fetch(`${BASE}/dishes/french-house/buddha-bowl.webp`); return { ok: r.status === 200 && /webp/.test(r.headers.get("content-type") || ""), note: `${r.status} ${r.headers.get("content-type")}` }; });
C("public/dishes/french-house/buddha-bowl.webp", "every file name is a plain slug (no spaces or capitals a URL would mangle)", "read the names", () => photos.every((p) => /^[a-z0-9-]+\.webp$/.test(p)));
// ── the dish rows' 3D tags (mig 402) — on restaurant #1 AND on a second restaurant ─────────────────
C(F.viewer, "the 3D dishes on French House and aevidine were read", "select with a column list", () => ({ ok: dishes3d.length >= 4, note: dishes3d.map((d) => `${d.restaurant_id === FH ? "FH" : "aev"}:${d.slug}`).join(" ") }));
for (const d of dishes3d) {
  const who = d.restaurant_id === FH ? "French House" : "aevidine";
  C(F.pmv, `${who} · ${d.slug}: its tags are a list of 3 cards`, "read model_tags", () => Array.isArray(d.model_tags) && d.model_tags.length === 3);
  C(F.pmv, `${who} · ${d.slug}: every card has an id, a name, an emoji and two lines`, "read each", () => d.model_tags.every((t) => t.id && String(t.name).trim() && t.emoji && String(t.b1).trim() && String(t.b2).trim()));
  C(F.pmv, `${who} · ${d.slug}: every anchor is three finite numbers with a finite normal`, "read x,y,z,nx,ny,nz", () => d.model_tags.every((t) => ["x", "y", "z", "nx", "ny", "nz"].every((k) => Number.isFinite(Number(t[k])))));
  C(F.pmv, `${who} · ${d.slug}: card ids are unique within the dish (a duplicate would draw one card twice)`, "compare", () => new Set(d.model_tags.map((t) => t.id)).size === d.model_tags.length);
  C(F.viewer, `${who} · ${d.slug}: its saved pose is absent or parses as three numbers`, "parse model_front_view", () => !d.model_front_view || d.model_front_view.trim().split(/\s+/).slice(0, 3).every((x) => Number.isFinite(parseFloat(x))));
  C(F.viewer, `${who} · ${d.slug}: its model folder exists in the static demo folder`, "compare", () => ["Croissant", "Waffle"].includes(d.model_folder));
  C(F.viewer, `${who} · ${d.slug}: both of its own model links point at a real file`, "stat each", () => [d.model_small_url, d.model_optimized_url].every((u) => u && statSync(join(ROOT, "public", u.replace(/^\//, ""))).isFile()));
  C(F.viewer, `${who} · ${d.slug}: both model links are absolute paths (a relative one would resolve under /view/ and 404)`, "read", () => [d.model_small_url, d.model_optimized_url].every((u) => /^\/|^https:\/\//.test(u || "")));
}
C(F.pmv, "card names carrying a leading space render with it (data, not code — listed)", "scan the names", () => { const sp = dishes3d.flatMap((d) => d.model_tags.filter((t) => /^\s/.test(t.name)).map((t) => `${d.slug}:'${t.name}'`)); return { ok: true, note: sp.length ? `${sp.length}: ${sp.slice(0, 3).join(" ")}` : "none" }; });
C(F.viewer, "no 3D dish anywhere is missing its model folder (the 3D button needs one)", "select is4d rows with no folder, limit 20", async () => { const r = await sb.from("menu_items").select("restaurant_id,slug").eq("is4d", true).is("model_folder", null).limit(20); return { ok: !r.error && (r.data || []).length === 0, note: r.error?.message || `${(r.data || []).length} row(s)` }; });
// ── reviews: what a diner's browser may read (mig 418), read from the migration, not by trying ─────
const m418 = raw("supabase/migrations/418_a_dish_page_learns_which_review_is_mine_not_every_device_id.sql");
C(F.item, "a diner's browser can no longer read the reviews table directly (mig 418 revokes it)", "read the migration", () => /REVOKE SELECT ON public\.reviews FROM anon, authenticated;/.test(m418) && /DROP POLICY IF EXISTS public_read_reviews ON public\.reviews;/.test(m418));
C(F.item, "…the one reader it may call answers names, stars, notes and a 'mine' flag — never a device id", "read the function's columns", () => /RETURNS TABLE \(name text, stars integer, comment text, created_at timestamptz, mine boolean\)/.test(m418));
C(F.item, "…scoped to one dish at one restaurant, newest 20", "read", () => /WHERE r\.item_slug = p_slug AND r\.restaurant_id = p_restaurant_id/.test(m418) && /LIMIT 20;/.test(m418));
C(F.item, "…and its execute right is granted deliberately, after a revoke from PUBLIC", "read", () => /REVOKE ALL ON FUNCTION public\.lfh_dish_reviews\(text, uuid, text\) FROM PUBLIC;/.test(m418));
process.exit(await run("new-db") ? 1 : 0);
