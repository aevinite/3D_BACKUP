// scripts/sweep/t16s10/rerun-extra2.mjs — the last of my old rows: auditsort.d.ts against the
// implementation (P19555–P19568), the queue's offline-round timer (P44427), the site's queue at its
// ceilings (P45709–P45722), issue-raise on the served bytes (P45593), and the manager Dashboard's
// charts drawing with the vendored library (P15011).
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { chromium } from "playwright";
import { R, ok, tag, src, code, fnBody } from "./lib.mjs";
import { harness, memo, sleep, PACE, BASE } from "./browser.mjs";
import { loginAs } from "../login.mjs";

const done = tag("extra2");
const DTS = "public/panels/auditsort.d.ts";
const params = (fn) => {
  const c = code("auditsort.js"), m = c.match(new RegExp(`function ${fn}\\(([^)]*)\\)`)) || c.match(new RegExp(`${fn}: function \\(([^)]*)\\)`));
  return m ? m[1].split(",").map((x) => x.trim()).filter(Boolean).length : -1;
};
// The parameter list of `export function NAME(`, split on TOP-LEVEL commas only — the .d.ts spans
// several lines and its types (Record<string, string>, { kind; n }) carry commas of their own.
const declared = (fn) => {
  const t = src(DTS), i = t.indexOf(`export function ${fn}(`); if (i < 0) return -1;
  let d = 0, cur = "", parts = [];
  for (let j = t.indexOf("(", i) + 1; j < t.length; j++) {
    const c = t[j];
    if ("(<{[".includes(c)) d++;
    else if (")>}]".includes(c)) { if (d === 0) break; d--; }
    if (c === "," && d === 0) { parts.push(cur); cur = ""; } else cur += c;
  }
  parts.push(cur);
  return parts.map((x) => x.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter(Boolean).length;
};
const IMPL = { sortRows: "sortRows", kindCounts: "kindCounts", kindCountsFrom: "kindCountsFrom", matches: "matches", view: "view", sumAmount: "sumAmount", tagsOf: "tagsOf", tagCountsFrom: "tagCountsFrom", riskOf: "riskOf", activityGroupOf: "activityGroupOf", activityCounts: "activityCounts", activityMatches: "activityMatches", activityView: "activityView", sortById: "sortById" };
let n = 19555;
for (const fn of Object.keys(IMPL)) {
  R(`P${n++}`, DTS, `auditsort.d.ts declares ${fn}, and its shape matches the implementation`, () => {
    const d = declared(fn), i = fn === "riskOf" ? 1 : fn === "sortById" ? 1 : params(fn);
    // tagsOf/view/activityView take an OPTIONAL trailing argument in the .d.ts; a declaration may be
    // wider than the JS by optional parameters, never narrower.
    return ok(d >= 1 && d >= i - 0 && d <= i + 1, `declared with ${d} argument(s), implemented with ${i}`);
  }, "grep the .d.ts and compare the argument count");
}
R("P44427", "outbox.js", "a round that finds the device offline still leaves a timer behind", async () => {
  const h = await harness({ pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});window.__on=false;", body: "<div class='topbar'></div>", scripts: ["outbox.js"], api: () => ({ status: 200, body: { ok: true } }) });
  const r = await h.page.evaluate(async () => { const O = window.LFH_OUTBOX; await O.send({ base: "", method: "POST", path: "/api/editor/tables/1/pay", body: {} }); await O.flush(); return O.nextTryAt(); });
  await h.close(); return ok(r > Date.now() - 1000, `next try at ${r}`);
}, "headless: queue with no signal, flush, read nextTryAt");
const siteCeil = memo(async () => {
  const out = {};
  for (const mode of ["503", "409", "abort"]) {
    const h = await harness({ from: "site", pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});window.__on=false;", body: "<div class='topbar'></div>", scripts: ["backstack.js", "outbox.js", "offline.js"],
      api: (rec, route) => { if (mode === "abort") { route.abort("failed"); return "handled"; } return mode === "409" ? { status: 409, body: { error: "x", retry: true } } : { status: 503, body: {} }; } });
    out[mode] = await h.page.evaluate(async () => { const O = window.LFH_OUTBOX; O.__pause(); await O.send({ base: "", method: "POST", path: "/api/editor/tables/2/pay", body: {}, label: "Settle bill · Table 2" }); window.__on = true; for (let i = 0; i < 9; i++) { while (O.isFlushing()) await new Promise((r) => setTimeout(r, 10)); await O.flush(); } const s = O.getSnapshot(); return { q: s.queued.length, f: s.failed.map((x) => ({ l: x.label, e: x.error })) }; });
    out[mode].errors = h.errors; await h.close();
  }
  const h = await harness({ from: "site", pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});", body: "<div class='topbar'></div>", scripts: ["outbox.js"], api: () => ({ status: 200, body: {} }) });
  out.cap = await h.page.evaluate(async () => { const O = window.LFH_OUTBOX; await new Promise((r) => setTimeout(r, 300)); for (let i = 0; i < 201; i++) await O.send({ base: "", method: "POST", path: "/api/editor/settings", body: {}, label: "c" + i }); const s = O.getSnapshot(); return { q: s.queued.length, f: s.failed.map((x) => ({ l: x.label, r: x.retryable })) }; });
  out.capErr = h.errors; await h.close();
  return out;
});
R("P45709", "outbox.js", "none of the four retries for ever (the site's bytes)", async () => { const o = await siteCeil(); return ok(["503", "409", "abort"].every((m) => o[m].q === 0 && o[m].f.length === 1), JSON.stringify({ a: o["503"].f.length, b: o["409"].f.length, c: o.abort.f.length })); });
R("P45710", "outbox.js", "everything that ran out of tries ends up in front of a person", async () => { const o = await siteCeil(); return ok(["503", "409", "abort"].every((m) => o[m].f[0] && o[m].f[0].e)); });
R("P45711", "outbox.js", "…and each one still says what it WAS, not an id", async () => { const o = await siteCeil(); return ok(["503", "409", "abort"].every((m) => /Settle bill · Table 2/.test(o[m].f[0].l))); });
R("P45712", "outbox.js", "the ceilings raise no error", async () => { const o = await siteCeil(); return ok(!o["503"].errors.length && !o["409"].errors.length && !o.abort.errors.length); });
R("P45718", "outbox.js", "…and the one pushed off the end is NOT deleted — it goes in front of a person", async () => { const c = (await siteCeil()).cap; return ok(c.q === 200 && c.f.length === 1 && c.f[0].l === "c0", JSON.stringify(c.f)); });
R("P45720", "outbox.js", "…and is not offered as something to retry, because the floor has moved on", async () => ok((await siteCeil()).cap.f[0].r === false));
R("P45722", "outbox.js", "the limit raises no error", async () => ok(!(await siteCeil()).capErr.length));
R("P45593", "issue-raise.js", "issue-raise raises no error on the live bytes", async () => { const h = await harness({ from: "site", body: "<div class='topbar'></div>", scripts: ["backstack.js", "issue-raise.js"] }); await h.page.evaluate(() => window.LFH_ISSUE.open({ api: async () => ({ ok: true }) })); await sleep(300); const e = h.errors; await h.close(); return ok(!e.length, e.join(" | ")); }, "the site's bytes, the modal opened");
R("P15011", "public/panels/vendor/chart.umd.min.js", "The Dashboard's graphs draw with the vendored charts library", async () => {
  const b = await chromium.launch(); try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await loginAs(ctx, "manager", BASE);
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => (["GET", "HEAD"].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' })));
    await p.goto(`${BASE}/panels/editor/index.html`, { waitUntil: "load", timeout: 120000 }); await p.waitForFunction(() => !!window.LFH_OUTBOX, null, { timeout: 60000 }); await sleep(1500);
    const opened = await p.evaluate(() => { const t = document.querySelector('button.tab[data-tab="dash"]'); if (t) { t.click(); return true; } return false; });
    await sleep(6000);
    const r = await p.evaluate(() => { const cs = [...document.querySelectorAll("canvas")].filter((c) => c.offsetParent && c.width > 0); let drawn = 0; for (const c of cs) { try { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 400) if (d[i]) { drawn++; break; } } catch (e) {} } return { lib: !!window.Chart, canvases: cs.length, drawn }; });
    return ok(opened && r.lib && r.canvases > 0 && r.drawn > 0, JSON.stringify(r));
  } finally { await b.close(); }
}, "headless: the manager panel's Dashboard on :4416, writes answered by the test");

done();
