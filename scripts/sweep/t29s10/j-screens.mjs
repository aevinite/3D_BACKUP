// Section J — the RENDERED screens these routes feed, read the way a person sees them: desktop 1280
// and the owner's phone (Samsung A35, 360×780 at 3×, touch). A green route is not evidence the screen
// is right (the project's own lesson), so each screen is opened, its visible text read, and a figure
// it shows compared with the route's own answer. Repo Playwright, because this must run with no Claude
// session (a verify:* check) — the admin cookie comes from scripts/sweep/login.mjs, never typed.
import { chromium } from "playwright";

const SCREENS = [
  ["Repair", "/aevinite/repair"],
  ["Restaurants", "/aevinite/restaurants"],
  ["Recycle bin", "/aevinite/recycle"],
  ["People", "/aevinite/people"],
  ["Settings", "/aevinite/settings"],
  ["Revenue", "/aevinite/revenue"],
  ["Usage", "/aevinite/usage"],
  ["Staff online", "/aevinite/staff-online"],
];

export default function section(c) {
  let browser = null;
  const view = {};   // `${name}|${device}` → { text, overflow, errorText }
  const open = async (name, path, device, tab = null) => {
    const key = `${name}|${device}${tab ? `|${tab}` : ""}`;
    if (view[key]) return view[key];
    browser ||= await chromium.launch();
    const ctx = await browser.newContext(device === "phone"
      ? { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 900 } });
    const ck = c.adminCookie(c.BASE); await ctx.addCookies([{ name: ck.name, value: ck.value, url: c.BASE }]);
    const p = await ctx.newPage();
    await p.goto(c.BASE + path, { waitUntil: "networkidle", timeout: 60000 });
    await p.waitForTimeout(800);
    // A screen with tabs opens on its first one; a person taps the one they want.
    if (tab) { await p.getByRole("tab", { name: new RegExp(`^${tab}`) }).first().click(); await p.waitForTimeout(1200); }
    view[key] = await p.evaluate(() => ({
      text: document.body.innerText,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    await ctx.close();
    return view[key];
  };
  const LEAK = /\bundefined\b|\bNaN\b|\[object Object\]|\$\{|Invalid Date/;
  const FAIL_WORDS = /Couldn.t load|Can.t open this screen|Something went wrong|unauthorized/i;

  c.sec("J · the screens these routes feed, read as rendered (desktop 1280 · A35 phone)");
  for (const [name, path] of SCREENS) {
    for (const device of ["desktop", "phone"]) {
      c.phase(`${name} (${device}) opens with its data — no "couldn't load" and no sign-in wall`, `open ${path}; read the visible text`, async () => {
        const v = await open(name, path, device); const m = v.text.match(FAIL_WORDS);
        return !m || `shows "${m[0]}"`;
      });
      c.phase(`${name} (${device}) shows no code text — no undefined, NaN, [object Object] or \${`, "search the visible text", async () => {
        const m = (await open(name, path, device)).text.match(LEAK); return !m || `shows "${m[0]}"`;
      });
    }
    c.phase(`${name} on the phone never scrolls sideways`, "A35: scrollWidth − clientWidth", async () => { const o = (await open(name, path, "phone")).overflow; return o <= 1 || `${o}px wider than the screen`; });
  }

  c.sec("J · what the screens show is what the routes answered");
  c.phase("Restaurants lists French House and Aangan by name", "read the desktop text", async () => { const t = (await open("Restaurants", "/aevinite/restaurants", "desktop")).text; const n = (await c.sq(`restaurants?select=name&id=in.(${c.FH},${c.AANGAN})`)).json.map((x) => x.name); return n.every((x) => t.includes(x)) || `missing ${n.filter((x) => !t.includes(x))}`; });
  c.phase("Settings tells the admin which stack this is — 'Backup / test', not 'Production'", "read the desktop text", async () => { const t = (await open("Settings", "/aevinite/settings", "desktop")).text; return /Backup \/ test/.test(t) && !/Environment\s*·?\s*Production/.test(t) || "wrong stack named"; });
  c.phase("Settings shows the retention lock as the database stores it", "compare the switch with app_config", async () => {
    const t = (await open("Settings", "/aevinite/settings", "desktop")).text; const row = (await c.sq("app_config?select=value&key=eq.log_retention_lock")).json[0];
    const locked = row?.value?.locked === true;
    return (locked ? /Locked/.test(t) : /Unlocked/.test(t)) || `database says locked=${locked}`;
  });
  c.phase("Revenue's MRR on screen is the route's MRR", "read the desktop text for the figure", async () => {
    const mrr = (await c.req("/api/admin/revenue")).json.mrr; const t = (await open("Revenue", "/aevinite/revenue", "desktop")).text;
    const shown = mrr.toLocaleString("en-IN");
    return t.includes(shown) || `₹${shown} not on screen`;
  });
  c.phase("Usage lists every live restaurant by name", "read the desktop text", async () => {
    const t = (await open("Usage", "/aevinite/usage", "desktop")).text; const rows = (await c.req("/api/admin/usage")).json.rows;
    const missing = rows.filter((r) => !t.includes(r.name)); return missing.length === 0 || `missing ${missing.map((r) => r.name).join(", ")}`;
  });
  c.phase("Recycle bin lists every binned restaurant by name", "read the desktop text", async () => {
    const t = (await open("Recycle bin", "/aevinite/recycle", "desktop")).text; const bin = (await c.req("/api/admin/restaurants?deleted=1")).json.trashed;
    const missing = bin.filter((r) => !t.includes(r.name)); return missing.length === 0 || `missing ${missing.map((r) => r.name).join(", ")}`;
  });
  c.phase("Users & owners → the Users tab shows a French House manager by name", "open the page, tap Users, read the desktop text", async () => {
    const m = (await c.sq(`staff_users?select=name,username&restaurant_id=eq.${c.FH}&role=eq.manager&deleted_at=is.null&limit=1`)).json[0];
    const t = (await open("People", "/aevinite/people", "desktop", "Users")).text; return t.includes(m.name || m.username) || `${m.name || m.username} not on screen`;
  });
  c.phase("no screen above shows a restaurant's FOOD takings (the admin sees no earnings)", "search every screen except Revenue for a ₹ figure", async () => {
    const bad = Object.entries(view).filter(([k, v]) => !k.startsWith("Revenue") && !k.startsWith("Settings") && /₹\s?\d/.test(v.text)).map(([k]) => k);
    return bad.length === 0 || bad.join(", ");
  });
  c.phase("(the browser opened for this section is closed)", "close it", async () => { if (browser) await browser.close(); browser = null; return true; });
}
