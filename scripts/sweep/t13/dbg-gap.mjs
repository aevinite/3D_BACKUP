import { openWith, closeBrowser, refuse } from "./r2lib.mjs";
const { pg } = await openWith({ rules: [["/api/owner/oplog", refuse("Audit & logs isn't enabled for you — contact Aevidine.")]] });
const g = await pg.evaluate(() => {
  const rows = [];
  document.querySelectorAll(".ow2-two").forEach((el) => {
    const cs = getComputedStyle(el);
    rows.push({
      cols: cs.gridTemplateColumns,
      children: el.children.length,
      childW: [...el.children].map((k) => Math.round(k.getBoundingClientRect().width)),
      titles: [...el.children].map((k) => (k.querySelector(".ow2-ct > span:first-child")?.textContent || "?").trim().replace(/\s+/g, " ").slice(0, 26)),
      boxW: Math.round(el.getBoundingClientRect().width),
    });
  });
  return rows;
});
for (const r of g) console.log(JSON.stringify(r));
await pg.screenshot({ path: ".claude/sweep/shots/T13/r2-logs-off-gap.png", fullPage: false });
// scroll to the dish row so the gap is visible in the shot
await pg.evaluate(() => { const el = document.querySelector(".adm-main"); const t = [...document.querySelectorAll(".ow2-two")].pop(); if (el && t) el.scrollTop = t.offsetTop - 80; });
await pg.waitForTimeout(700);
await pg.screenshot({ path: ".claude/sweep/shots/T13/r2-logs-off-gap.png" });
await closeBrowser();
