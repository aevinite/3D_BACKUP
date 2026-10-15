// scripts/sweep/t12r2/p-pages.mjs — sweep #10 T12 ROUND 2 · the shell, the host pages, and who sees what —
// every asset, every id, every response, enumerated rather than sampled.
//
//   P1 every script and stylesheet index.html loads: served 200, the right type, its ?v= its real hash
//   P2 every id index.html declares: something in app.js (or a shared script) uses it
//   P3 the three host pages, as French House's waiter opens them (status, title, frame, headers)
//   P4 what the waiter's browser RECEIVES during a session: only its own restaurant, no secret fields
import { createHash } from "node:crypto";
import { read, ok, F_APP, F_HTML, F_PAGE, F_LAYOUT, F_RPAGE, RID, AANGAN, BASE, waiterContext, openPanel, panelFrame, sleep } from "../t12s10/lib.mjs";

export async function blockP(R, firstId) {
  const { check } = R;
  let n = firstId;
  const id = () => "P" + n++;
  const html = read(F_HTML), app = read(F_APP);
  const shared = ["guestbell.js", "connbadge.js", "offline.js", "billcustomer.js", "myprofile.js", "issue-raise.js", "undobar.js", "maint.js", "theme.js", "fitnums.js"].map((f) => read("public/panels/" + f)).join("\n");
  const assets = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map((m) => m[1]);
  const fileOf = (src) => src.startsWith("/") ? "public" + src.split("?")[0] : "public/panels/tablet/" + src.split("?")[0];
  const sha1 = (rel) => createHash("sha1").update(read(rel)).digest("hex").slice(0, 8);

  const ctx = await waiterContext({});
  // ── P1 · every asset ──────────────────────────────────────────────────────────────────────────
  for (const a of assets) {
    const url = a.startsWith("/") ? BASE + a : `${BASE}/panels/tablet/${a}`;
    const r = await ctx.request.get(url);
    const type = r.headers()["content-type"] || "";
    const want = /\.css/.test(a) ? /text\/css/ : /javascript/;
    await check(id(), F_HTML, `${a.split("?")[0]} is served (200, ${/\.css/.test(a) ? "a stylesheet" : "a script"}) and its ?v= is its own current hash`, "LIVE — GET from :4412 + SRC sha1", async () =>
      ok(r.status() === 200 && want.test(type) && (a.split("v=")[1] || "") === sha1(fileOf(a)), `${r.status()} ${type.split(";")[0]} · v=${a.split("v=")[1]} vs ${sha1(fileOf(a))}`));
  }
  // ── P2 · every id the shell declares ──────────────────────────────────────────────────────────
  for (const idName of [...new Set([...html.matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]))]) {
    const used = app.includes(`"#${idName}"`) || app.includes(`("${idName}")`) || app.includes(`#${idName}`) || shared.includes(idName);
    await check(id(), F_HTML, `#${idName} in the shell is used by the panel's code (no dead markup)`, "SRC — index.html × app.js + shared scripts", async () => ok(used));
  }
  // ── P3 · the three host pages ─────────────────────────────────────────────────────────────────
  for (const [path, file] of [["/tablet", F_PAGE], ["/r/french-house/tablet", F_RPAGE]]) {
    const page = await ctx.newPage();
    const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    const F = await panelFrame(page);
    const frameEl = await page.evaluate(() => { const f = document.querySelector("iframe"); return f ? { title: f.getAttribute("title"), src: f.getAttribute("src"), allow: f.getAttribute("allow") || "" } : null; });
    await check(id(), file, `${path} answers 200 for French House's own waiter`, "LIVE — GET", async () => ok(res.status() === 200, String(res.status())));
    await check(id(), file, `${path}'s frame is titled 'Waiter tablet' for a screen reader`, "LIVE — DOM", async () => ok(frameEl && frameEl.title === "Waiter tablet", JSON.stringify(frameEl)));
    await check(id(), file, `${path}'s frame carries only the paint hint for a waiter (?skel=<own restaurant>)`, "LIVE — DOM", async () => ok(frameEl && frameEl.src === `/panels/tablet/index.html?skel=${RID}`, frameEl && frameEl.src));
    await check(id(), file, `${path} is not cached by a shared cache (a private, per-person page)`, "LIVE — response headers", async () => { const cc = res.headers()["cache-control"] || ""; return ok(/private|no-store|no-cache/.test(cc), cc || "(none)"); });
    await check(id(), file, `${path} paints the panel's floor inside its frame`, "LIVE — DOM", async () => { await F.waitForSelector("#tiles .tile", { timeout: 30000 }); return ok(true); });
    await page.close();
  }
  await check(id(), F_LAYOUT, "the /tablet layout's gate runs before the page (a non-waiter is never shown the frame)", "SRC — app/tablet/layout.tsx + lib/panelGate.ts", async () =>
    ok(/await requirePanel\("tablet", "\/tablet"\)/.test(read(F_LAYOUT)) && /u && u\.role === role/.test(read("lib/panelGate.ts"))));
  await check(id(), F_RPAGE, "/r/<slug>/tablet takes the restaurant from the session, never from the address, for a waiter", "SRC — lib/panelGate.ts requirePanelAt", async () =>
    ok(/u\.restaurant_id === r\.id/.test(read("lib/panelGate.ts")) && /return \{ restaurantId: r\.id, admin: false \}/.test(read("lib/panelGate.ts"))));

  // ── P4 · what the waiter's browser receives ───────────────────────────────────────────────────
  const { page } = await openPanel(ctx);
  const bodies = [];
  page.on("response", async (res) => { try { if (res.url().includes("/api/tablet/") && res.request().method() === "GET") bodies.push({ url: res.url().replace(BASE, ""), text: await res.text() }); } catch {} });
  await page.evaluate(async () => { await load(); const t = floorTableList()[0]; await selectTable(t); });
  await sleep(2500);
  const all = bodies.map((b) => b.text).join("\n");
  const ridsSeen = [...new Set([...all.matchAll(/"restaurant_id":"([0-9a-f-]{36})"/g)].map((m) => m[1]))];
  await check(id(), F_APP, "every row the waiter's floor reads belongs to French House (no other restaurant's id appears)", "LIVE — the panel's own reads, as received", async () => ok(ridsSeen.every((x) => x === RID), ridsSeen.join(",") || "(no restaurant_id in the payloads)"));
  await check(id(), F_APP, "…and the read-only control restaurant (Aangan) never appears in anything it receives", "LIVE — the panel's own reads, as received", async () => ok(!all.includes(AANGAN) && !/Aangan/i.test(all)));
  await check(id(), F_APP, "…no manager PIN hash, password, session token or service key is ever in what it receives", "LIVE — the panel's own reads, as received", async () => ok(!/pin_hash|password_hash|"password"|service_role|sbp_|eyJhbGciOi/i.test(all)));
  await check(id(), F_APP, "…the floor summary carries tiles only, not every table's order rows", "LIVE — the panel's own reads, as received", async () => {
    const sum = bodies.find((b) => /\/summary(\?|$)/.test(b.url) && !/table=/.test(b.url));
    const j = sum ? JSON.parse(sum.text) : {};
    return ok(sum && j.tiles && !Array.isArray(j.orders), sum ? `keys: ${Object.keys(j).slice(0, 12).join(",")}` : "no summary read seen");
  });
  await check(id(), F_APP, "…a table's detail read carries only THAT table's rows", "LIVE — the panel's own reads, as received", async () => {
    const st = bodies.find((b) => /\/state\?table=/.test(b.url));
    if (!st) return ok(false, "no detail read seen");
    const t = new URL("http://x" + st.url).searchParams.get("table");
    const j = JSON.parse(st.text);
    const tables = [...(j.orders || []), ...(j.sessions || []), ...(j.calls || [])].map((r) => String(r.table_number));
    return ok(tables.every((x) => x === String(t)), `table ${t}: ${[...new Set(tables)].join(",") || "(empty)"}`);
  });
  await check(id(), F_APP, "…and nothing it receives carries another staff member's personal profile or pay", "LIVE — the panel's own reads, as received", async () => ok(!/"salary"|"bank_account"|"aadhaar"|"pan_number"/i.test(all)));
  await ctx.close();
  return { next: n };
}
