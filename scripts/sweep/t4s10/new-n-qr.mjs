// Block N — 2026-10-16, the owner's "do the qr one" (P173988…). /q/<a code nobody owns> renders the
// not-active page with no /r/<slug> in its path, so the guest widgets fell back to the tab's pin — and a
// tab with none, to French House — and asked the database about French House. The dead-code page now
// stamps its own address as "no restaurant" (lib/tenantStorage.ts → NO_TENANT_KEY); these checks run the
// rule on a stand-in phone and the real screens in the lab. Live checks for it are in block L.
import { check, band, load, FILES } from "./lib.mjs";
import { install, reset, phone } from "./phone.mjs";
import { openLab, FH_ID } from "./lab/page.mjs";
import { HOW as LAB } from "./lab/how.mjs";
const F = FILES.ts, STUB = "STUB — real lib/tenantStorage.ts on a stand-in phone";
band(173988);
install();
const DEAD = "/q/DEADCODE1", MARK = "lfh_tab_no_tenant";
const fresh = async (path) => { reset({ path }); return load(F); };

check(F, "on the dead-code page's own address the tab belongs to NO restaurant (\"\"), not French House", STUB, async () => {
  const T = await fresh(DEAD); phone.ss.set(MARK, DEAD); const s = T.tenantSlug(); return { ok: s === "", note: JSON.stringify(s) };
});
check(F, "…even in a tab pinned to another restaurant earlier — and that pin is left exactly as it was", STUB, async () => {
  const T = await fresh(DEAD); phone.ss.set("lfh_tab_tenant", "sakura-sushi"); phone.ss.set(MARK, DEAD);
  const s = T.tenantSlug(); return { ok: s === "" && phone.ss.get("lfh_tab_tenant") === "sakura-sushi", note: `${JSON.stringify(s)} · pin ${phone.ss.get("lfh_tab_tenant")}` };
});
check(F, "the mark names ONE address: another slug-less page in the same tab still uses the tab's pin", STUB, async () => {
  const T = await fresh("/q/LIVECODE2"); phone.ss.set("lfh_tab_tenant", "sakura-sushi"); phone.ss.set(MARK, DEAD);
  const s = T.tenantSlug(); return { ok: s === "sakura-sushi", note: s };
});
check(F, "…and it never overrides an address that names its restaurant (/r/<slug>) or #1's own /menu", STUB, async () => {
  const T = await fresh("/r/aangan/menu"); phone.ss.set(MARK, "/r/aangan/menu"); const a = T.tenantSlug();
  phone.path = "/menu"; phone.ss.set(MARK, "/menu"); const b = T.tenantSlug();
  return { ok: a === "aangan" && b === "french-house", note: `${a} / ${b}` };
});
check(F, "the dead page's storage is nobody's bucket — never French House's basket or seat", STUB, async () => {
  const T = await fresh(DEAD); phone.ss.set(MARK, DEAD); const k = T.tkey("lfh_cart"); return { ok: k === "lfh_cart:" && !/french-house/.test(k), note: k };
});
check(F, "a phone that refuses sessionStorage still gets an answer (the old fallback), never a crash", STUB, async () => {
  const T = await fresh(DEAD); phone.ssBlocked = true; let s; try { s = T.tenantSlug(); } catch (e) { return { ok: false, note: "threw " + e.message }; }
  return { ok: s === "french-house", note: s };
});

// ── the real screens, in the lab ───────────────────────────────────────────────────────────────────
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const ctxOf = (L) => L.page.evaluate(() => JSON.parse(document.getElementById("lab-ctx").textContent));
// what app/q/[code]/page.tsx's dead branch writes before hydration, replayed before the lab page's own scripts
const deadStamp = { fn: (k) => { try { sessionStorage.setItem(k, location.pathname); } catch { /* refused */ } }, arg: MARK };
const rpcs = (L) => L.log.filter((x) => !/^REFUSED/.test(x.fn)).map((x) => x.fn);

check(FILES.ctx, "on a dead QR code the restaurant context is NO restaurant — no id, never ready, nothing looked up", LAB, () => with_({ mount: ["ctx"], path: DEAD, init: deadStamp }, async (L) => {
  await L.wait(700); const c = await ctxOf(L); const n = L.log.filter((x) => x.fn === "lfh_guest_restaurant").length;
  return { ok: c.id === "" && c.hookId === "" && c.ready === false && c.slug === "" && n === 0, note: `${JSON.stringify(c)} · lookups ${n}` };
}));
check(FILES.ctx, "…and the diner is shown no 'couldn't load this restaurant' toast — it is not a failure, there is no restaurant", LAB, () => with_({ mount: ["ctx"], path: DEAD, init: deadStamp, clock: true }, async (L) => {
  await L.clock.runFor(60000); await L.wait(100); const t = await L.toasts(); return { ok: t.length === 0, note: JSON.stringify(t) };
}));
check(FILES.ban, "with the ban wall, the table sheet, the table card and the live channel all mounted, the dead page asks the database NOTHING", LAB, () => with_({ mount: ["ctx", "ban", "gate", "card", "rt"], path: DEAD, init: deadStamp }, async (L) => {
  await L.wait(1500); const asked = rpcs(L); return { ok: asked.length === 0, note: asked.join(",") || "nothing asked" };
}));
check(FILES.ctx, "control: the same address WITHOUT the mark still settles on the tab's pin (the live-code door is unchanged)", LAB, () => with_({ mount: ["ctx"], path: "/q/LIVECODE2", init: { fn: () => { try { sessionStorage.setItem("lfh_tab_tenant", "french-house"); } catch { /* refused */ } }, arg: null } }, async (L) => {
  await L.wait(500); const c = await ctxOf(L); return { ok: c.id === FH_ID && c.ready === true, note: JSON.stringify(c) };
}));
check(FILES.ctx, "a tab that was on French House's own menu and moves in-app to a dead code LEAVES 'ready' — nothing keeps acting as #1", LAB, () => with_({ mount: ["ctx"], path: "/menu" }, async (L) => {
  await L.wait(300); const before = await ctxOf(L);
  await L.page.evaluate(([k, p]) => { sessionStorage.setItem(k, p); window.__labGo(p); }, [MARK, DEAD]); await L.wait(400); const after = await ctxOf(L);
  return { ok: before.ready === true && before.id === FH_ID && after.ready === false && after.id === "" && after.hookId === "", note: `${JSON.stringify(before)} → ${JSON.stringify(after)}` };
}));
