// Screenshots for block D's LOOK rows — taken here, opened and looked at by the terminal, then deleted.
import { openBoard, closeAll, sleep } from "./lib.mjs";
const OUT = process.argv[2];
const SAMPLE = () => { const T = (ms) => new Date(Date.now() - ms).toISOString();
  state.orders = [
    { id: "s1", status: "received", kot_no: 201, table_number: 3, created_at: T(60000), items: [] },
    { id: "s2", status: "preparing", kot_no: 202, table_number: 7, created_at: T(35 * 60000), allergies: ["nuts"], items: [] },
    { id: "s3", status: "preparing", kot_no: 203, table_number: 12, created_at: T(30 * 3600000), items: [] },
    { id: "s4", status: "preparing", kot_no: 204, table_number: 5, created_at: T(9 * 60000), items: [] },
  ];
  state.items = [
    { id: "a1", order_id: "s1", title: "Paneer Tikka", qty: 2, status: "received" },
    { id: "b1", order_id: "s2", title: "Butter Chicken", qty: 1, status: "preparing", note: "less spicy" },
    { id: "b2", order_id: "s2", title: "Garlic Naan", qty: 3, status: "ready", note: "less spicy" },
    { id: "c1", order_id: "s3", title: "Dal Makhani", qty: 1, status: "preparing", removed: ["dairy"], added_allergens: ["dairy"] },
    { id: "d1", order_id: "s4", title: "Mango Lassi", qty: 2, status: "ready" },
  ];
  state.platform = [{ id: "p1", source: "zomato", status: "accepted", kot_no: 90, created_at: T(20 * 60000), customer_name: "Asha", items: [{ title: "Veg Biryani", qty: 1 }] }];
  state.tableTags = { 7: "vip" }; state.tableNames = { 12: "Patio" };
  render();
};
const shots = [
  ["desk-light", { width: 1280, height: 800 }, 1, "light"], ["desk-dark", { width: 1280, height: 800 }, 1, "dark"],
  ["a35-light", { width: 360, height: 780 }, 3, "light"], ["a35-dark", { width: 360, height: 780 }, 3, "dark"],
  ["ipad-light", { width: 1194, height: 834 }, 2, "light"], ["ipad-dark", { width: 1194, height: 834 }, 2, "dark"],
];
const geo = {};
for (const [name, vp, dpr, skin] of shots) {
  const phone = vp.width < 500;
  const b = await openBoard({ ctx: { viewport: vp, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone, serviceWorkers: "block" }, beforeGoto: async (page, ctx) => { await ctx.addInitScript((s) => { try { localStorage.setItem("lfh_panel_theme", s); } catch {} }, skin); } });
  await b.frame.evaluate(() => { window.load = () => Promise.resolve(); window.loadTables = () => Promise.resolve(); window.freshLoad = () => Promise.resolve(); });
  await b.frame.evaluate(SAMPLE);
  await sleep(500);
  await b.page.screenshot({ path: `${OUT}/${name}.png` });
  geo[name] = await b.frame.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: innerWidth, bar: Math.round(document.querySelector("header.topbar").getBoundingClientRect().height), firstTicketTop: Math.round((document.querySelector(".ticket") || { getBoundingClientRect: () => ({ top: -1 }) }).getBoundingClientRect().top), theme: document.documentElement.dataset.theme, leaks: /\bundefined\b|\bNaN\b|\[object Object\]/.test(document.body.innerText) }));
  if (name === "desk-light") {
    await b.frame.evaluate(() => { view = "wall"; applyView(); }); await sleep(300); await b.page.screenshot({ path: `${OUT}/wall-light.png` });
    await b.frame.evaluate(() => { view = "columns"; applyView(); });
  }
  if (name === "a35-light") {
    await b.frame.evaluate(() => { state.dishes = [{ id: "x1", title: "Gulab Jamun", category: "Dessert", tags: ["sold-out"] }, { id: "x2", title: "Paneer Tikka", category: "Starters", tags: [] }, { id: "x3", title: "Rasmalai with saffron and pistachio, a very long dish name", category: "Dessert", tags: [] }]; openDrawer(); });
    await sleep(300); await b.page.screenshot({ path: `${OUT}/a35-86.png` }); await b.frame.evaluate(() => closeDrawer());
    await b.frame.evaluate(() => { state.waiting = { n: 6, oldestMs: 12 * 60000 }; openPrinterSheet(); }); await sleep(300); await b.page.screenshot({ path: `${OUT}/a35-printer.png` });
    await b.frame.evaluate(() => document.querySelector("#prSheet [data-prclose]").click());
    await b.frame.evaluate(() => { state.printRefused = "paused"; state.autoPrintKot = false; openKitchenSettings(); }); await sleep(300); await b.page.screenshot({ path: `${OUT}/a35-settings-paused.png` });
    await b.frame.evaluate(() => window.__kdsSettingsClose());
    await b.frame.evaluate(() => document.getElementById("moreBtn").click()); await sleep(300); await b.page.screenshot({ path: `${OUT}/a35-more.png` });
    geo.moreOpen = await b.frame.evaluate(() => [...document.querySelectorAll("#morePop .kds-more-row")].map((r) => r.dataset.for));
  }
  await b.ctx.close();
}
console.log(JSON.stringify(geo, null, 1));
await closeAll();
