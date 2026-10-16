// Round 4 · M — THE TWO NEW HELPERS, IN MEMORY, CASE BY CASE (run with ../r3/hooks.mjs for the "@/…" names).
//   lib/tenantStorage.ts (item 47): a write the phone refuses is kept in memory; reads look there first.
//   lib/digits.ts (item 43): every decimal digit Unicode knows becomes its 0–9 twin; nothing else survives.
//   lib/planTable.ts guestTable(): the doors read a table exactly as the phone's box writes it.
import { check, real } from "./h4.mjs";

// a phone's storage that can be told to refuse: "ok", "quota" (writes throw), "blocked" (every touch throws)
function fakeWindow(mode) {
  const store = new Map();
  const ls = {
    getItem(k) { if (mode.v === "blocked") throw new DOMException("insecure", "SecurityError"); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { if (mode.v !== "ok") throw new DOMException("full", "QuotaExceededError"); store.set(k, String(v)); },
    removeItem(k) { if (mode.v === "blocked") throw new DOMException("insecure", "SecurityError"); store.delete(k); },
  };
  const ss = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = { location: { pathname: "/r/french-house/menu" } };
  globalThis.localStorage = ls; globalThis.sessionStorage = ss;
  return store;
}
// loaded FIRST, then the fake browser put in place: the module's imports include the database client, which
// starts a browser-only worker if it sees a `window` while loading; the helpers only look for it when called
const fresh = async (mode) => { delete globalThis.window; const ts = await real("lib/tenantStorage.ts"); const store = fakeWindow(mode); return { ts, store }; };

check("R4-M01", "M", "storage full: the basket written while the phone refuses is read back whole, and the phone's old copy never shadows it", async () => {
  const mode = { v: "ok" }; const { ts, store } = await fresh(mode);
  ts.tset("lfh_cart", '["old"]'); mode.v = "quota"; ts.tset("lfh_cart", '["new"]');
  return { ok: ts.tget("lfh_cart") === '["new"]' && [...store.values()].includes('["old"]'), note: `read ${ts.tget("lfh_cart")} while the phone still holds ["old"]` };
});
check("R4-M02", "M", "storage blocked outright: write, read, remove, read — all answered from memory, nothing throws", async () => {
  const mode = { v: "blocked" }; const { ts } = await fresh(mode);
  ts.tset("lfh_cart", "A"); const a = ts.tget("lfh_cart"); ts.tremove("lfh_cart"); const b = ts.tget("lfh_cart");
  return { ok: a === "A" && b === null, note: `after write: ${a} · after remove: ${b}` };
});
check("R4-M03", "M", "storage comes back: the next write lands on the phone and the memory copy is dropped (no stale value wins later)", async () => {
  const mode = { v: "quota" }; const { ts, store } = await fresh(mode);
  ts.tset("lfh_cart", "M"); mode.v = "ok"; ts.tset("lfh_cart", "P"); store.set("lfh_cart:french-house", "Q");   // another tab writes
  return { ok: ts.tget("lfh_cart") === "Q", note: `read ${ts.tget("lfh_cart")} (another tab wrote Q after storage came back)` };
});
check("R4-M04", "M", "a removal the phone refuses is remembered as removed — the phone's old copy does not come back from the dead", async () => {
  const mode = { v: "ok" }; const { ts } = await fresh(mode);
  ts.tset("lfh_active_orders", "[1]"); mode.v = "blocked"; ts.tremove("lfh_active_orders"); mode.v = "ok";
  return { ok: ts.tget("lfh_active_orders") === null, note: `read ${ts.tget("lfh_active_orders")}` };
});
check("R4-M05", "M", "the explicit-restaurant pair (tsetFor / tgetFor) keeps a refused write too, under that restaurant only", async () => {
  const mode = { v: "quota" }; const { ts } = await fresh(mode);
  ts.tsetFor("lfh_active_orders", "Pizza-Palace", "PP");
  return { ok: ts.tgetFor("lfh_active_orders", "pizza-palace") === "PP" && ts.tgetFor("lfh_active_orders", "french-house") === null && ts.tget("lfh_active_orders") === null, note: `pizza-palace ${ts.tgetFor("lfh_active_orders", "pizza-palace")} · french-house ${ts.tgetFor("lfh_active_orders", "french-house")}` };
});
check("R4-M06", "M", "a normal phone: nothing is kept in memory — what the phone stores is what is read", async () => {
  const mode = { v: "ok" }; const { ts, store } = await fresh(mode);
  ts.tset("lfh_cart", "X"); store.set("lfh_cart:french-house", "Y");
  return { ok: ts.tget("lfh_cart") === "Y", note: `read ${ts.tget("lfh_cart")}` };
});
check("R4-M07", "M", "every decimal digit Unicode knows (all 770, in 72 scripts) becomes the right 0–9 digit; each script's zero is 0 and nine is 9", async () => {
  const { toAsciiDigits } = await real("lib/digits.ts"); let n = 0, bad = 0, runs = 0;
  for (let cp = 1; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; const c = String.fromCodePoint(cp);
    if (!/\p{Nd}/u.test(c)) continue; n++;
    if (!/^[0-9]$/.test(toAsciiDigits(c))) bad++;
    if (!/\p{Nd}/u.test(String.fromCodePoint(cp - 1))) { runs++; if (toAsciiDigits(c) !== "0" || toAsciiDigits(String.fromCodePoint(cp + 9)) !== "9") bad++; }
  }
  return { ok: n === 770 && runs === 72 && !bad, note: `${n} digits in ${runs} scripts, ${bad} wrong` };
});
check("R4-M08", "M", "keepDigits keeps only digits: letters, signs, spaces, fractions, superscripts and Roman numerals are dropped", async () => {
  const { keepDigits } = await real("lib/digits.ts");
  const cases = [["a1b2", "12"], ["٤٢", "42"], ["४२", "42"], ["૪૨", "42"], ["４２", "42"], ["𝟒𝟐", "42"], [" 4 2 ", "42"], ["-7", "7"], ["7.5", "75"], ["½", ""], ["⁷", ""], ["Ⅶ", ""], ["", ""], ["١٢٣٤", "1234"]];
  const bad = cases.filter(([i, o]) => keepDigits(i) !== o);
  return { ok: !bad.length, note: bad.map(([i, o]) => `${i} → ${keepDigits(i)} (want ${o})`).join(" · ") || `${cases.length} cases` };
});
check("R4-M09", "M", "600 random tables typed in mixed scripts: the door reads the raw string exactly as the box would keep it, and the answer is the plain whole number (or a refusal for 0 / too long)", async () => {
  const { keepDigits } = await real("lib/digits.ts"); const { guestTable } = await real("lib/planTable.ts");
  const parts = ["1", "2", "7", "0", "٤", "४", "４", "٠", "૯"]; const bad = []; let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 600; i++) {
    const digits = Array.from({ length: 1 + Math.floor(rnd() * 11) }, () => parts[Math.floor(rnd() * parts.length)]).join("");
    const typed = (rnd() < 0.3 ? " " : "") + digits + (rnd() < 0.3 ? " " : "");
    const box = keepDigits(typed); const n = Number(box);
    const want = box.length <= 9 && n >= 1 ? String(n) : null;
    const door = guestTable(typed), fromBox = guestTable(box);
    if (door !== want || fromBox !== want) bad.push(`${JSON.stringify(typed)}: door ${door}, box→door ${fromBox}, want ${want}`);
  }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || "600 tables, door and box agree with the plain number every time" };
});
check("R4-M10", "M", "guestTable reads ٤ / ४ / ４ as table 4 and ٠٠٧ as table 7, and still refuses 0, words and anything past nine digits", async () => {
  const { guestTable } = await real("lib/planTable.ts");
  const cases = [["٤", "4"], ["४", "4"], ["４", "4"], ["٠٠٧", "7"], [" ٧ ", "7"], [7, "7"], ["0", null], ["٠", null], ["seven", null], ["1234567890", null], ["7.5", null], [7.5, null], ["", null], [null, null]];
  const bad = cases.filter(([i, o]) => guestTable(i) !== o);
  return { ok: !bad.length, note: bad.map(([i, o]) => `${JSON.stringify(i)} → ${guestTable(i)} (want ${o})`).join(" · ") || `${cases.length} cases` };
});
