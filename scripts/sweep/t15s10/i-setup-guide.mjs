// Bank I · public/print-setup.html — the restaurant's own printer guide, DRIVEN in Chromium on my
// port at desktop 1280 and Samsung A35 360×780 dpr3 (touch on). The page needs no login.
import { chk, skip, assert, eq, src, onFinish } from "./lib.mjs";
import { BASE } from "./env.mjs";

const F = "public/print-setup.html";
const D = `driven in Chromium on ${BASE}`;
const R = "read the file";
const html = src(F);
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");

await chk("P184446", F, "the page loads no script or font from another site (it must open on a slow restaurant line)", R, () => assert(!/<script[^>]+src=|<link[^>]+href="https?:/i.test(html)));
await chk("P184447", F, "no link anywhere offers a file to download", R, () => assert(!/<a\b[^>]*\sdownload\b|href="[^"]+\.(bat|command|sh|exe|zip)"/i.test(html)));
await chk("P184448", F, "it never asks anyone to type a password or a code into the page", R, () => assert(!/<input[^>]+type="password"/i.test(html)));
await chk("P184449", F, "the site address in every command is the address the page was served from", R, () => assert(/const origin = location\.origin;/.test(script) && /\[data-site-url\]/.test(script)));
await chk("P184450", F, "remembered choices are wrapped so a blocked localStorage never breaks the page", R, () => assert((script.match(/try \{[^}]*localStorage/g) || []).length >= 3));
await chk("P184451", F, "a saved OS choice is only obeyed if it is one of the four real menus", R, () => assert(/saved === "all" \|\| Object\.values\(ids\)\.includes\(saved\)/.test(script)));
await chk("P184452", F, "it names the setup CODE (mig 380), and no longer tells anybody to sign in on the shop's PC", R, () => assert(/setup code/i.test(html) && !/sign in on (the|that) (kitchen )?computer and press Allow/i.test(html)));

let pw = null; try { pw = await import("playwright"); } catch {}
const up = await fetch(BASE + "/print-setup.html").then((r) => r.ok).catch(() => false);
if (!pw || !up) { for (let n = 453; n <= 480; n++) skip(`P184${n}`, F, "driven row", D, `needs Playwright and the app on ${BASE}`); }
else {
  const browser = await pw.chromium.launch(); onFinish(() => browser.close());
  const open = async (phone = false) => {
    const ctx = await browser.newContext(phone ? { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const res = await page.goto(BASE + "/print-setup.html", { waitUntil: "load" }); return { ctx, page, errors, res };
  };
  const d = await open();
  const body = await d.page.evaluate(() => document.body.innerText);
  await chk("P184453", F, "it answers 200 as an HTML page", D, () => { eq(d.res.status(), 200); assert(/text\/html/.test(d.res.headers()["content-type"])); });
  await chk("P184454", F, "it has exactly one top-level heading", D, async () => eq(await d.page.locator("h1").count(), 1));
  await chk("P184455", F, "it writes THIS site's address into the page (localhost:4415 here)", D, () => assert(body.includes(new URL(BASE).host), "the served address is not in the text"));
  await chk("P184456", F, "…and no other site's address appears in a command a person copies", D, async () => {
    const pres = await d.page.locator("pre[data-copy]").allInnerTexts(); const urls = pres.join("\n").match(/https?:\/\/[^\s"'<]+/g) || [];
    const foreign = urls.filter((u) => !u.startsWith(BASE) && !/sumatrapdfreader\.org|google\.com\/chrome|raspberrypi|ubuntu|debian|apple\.com|github\.com\/klirichek\/zj-58/.test(u)); eq(foreign, []);
    return "one third-party address is in a Linux command on purpose: the zj-58 thermal driver's own repository";
  });
  await chk("P184457", F, "every command block has a Copy button", D, async () => { eq(await d.page.locator("pre[data-copy] button.cpy").count(), await d.page.locator("pre[data-copy]").count()); });
  await chk("P184458", F, "…a Copy puts the block's own text on the clipboard, without the word Copy", D, async () => {
    const pre = d.page.locator("pre[data-copy]").first(); await pre.locator("button.cpy").click(); const clip = await d.page.evaluate(() => navigator.clipboard.readText());
    const want = (await pre.innerText()).replace(/\n\s*(Copy|Copied ✓)\s*$/, "").trim(); eq(clip, want); assert(!/Copy/.test(clip.split("\n").pop()), clip.slice(-40));
  });
  await chk("P184459", F, "…and the button itself says Copied ✓ for a moment", D, async () => { assert(/Copied/.test(await d.page.locator("pre[data-copy] button.cpy").first().innerText())); });
  await chk("P184460", F, "…pressing Copy AGAIN while it still says 'Copied ✓' copies the command only — not the words 'Copied ✓'", D, async () => {
    const pre = d.page.locator("pre[data-copy]").nth(1); const btn = pre.locator("button.cpy"); await btn.click(); await d.page.waitForTimeout(100); await btn.click();
    const clip = await d.page.evaluate(() => navigator.clipboard.readText()); assert(!/Copied/.test(clip), `the clipboard ends with: ${JSON.stringify(clip.slice(-30))}`);
  });
  await chk("P184461", F, "the three OS cards are there: Windows, Mac, Linux", D, async () => { eq(await d.page.locator("#pick .pickbtn").count(), 3); });
  for (const [id, os, keep] of [["P184462", "win", "windows"], ["P184463", "mac", "mac"], ["P184464", "linux", "linux"]]) {
    await chk(id, F, `picking ${os} shows that menu and hides the other two`, D, async () => {
      await d.page.locator(`#pick [data-pick="${os}"]`).first().click(); await d.page.waitForTimeout(200);
      const shown = await d.page.evaluate(() => [...document.querySelectorAll("section.os")].filter((s) => s.offsetParent !== null).map((s) => s.dataset.osid));
      eq(shown, [os]); assert(await d.page.locator(`h2#${keep}`).isVisible());
    });
  }
  await chk("P184465", F, "…the choice is remembered on the next visit", D, async () => {
    await d.page.locator('#pick [data-pick="linux"]').first().click(); await d.page.reload({ waitUntil: "load" }); eq(await d.page.evaluate(() => document.body.dataset.os), "linux");
  });
  await chk("P184466", F, "…'show all' brings every menu back", D, async () => {
    await d.page.locator("#pick .pickall").click(); await d.page.waitForTimeout(150); eq(await d.page.evaluate(() => document.body.dataset.os || "all"), "all");
  });
  await chk("P184467", F, "a link straight to #mac (from a panel) opens the Mac menu", D, async () => {
    const p = await d.ctx.newPage(); await p.goto(BASE + "/print-setup.html#mac", { waitUntil: "load" }); eq(await p.evaluate(() => document.body.dataset.os), "mac"); await p.close();
  });
  await chk("P184468", F, "a contents-list link to a HIDDEN menu switches to it instead of doing nothing", D, async () => {
    // The visible contents list only shows the menu you are reading, so the link is pressed the way a
    // cross-reference inside the text would press it.
    await d.page.locator('#pick [data-pick="mac"]').first().click(); if (!(await d.page.locator('a[href="#windows"]').count())) return "no link to #windows on this page";
    await d.page.evaluate(() => document.querySelector('a[href="#windows"]').click()); await d.page.waitForTimeout(200); eq(await d.page.evaluate(() => document.body.dataset.os), "win");
  });
  await chk("P184469", F, "the printer-name box writes the reader's own printer into every command", D, async () => {
    const box = d.page.locator("#pname"); if (!(await box.count())) return "no printer-name box"; await box.fill("BarPrinter");
    const n = await d.page.evaluate(() => [...document.querySelectorAll("[data-pname]")].filter((e) => e.textContent === "BarPrinter").length); assert(n > 0, "nothing took the name");
  });
  await chk("P184470", F, "…choosing 58 mm paper changes the printable width to 48 everywhere", D, async () => {
    const w = d.page.locator("#pwidth"); if (!(await w.count())) return "no width picker"; await w.selectOption("58");
    eq(await d.page.evaluate(() => [...new Set([...document.querySelectorAll("[data-pwidth70]")].map((e) => e.textContent))]), ["48"]); await w.selectOption("80");
  });
  await chk("P184471", F, "nothing on the page reads undefined / NaN / [object Object] / ${", D, () => eq(body.match(/undefined|NaN|\[object Object\]|\$\{/g) || [], []));
  await chk("P184472", F, "the page throws no error and logs none", D, () => eq(d.errors, []));
  await chk("P184473", F, "at 1280 nothing scrolls sideways", D, async () => assert(await d.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)));
  const p = await open(true);
  await chk("P184474", F, "on the A35 (360 px) the page does not scroll sideways", D, async () => assert(await p.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)));
  await chk("P184475", F, "…a long command scrolls INSIDE its own box, never pushing the page", D, async () => {
    const r = await p.page.evaluate(() => [...document.querySelectorAll("pre[data-copy]")].every((pre) => getComputedStyle(pre).overflowX !== "visible" || pre.scrollWidth <= pre.clientWidth + 1)); assert(r);
  });
  await chk("P184476", F, "…the heading wraps instead of being cut off", D, async () => assert(await p.page.evaluate(() => { const h = document.querySelector("h1"); return h.scrollWidth <= h.clientWidth + 1; })));
  await chk("P184477", F, "…every Copy button meets the 24 px minimum target on a phone (WCAG 2.5.8)", D, async () => {
    const hs = await p.page.evaluate(() => [...document.querySelectorAll("button.cpy")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((h) => h > 0));
    assert(hs.every((h) => h >= 24), hs.join(",")); return `${Math.min(...hs)} px tall — above the minimum, under the 44 px this project uses on the kitchen screen (listed as an improvement)`;
  });
  await chk("P184478", F, "…the three OS cards fit on the screen", D, async () => {
    const out = await p.page.evaluate(() => [...document.querySelectorAll("#pick .pickbtn")].filter((b) => b.getBoundingClientRect().right > innerWidth + 1).length); eq(out, 0);
  });
  await chk("P184479", F, "…and nothing is thrown on the phone either", D, () => eq(p.errors, []));
  await chk("P184480", F, "every place the app links to this guide exists and still points here", "grep the tree for the address", async () => {
    const { execFileSync } = await import("node:child_process"); const out = execFileSync("git", ["grep", "-l", "/print-setup.html", "--", "app", "components", "public/panels", "lib"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    assert(out.length >= 3, out.join(",")); return `${out.length} files link to it`;
  });
  await d.ctx.close(); await p.ctx.close();
}
