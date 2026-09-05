import { openWith, closeBrowser, refuse } from "./r2lib.mjs";
const seen = [];
const { pg, errs } = await openWith({ rules: [["/api/owner/oplog", (rt) => {
  seen.push("INTERCEPTED " + rt.request().url().split("/api")[1]);
  return refuse("Audit & logs isn't enabled for you — contact Aevidine.")(rt);
}]] });
console.log("intercepts:", JSON.stringify(seen));
console.log("Recent activity card present:", await pg.locator(".adm-card", { hasText: "Recent activity" }).count());
console.log("what the card says:", (await pg.locator(".adm-card", { hasText: "Recent activity" }).innerText().catch(()=>"(absent)")).replace(/\s+/g," ").slice(0,120));
console.log("console/network errors:", JSON.stringify(errs.slice(0,5)));
// what did fetchActs actually get?
const probe = await pg.evaluate(async () => {
  try { const r = await fetch("/api/owner/oplog?limit=6&rid=00000000-0000-0000-0000-000000000001", { cache: "no-store" });
        return { status: r.status, body: (await r.text()).slice(0, 160) }; }
  catch (e) { return { threw: String(e) }; }
});
console.log("a fetch made from INSIDE the page:", JSON.stringify(probe));
await closeBrowser();
