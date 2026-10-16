// scripts/sweep/t1s10/see-search-off.mjs — a guest who had searched, after French House's search switch goes OFF.
// WRITES one value: settings.features.search on French House (the restaurant that is written to), for ~20 s,
// put back in a finally and on SIGINT/SIGTERM. Reports what the guest's menu shows; screenshot for an eye-read.
import { join } from "node:path";
import { sql, FH, ROOT } from "./lib.mjs";
import { newPage, done, open, cards, closeAll } from "./browser.mjs";
const before = (await sql(`select features->'search' v from settings where restaurant_id='${FH}'`))[0].v;
const put = (v) => sql(`update settings set features = jsonb_set(coalesce(features,'{}'::jsonb), '{search}', '${JSON.stringify(v)}'::jsonb) where restaurant_id='${FH}'`);
const restore = async () => { if (before === null) await sql(`update settings set features = features - 'search' where restaurant_id='${FH}'`); else await put(before); };
for (const s of ["SIGINT", "SIGTERM"]) process.once(s, async () => { await restore(); process.exit(130); });
const out = {};
const p = await newPage();
try {
  await open(p, "/r/french-house/menu"); out.all = await cards(p);
  await p.fill("#search-input", "coffee"); await p.waitForTimeout(1200); out.searched = await cards(p);
  out.saved = await p.evaluate(() => sessionStorage.getItem("lfh_menu_search:french-house"));
  await put(false); await new Promise((r) => setTimeout(r, 10000));
  out.live = { cards: await cards(p), box: !!(await p.$("#search-input")) };   // the switch arriving while the page is open
  await p.reload({ waitUntil: "load" }); await p.waitForSelector(".item-card, .fav-empty"); await p.waitForTimeout(2500);
  out.afterOff = { cards: await cards(p), box: !!(await p.$("#search-input")), clear: !!(await p.$(".search-clear, [aria-label*='lear search']")), sections: await p.$$eval(".cat-group", (e) => e.length) };
  await p.screenshot({ path: join(ROOT, ".claude/sweep/shots/S10-T1/search-off.png") });
} finally { await done(p); await restore(); out.restored = JSON.stringify((await sql(`select features->'search' v from settings where restaurant_id='${FH}'`))[0].v) === JSON.stringify(before); }
console.log(JSON.stringify(out)); await closeAll(); process.exit(0);
