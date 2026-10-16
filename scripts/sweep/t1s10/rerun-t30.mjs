// scripts/sweep/t1s10/rerun-t30.mjs — RE-RUN of T30-S10.md's rows on lib/menu.ts that its parity script does not answer:
// the 63 dish-page rows driven by scripts/sweep/t30s10/live.mjs (P166701–P166763) and the harness row P166041.
// live.mjs also signs in three staff roles and sends refused writes for ITS territory, so the guest half is
// re-driven here instead — each row is matched by the restaurant · dish named in its own title, on my build :4401.
// Read-only: guest page loads and SELECTs on the dev database.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { R, code, ok, ROOT, BASE, sql } from "./lib.mjs";
import { newPage, done } from "./browser.mjs";

const rows = readFileSync(join(ROOT, ".claude/sweep/LEDGER/T30-S10.md"), "utf8").split("\n")
  .filter((l) => /^\| P1667[0-6]\d \|/.test(l) && l.includes("lib/menu.ts")).map((l) => ({ id: l.split("|")[1].trim(), title: l.split("|")[2].trim() }));
const visits = new Map();
const visit = (path) => { if (!visits.has(path)) visits.set(path, (async () => {
  const p = await newPage({ vp: { width: 390, height: 844, dpr: 2, mobile: true } }); const seen = [];
  p.on("response", async (r) => { const u = r.url(); if (/rest\/v1\/(rpc\/lfh_dish_reviews|reviews\b)/.test(u)) seen.push({ rpc: /rpc\/lfh_dish_reviews/.test(u), status: r.status(), body: await r.text().catch(() => "") }); });
  try { await p.goto(BASE + path, { waitUntil: "load", timeout: 120000 }); await p.waitForTimeout(4000); return { seen, text: await p.evaluate(() => document.body.innerText) }; } finally { await done(p); }
})()); return visits.get(path); };
const how = "driven as a guest at 390×844 on my production build :4401 (the guest half of scripts/sweep/t30s10/live.mjs)";
for (const r of rows) {
  const m = r.title.match(/— ([a-z-]+) · ([a-z0-9-]+): (.*)$/); const plain = r.title.match(/the plain \/item\/([a-z0-9-]+) door/);
  if (plain) { R(r.id, "lib/menu.ts", r.title.replace(/^`lib\/menu\.ts` — /, ""), async () => { const v = await visit(`/item/${plain[1]}`); return ok(v.seen.length >= 1 && v.seen.every((x) => x.rpc && x.status === 200 && !/device/i.test(x.body)), `${v.seen.length} call(s)`); }, how); continue; }
  if (!m) { R(r.id, "lib/menu.ts", r.title, async () => ({ ok: null, note: "title not understood by this re-run" }), how); continue; }
  const [, rest, slug, what] = m; const path = `/r/${rest}/item/${slug}`;
  if (/reads its reviews through lfh_dish_reviews/.test(what)) R(r.id, "lib/menu.ts", `${rest} · ${slug}: ${what}`, async () => { const v = await visit(path); return ok(v.seen.length >= 1 && v.seen.every((x) => x.rpc && x.status === 200 && !/device_id|"device/i.test(x.body)), `${v.seen.length} call(s)`); }, how);
  else if (/newest review is on the page/.test(what)) R(r.id, "lib/menu.ts", `${rest} · ${slug}: ${what}`, async () => { const n = (await sql(`select comment from reviews x where x.restaurant_id = (select id from restaurants where slug = '${rest}') and x.item_slug = '${slug}' and coalesce(x.comment,'') <> '' order by created_at desc limit 1`))[0]?.comment; const v = await visit(path); return ok(!n || v.text.includes(String(n).slice(0, 30)), String(n || "").slice(0, 40)); }, how);
  else if (/count beside the stars/.test(what)) R(r.id, "lib/menu.ts", `${rest} · ${slug}: the count beside the stars is the real one, not just the 20 the page fetched`, async () => { const real = Number((await sql(`select count(*) n from reviews where item_slug = '${slug}' and restaurant_id = (select id from restaurants where slug = '${rest}')`))[0].n); const v = await visit(path); const shown = (v.text.match(/\(\d+ reviews?\)/) || ["no count shown"])[0]; return ok(new RegExp(`\\(${real} reviews?\\)`).test(v.text), `${shown}, real ${real}`); }, how);
  else R(r.id, "lib/menu.ts", r.title, async () => ({ ok: null, note: "title not understood by this re-run" }), how);
}
R("P166041", "lib/menu.ts", "item 16: lib/menu.ts asks lfh_dish_reviews and never reads the reviews table itself", () => { const c = code("lib/menu.ts"); return ok(/rpc\("lfh_dish_reviews"/.test(c) && !/from\("reviews"\)/.test(c), "read off the file, comments stripped"); }, "static read of lib/menu.ts (the harness row's claim, read directly)");
