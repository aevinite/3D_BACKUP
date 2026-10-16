// Block A — lib/tenantStorage.ts RUN on a stand-in phone (P173001…). Every per-restaurant guest key
// (basket, scanned table, dining session, name, consent…) is written through this file, so "one
// phone, two restaurants" is decided here. Each check loads a FRESH copy, so the one-time legacy move
// starts un-run.
import { check, band, load, FILES } from "./lib.mjs";
import { install, reset, phone } from "./phone.mjs";
const F = FILES.ts, HOW = "STUB — real lib/tenantStorage.ts on a stand-in phone";
band(173001);
install();
const fresh = async (path = "/menu") => { reset({ path }); return load(F); };
const DEF = "french-house";

const slugCases = [
  ["/r/sakura-sushi/menu", "sakura-sushi", "a tenant menu address names its own restaurant"],
  ["/r/Sakura-Sushi/menu", "sakura-sushi", "…folded, so a capitalised address is not a second storage bucket"],
  ["/r/%73akura-sushi/menu", "sakura-sushi", "…and a percent-escaped slug is decoded before it names a bucket"],
  ["/r/%20sakura-sushi%20/menu", "sakura-sushi", "…and spaces around it are trimmed, not made part of the name"],
  ["/r/sakura-sushi/item/abc", "sakura-sushi", "a tenant dish page names the same restaurant"],
  ["/r/sakura-sushi", "sakura-sushi", "…and so does the bare tenant root with nothing after the slug"],
  ["/menu", DEF, "the bare /menu IS restaurant #1, by definition"],
  ["/menu/anything", DEF, "…and so is anything under it"],
  ["/item/a-dish", DEF, "the bare dish page is restaurant #1 too"],
];
for (const [path, want, what] of slugCases) {
  check(F, `tenantSlug() — ${what} (${path} → ${want})`, HOW, async () => { const T = await fresh(path); const got = T.tenantSlug(); return { ok: got === want, note: got }; });
}
check(F, "visiting a tenant address PINS the tab, so a slug-less door after it stays on that restaurant", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tenantSlug(); return { ok: phone.ss.get("lfh_tab_tenant") === "aangan", note: phone.ss.get("lfh_tab_tenant") };
});
check(F, "…and landing on #1's own /menu re-pins the tab to #1, so it cannot inherit the last restaurant", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tenantSlug(); phone.path = "/menu"; const s = T.tenantSlug();
  return { ok: s === DEF && phone.ss.get("lfh_tab_tenant") === DEF, note: `${s} · pin ${phone.ss.get("lfh_tab_tenant")}` };
});
check(F, "the printed-QR door (/q/<code>) uses the restaurant the tab was PINNED to, never a guess", HOW, async () => {
  const T = await fresh("/q/ABC123"); phone.ss.set("lfh_tab_tenant", "sakura-sushi"); return T.tenantSlug() === "sakura-sushi";
});
check(F, "…and with no pin at all it falls back to #1 rather than throwing", HOW, async () => { const T = await fresh("/q/ABC123"); return T.tenantSlug() === DEF; });
check(F, "the 3D viewer (/view/<folder>) keeps the restaurant the tab came from", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tenantSlug(); phone.path = "/view/paneer"; return T.tenantSlug() === "aangan";
});
check(F, "a path that only LOOKS like /menu (/menus) is not mistaken for restaurant #1's bare menu", HOW, async () => {
  const T = await fresh("/menus"); phone.ss.set("lfh_tab_tenant", "aangan"); return { ok: T.tenantSlug() === "aangan", note: T.tenantSlug() };
});
check(F, "an empty slug (/r//menu) is not a restaurant called '' — it falls back to the tab's pin, else #1", HOW, async () => {
  const T = await fresh("/r//menu"); const s = T.tenantSlug(); return { ok: s === DEF, note: JSON.stringify(s) };
});
check(F, "with sessionStorage switched off a pinned door still answers a usable slug (#1), never throws", HOW, async () => {
  const T = await fresh("/q/ABC123"); phone.ssBlocked = true; let s; try { s = T.tenantSlug(); } catch (e) { return { ok: false, note: e.message }; } return s === DEF;
});
check(F, "…and a tenant address still names its restaurant with sessionStorage switched off", HOW, async () => {
  const T = await fresh("/r/sakura-sushi/menu"); phone.ssBlocked = true; return T.tenantSlug() === "sakura-sushi";
});
check(F, "on the SERVER (no window) the answer is #1 and nothing is touched", HOW, async () => {
  const T = await fresh("/r/sakura-sushi/menu"); const w = globalThis.window; delete globalThis.window; try { return T.tenantSlug() === DEF; } finally { globalThis.window = w; }
});
check(F, "tkey() is the base name plus THIS restaurant and nothing else", HOW, async () => { const T = await fresh("/r/sakura-sushi/menu"); return { ok: T.tkey("lfh_cart") === "lfh_cart:sakura-sushi", note: T.tkey("lfh_cart") }; });
check(F, "…and on #1's bare menu it is the #1 bucket, never the bare legacy key", HOW, async () => { const T = await fresh("/menu"); return T.tkey("lfh_cart") === "lfh_cart:french-house"; });
check(F, "what is written under this restaurant is what comes back (tset → tget)", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tset("lfh_cart", "[1]"); return T.tget("lfh_cart") === "[1]" && phone.ls.get("lfh_cart:aangan") === "[1]";
});
check(F, "reading a key nobody wrote answers null, not undefined or ''", HOW, async () => { const T = await fresh("/r/aangan/menu"); return T.tget("lfh_nothing") === null; });
check(F, "tremove really removes it", HOW, async () => { const T = await fresh("/r/aangan/menu"); T.tset("lfh_cart", "x"); T.tremove("lfh_cart"); return T.tget("lfh_cart") === null && !phone.ls.has("lfh_cart:aangan"); });
check(F, "ONE PHONE, TWO RESTAURANTS: this restaurant cannot read the other's basket", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tset("lfh_cart", "THEIRS"); phone.path = "/r/sakura-sushi/menu"; return T.tget("lfh_cart") === null;
});
check(F, "…and writing here cannot overwrite the other's", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tset("lfh_cart", "THEIRS"); phone.path = "/r/sakura-sushi/menu"; T.tset("lfh_cart", "MINE");
  return phone.ls.get("lfh_cart:aangan") === "THEIRS" && phone.ls.get("lfh_cart:sakura-sushi") === "MINE";
});
check(F, "…and the DINING SESSION — the key that matters most — is unreachable from the other restaurant", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tset("lfh_session", JSON.stringify({ table: "4", token: "tok-a" })); phone.path = "/r/sakura-sushi/menu";
  return T.tget("lfh_session") === null;
});
check(F, "…and a capitalised address of the SAME restaurant does reach its own session (one bucket per restaurant)", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tset("lfh_session", "S"); phone.path = "/r/Aangan/item/x"; return T.tget("lfh_session") === "S";
});
check(F, "a phone with storage switched off loses the preference, never the page — tget answers null", HOW, async () => { const T = await fresh("/r/aangan/menu"); phone.lsBlocked = true; return T.tget("lfh_cart") === null; });
check(F, "…tset is a quiet no-op", HOW, async () => { const T = await fresh("/r/aangan/menu"); phone.lsBlocked = true; try { T.tset("lfh_cart", "x"); return true; } catch { return false; } });
check(F, "…and so is tremove", HOW, async () => { const T = await fresh("/r/aangan/menu"); phone.lsBlocked = true; try { T.tremove("lfh_cart"); return true; } catch { return false; } });
const LEGACY = ["lfh_session", "lfh_table", "lfh_table_name", "lfh_nickname", "lfh_guest_name", "lfh_cart", "lfh_active_orders", "lfh_declared", "lfh-favorites", "lfh_loc_consent"];
for (const k of LEGACY) {
  check(F, `a pre-tenant "${k}" moves to restaurant #1's bucket and the loose copy is deleted`, HOW, async () => {
    const T = await fresh("/r/aangan/menu"); phone.ls.set(k, "OLD"); T.tget("anything");
    return { ok: phone.ls.get(`${k}:french-house`) === "OLD" && !phone.ls.has(k), note: `moved=${phone.ls.get(`${k}:french-house`) === "OLD"} deleted=${!phone.ls.has(k)}` };
  });
}
check(F, "…and the move never overwrites a scoped value that already exists", HOW, async () => {
  const T = await fresh("/menu"); phone.ls.set("lfh_cart", "OLD"); phone.ls.set("lfh_cart:french-house", "NEW"); T.tget("x");
  return phone.ls.get("lfh_cart:french-house") === "NEW" && !phone.ls.has("lfh_cart");
});
check(F, "…and it leaves a flag, so it is a ONE-time move", HOW, async () => { const T = await fresh("/menu"); T.tget("x"); return phone.ls.get("lfh_tenant_migrated_v1") === "1"; });
check(F, "…so a device that has already moved is never touched again (a bare key written later is left alone)", HOW, async () => {
  const T = await fresh("/menu"); phone.ls.set("lfh_tenant_migrated_v1", "1"); phone.ls.set("lfh_cart", "LATER"); T.tget("x");
  return phone.ls.get("lfh_cart") === "LATER" && !phone.ls.has("lfh_cart:french-house");
});
check(F, "…and a phone whose storage refuses the move still opens the page (no throw out of the first read)", HOW, async () => {
  const T = await fresh("/menu"); phone.lsBlocked = true; try { return T.tget("x") === null; } catch { return false; }
});
check(F, "the device-wide preferences (theme, language, currency, device id) are NOT moved or renamed", HOW, async () => {
  const T = await fresh("/menu"); for (const k of ["lfh_theme", "lfh_lang", "lfh_currency", "lfh_device", "lfh_device_id"]) phone.ls.set(k, "P"); T.tget("x");
  return ["lfh_theme", "lfh_lang", "lfh_currency", "lfh_device", "lfh_device_id"].every((k) => phone.ls.get(k) === "P" && !phone.ls.has(`${k}:french-house`));
});
check(F, "tsetFor() aimed at a NAMED restaurant lands there, not on the page we happen to be on", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); T.tsetFor("lfh_active_orders", "sakura-sushi", "[{}]"); return phone.ls.get("lfh_active_orders:sakura-sushi") === "[{}]" && !phone.ls.has("lfh_active_orders:aangan");
});
check(F, "…and tgetFor() reads it back from the same place", HOW, async () => { const T = await fresh("/r/aangan/menu"); T.tsetFor("k", "sakura-sushi", "v"); return T.tgetFor("k", "sakura-sushi") === "v"; });
check(F, "…folded on the way in, so a capitalised slug is not a second restaurant", HOW, async () => { const T = await fresh("/menu"); T.tsetFor("k", "Sakura-Sushi", "X"); return phone.ls.get("k:sakura-sushi") === "X"; });
check(F, "…and folded on the way out too", HOW, async () => { const T = await fresh("/menu"); phone.ls.set("k:sakura-sushi", "X"); return T.tgetFor("k", "SAKURA-SUSHI") === "X"; });
check(F, "…and trimmed, so a slug with spaces is the same restaurant", HOW, async () => { const T = await fresh("/menu"); T.tsetFor("k", "  aangan ", "Y"); return phone.ls.get("k:aangan") === "Y"; });
check(F, "…and an EMPTY slug means restaurant #1 rather than a bucket called nothing", HOW, async () => { const T = await fresh("/menu"); T.tsetFor("k", "", "Z"); return phone.ls.get("k:french-house") === "Z" && !phone.ls.has("k:"); });
// RE-AIMED 2026-10-16: sweep #10 T3 round 4 item 47 keeps a refused write in the page's memory on purpose
// (a basket must survive a full or blocked storage), so "answer null" is no longer the rule.
check(F, "…and a blocked storage never throws: tsetFor's value is kept in the page's memory (item 47), never on the phone", HOW, async () => {
  const T = await fresh("/menu"); phone.lsBlocked = true; try { T.tsetFor("k", "aangan", "v"); return { ok: T.tgetFor("k", "aangan") === "v" && phone.ls.size === 0, note: `${T.tgetFor("k", "aangan")} · phone keys ${phone.ls.size}` }; } catch (e) { return { ok: false, note: "threw " + e.message }; }
});
check(F, "isTKey(): a cross-tab storage event is recognised when it is THIS restaurant's key", HOW, async () => { const T = await fresh("/r/aangan/menu"); return T.isTKey("lfh_cart:aangan", "lfh_cart") === true; });
check(F, "…and ignored when it belongs to another restaurant's tab", HOW, async () => { const T = await fresh("/r/aangan/menu"); return T.isTKey("lfh_cart:sakura-sushi", "lfh_cart") === false; });
check(F, "…and ignored for the bare legacy key", HOW, async () => { const T = await fresh("/r/aangan/menu"); return T.isTKey("lfh_cart", "lfh_cart") === false; });
check(F, "…and for a different base on the same restaurant", HOW, async () => { const T = await fresh("/r/aangan/menu"); return T.isTKey("lfh_session:aangan", "lfh_cart") === false; });
check(F, "…and a null key (storage cleared) never wakes anything", HOW, async () => { const T = await fresh("/r/aangan/menu"); return T.isTKey(null, "lfh_cart") === false; });
check(F, "on the SERVER every reader answers null and every writer does nothing", HOW, async () => {
  const T = await fresh("/r/aangan/menu"); const w = globalThis.window; delete globalThis.window;
  try { T.tset("a", "1"); T.tremove("a"); T.tsetFor("a", "x", "1"); return T.tget("a") === null && T.tgetFor("a", "x") === null && phone.ls.size === 0; } finally { globalThis.window = w; }
});
