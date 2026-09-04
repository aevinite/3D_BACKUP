// T17 · the owner console's frame, Settings, Menu and Manager mode — DRIVEN, headless.
// One login per role for the whole run (scripts/sweep/login.mjs caches on disk too).
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";
import { requireAppUp } from "../appUp.mjs";

const BASE = await requireAppUp(process.argv, "the T17 owner-console live checks");
let ID = Number(process.env.T17_FROM || 70901);
const rows = []; let pass = 0, fail = 0;
const ok = (what, cond, note = "") => {
  const id = "P" + (ID++);
  if (cond) { pass++; rows.push([id, what, "✅", note]); console.log(`✅ ${id} ${what}${note ? " — " + note : ""}`); }
  else { fail++; rows.push([id, what, "❌", note]); console.log(`❌ ${id} ${what}${note ? " — " + note : ""}`); }
};
const LEAK = /-->|\$\{|\bundefined\b|\bNaN\b|\[object Object\]/;

const browser = await chromium.launch();
const ctxFor = async (role, w, h, skin) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 3 : 1 });
  await loginAs(ctx, role, BASE);
  await ctx.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  await ctx.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  return ctx;
};

// ── A · every page, every role, both skins, both sizes ──────────────────────────────────────────
const PAGES = [["/owner/settings", "Settings"], ["/owner/menu", "Menu"], ["/owner/manager", "Manager mode"]];
for (const role of ["owner", "ownerMulti"]) {
  for (const [w, h, size] of [[1280, 900, "desktop"], [360, 780, "A35 phone"]]) {
    for (const skin of ["dark", "light"]) {
      const ctx = await ctxFor(role, w, h, skin);
      const p = await ctx.newPage();
      for (const [path, name] of PAGES) {
        const errs = [];
        p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
        const onCon = (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)); };
        p.on("console", onCon);
        // NAME THE RESOURCE, not just "404" (T17, after P71119 failed once and could not be
        // explained). A bare "Failed to load resource: 404" in the console tells you a fault
        // happened and nothing about what, so the row could not be re-run into an answer. The dev
        // server answers 404 for a chunk it has not finished emitting on a route's FIRST hit, which
        // is the innocent shape — but only the URL can tell the two apart.
        const onResp = (r) => { if (r.status() >= 400) errs.push(`http ${r.status()} ${r.url().replace(BASE, "")}`); };
        p.on("response", onResp);
        let landed = "";
        try { await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 }); landed = new URL(p.url()).pathname; }
        catch (e) { landed = "TIMEOUT " + String(e).slice(0, 60); }
        const who = `${name} · ${role} · ${size} · ${skin}`;
        ok(`${who}: the page answers on its own address`, landed === path, landed);
        const m = await p.evaluate(() => {
          const de = document.documentElement;
          const vis = [...document.querySelectorAll("body *")].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && e.offsetParent !== null;
          });
          const past = vis.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
            .map((e) => `${e.tagName}.${String(e.className).split(" ")[0]}`);
          return {
            text: document.body.innerText.slice(0, 6000),
            scrollW: de.scrollWidth, clientW: de.clientWidth,
            skinAttr: document.querySelector(".adm.owx")?.getAttribute("data-skin") || null,
            shellBg: (() => { const s = document.querySelector(".adm.owx"); return s ? getComputedStyle(s).backgroundColor : null; })(),
            past: [...new Set(past)].slice(0, 6),
            burgerShown: (() => { const b = document.querySelector(".owx-burger"); return !!b && !!b.offsetParent; })(),
            sideShown: (() => { const s = document.querySelector(".owx-side"); return !!s && s.getBoundingClientRect().x >= 0; })(),
            logoutIsForm: !!document.querySelector('form[method="post"][action="/api/panel-logout"] button[type="submit"]'),
            crumb: document.querySelector(".owx-path")?.innerText.replace(/\s+/g, " ").trim() || "",
            iframes: [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src")),
          };
        }).catch(() => null);
        if (!m) { ok(`${who}: the page could be measured at all`, false); p.off("console", onCon); continue; }
        ok(`${who}: nothing threw and the console stayed quiet`, errs.length === 0, errs.slice(0, 2).join(" | "));
        ok(`${who}: no code text leaked onto the screen`, !LEAK.test(m.text), (m.text.match(LEAK) || [""])[0]);
        ok(`${who}: no sideways scroll`, m.scrollW <= m.clientW + 1, `${m.scrollW} vs ${m.clientW}`);
        ok(`${who}: nothing is rendered past the right edge`, m.past.length === 0, m.past.join(", "));
        ok(`${who}: the shell wears the skin that was asked for`, m.skinAttr === skin, String(m.skinAttr));
        ok(`${who}: …and paints it (the shell's own background, not the body's)`,
          skin === "dark" ? /rgb\((\d+), (\d+), (\d+)\)/.test(m.shellBg || "") && m.shellBg !== "rgb(255, 255, 255)"
                          : m.shellBg !== "rgb(10, 12, 16)", String(m.shellBg));
        ok(`${who}: signing out is a POST form, not a link`, m.logoutIsForm);
        if (path === "/owner/manager") {
          const launcher = role === "ownerMulti";
          ok(`${who}: ${launcher ? "the launcher offers a restaurant to pick" : "the live floor is embedded straight away"}`,
            launcher ? /Pick the restaurant whose floor/.test(m.text) : (m.iframes || []).some((s) => /ownermode=1/.test(s || "")),
            (m.iframes || []).join(","));
          ok(`${who}: the sidebar is the ☰ drawer here at every width`, m.burgerShown && !m.sideShown);
        } else {
          ok(`${who}: the sidebar is the sidebar at ${size === "desktop" ? "desktop" : "phone"} width`,
            size === "desktop" ? m.sideShown : !m.sideShown);
        }
        if (path === "/owner/menu") {
          ok(`${who}: the menu editor is embedded, menu-only, pinned to one restaurant`,
            (m.iframes || []).some((s) => /menuonly=1/.test(s || "") && /rid=/.test(s || "")), (m.iframes || []).join(","));
          ok(`${who}: the embed was born on this skin, so it never re-navigates on a toggle`,
            (m.iframes || []).some((s) => new RegExp(`skin=${skin}`).test(s || "")), (m.iframes || []).join(","));
        }
        if (path === "/owner/settings") {
          ok(`${who}: the Appearance card offers Light and Dark`, /Appearance/.test(m.text) && /Light/.test(m.text) && /Dark/.test(m.text));
          ok(`${who}: the What's-enabled card is headed as what is switched ON`, /switched on for you/.test(m.text));
          ok(`${who}: …and shows no crossed-out section (R36)`, !/✗|✘|not enabled|isn't switched on/i.test(m.text));
          ok(`${who}: the Change-password card is offered`, /Change password/.test(m.text));
          ok(`${who}: the page says who decides taxes, branding and billing`, /managed for you by Aevidine/.test(m.text));
        }
        ok(`${who}: the crumb names the section you are on`, m.crumb.includes(name === "Settings" ? "Settings" : name), m.crumb);
        p.off("console", onCon);
        p.off("response", onResp);
      }
      await ctx.close();
    }
  }
}
console.log(`\n${pass} passed, ${fail} failed  ·  ids P70901-P${ID - 1}`);
await browser.close();
process.exit(0);
