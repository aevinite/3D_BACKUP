// Block D — the small libraries this territory stands on, RUN (P173207…): lib/guestName.ts (one name
// per diner), lib/guestDevice.ts (the ban/session device id), lib/botCheck.ts (the login filter),
// lib/channelKey.ts (the delivery-channel key rule) and components/BotTrap.tsx's botFields().
import { check, band, load, FILES, W, resetWorld } from "./lib.mjs";
import { install, reset, phone } from "./phone.mjs";
const HOW = "STUB — real file, stand-in phone / database client";
band(173207);
install();
const fresh = async (rel, path = "/r/aangan/menu") => { reset({ path }); resetWorld(); return load(rel); };
const GN = FILES.gname, GD = FILES.gdev, BC = FILES.bot, CK = FILES.chan, BT = FILES.trap;
const flush = () => new Promise((r) => setTimeout(r, 10));
// ── guestName ──
check(GN, "tidyGuestName collapses runs of whitespace, trims, and caps at 40", HOW, async () => { const g = await fresh(GN); const r = g.tidyGuestName("  Mia \n  Patel  " + "x".repeat(60)); return { ok: r.startsWith("Mia Patel x") && r.length === 40 && g.GUEST_NAME_MAX === 40, note: `${r.length}` }; });
check(GN, "…and anything that is not text comes back empty, never 'undefined'", HOW, async () => { const g = await fresh(GN); return g.tidyGuestName(undefined) === "" && g.tidyGuestName(null) === "" && g.tidyGuestName(0) === ""; });
check(GN, "getGuestName() is '' for a diner who never gave one", HOW, async () => { const g = await fresh(GN); return g.getGuestName() === ""; });
check(GN, "…and is read through the same tidy rule, so a hand-edited value cannot show 80 characters", HOW, async () => { const g = await fresh(GN); phone.ls.set("lfh_my_name:aangan", "  A   B  " + "y".repeat(80)); const n = g.getGuestName(); return n.length === 40 && n.startsWith("A B"); });
check(GN, "…and storage switched off answers '' rather than throwing during render", HOW, async () => { const g = await fresh(GN); phone.lsBlocked = true; try { return g.getGuestName() === ""; } catch { return false; } });
check(GN, "setGuestName('   ') changes nothing — clearing a box is not renaming (no write, no event, no rename)", HOW, async () => {
  const g = await fresh(GN); const r = g.setGuestName("   ", "RID"); await flush(); return r === false && !phone.ls.has("lfh_my_name:aangan") && phone.events.length === 0 && W.rpcLog.length === 0;
});
check(GN, "a new name is stored under THIS restaurant, announced once, and true is returned", HOW, async () => {
  const g = await fresh(GN); const r = g.setGuestName(" Mia ", "RID"); await flush(); const e = phone.events.filter((x) => x.type === g.GUEST_NAME_EVENT);
  return { ok: r === true && phone.ls.get("lfh_my_name:aangan") === "Mia" && e.length === 1 && e[0].detail.name === "Mia" && g.GUEST_NAME_EVENT === "lfh:guest-name-changed", note: JSON.stringify(e) };
});
check(GN, "…and the reviews this phone already left are renamed with the REVIEW device id (lfh_device_id), not the ban one", HOW, async () => {
  const g = await fresh(GN); phone.ls.set("lfh_device_id", "REVIEW-DEV"); phone.ls.set("lfh_device", "BAN-DEV"); g.setGuestName("Mia", "RID"); await flush();
  const c = W.rpcLog.find((x) => x.fn === "lfh_rename_my_reviews"); return { ok: !!c && c.args.p_device === "REVIEW-DEV" && c.args.p_restaurant_id === "RID" && c.args.p_name === "Mia", note: JSON.stringify(c && c.args) };
});
check(GN, "the SAME name again changes nothing — no write, no event, no rename", HOW, async () => {
  const g = await fresh(GN); g.setGuestName("Mia", "RID"); await flush(); phone.events.length = 0; const n = W.rpcLog.length; const r = g.setGuestName("  Mia ", "RID"); await flush();
  return r === false && phone.events.length === 0 && W.rpcLog.length === n;
});
check(GN, "with no restaurant given, the name is kept but no review rename is attempted", HOW, async () => { const g = await fresh(GN); const r = g.setGuestName("Ravi"); await flush(); return r === true && W.rpcLog.length === 0; });
check(GN, "a failed rename never fails the thing the diner was doing", HOW, async () => {
  const g = await fresh(GN); W.rpc.lfh_rename_my_reviews = { data: null, error: { message: "boom" } }; let r; try { r = g.setGuestName("Mia", "RID"); await flush(); } catch { return false; } return r === true;
});
// Re-aimed 2026-10-13 (item 10 fixed): it used to answer true here, so the review toast promised
// "saved as your name" in a private window. It now answers false — and still renames past reviews.
check(GN, "storage switched off (private window): nothing is kept on the phone, the server half still renames past reviews, and the answer is FALSE so nobody is told it was saved (item 10)", HOW, async () => {
  const g = await fresh(GN); phone.lsBlocked = true; const r = g.setGuestName("Mia", "RID"); await flush();
  const renamed = W.rpcLog.some((x) => x.fn === "lfh_rename_my_reviews");
  return { ok: r === false && phone.ls.size === 0 && renamed && g.getGuestName() === "", note: `answered ${r}, kept nothing, rename sent ${renamed}` };
});
check(GN, "the one name is PER RESTAURANT: a name given at Aangan does not appear at Sakura Sushi", HOW, async () => { const g = await fresh(GN); g.setGuestName("Mia", "RID"); phone.path = "/r/sakura-sushi/menu"; return g.getGuestName() === ""; });
// ── guestDevice ──
check(GD, "getGuestDeviceId() makes an id once and keeps it — the same id on every call", HOW, async () => { const d = await fresh(GD); const a = d.getGuestDeviceId(); return a.length > 10 && d.getGuestDeviceId() === a && phone.ls.get("lfh_device") === a; });
check(GD, "…an id already on the phone is used, never replaced", HOW, async () => { const d = await fresh(GD); phone.ls.set("lfh_device", "KEEP-ME"); return d.getGuestDeviceId() === "KEEP-ME"; });
check(GD, "…it is device-wide on purpose (one key, no restaurant in it)", HOW, async () => { const d = await fresh(GD); d.getGuestDeviceId(); return [...phone.ls.keys()].join() === "lfh_device"; });
check(GD, "…storage switched off → '' (the server treats that as 'no device'), never a throw", HOW, async () => { const d = await fresh(GD); phone.lsBlocked = true; try { return d.getGuestDeviceId() === ""; } catch { return false; } });
check(GD, "…and a browser without crypto.randomUUID still gets a usable id", HOW, async () => {
  const d = await fresh(GD); const keep = globalThis.crypto.randomUUID; Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  try { const id = d.getGuestDeviceId(); return { ok: /^d_[a-z0-9]+_[a-z0-9]+$/.test(id), note: id }; } finally { Object.defineProperty(globalThis.crypto, "randomUUID", { value: keep, configurable: true }); }
});
// ── botCheck ──
const verdict = [
  [undefined, undefined, true, "both signals ABSENT → allowed (a cached panel, the no-JS form, a replayed login)"],
  ["", "", true, "both empty → allowed"], ["   ", "1200", true, "a whitespace-only trap is not a filled trap"],
  ["x", "1200", false, "a FILLED trap → refused as 'trap'"], ["x", undefined, false, "…even with no timing"], ["x", "50", false, "…and the trap wins over the timing"],
  [null, "399", false, "submitted in 399 ms → refused as 'too_fast'"], [null, "400", true, "…400 ms is a person (the floor is inclusive)"], [null, "0", false, "…0 ms is not"],
  [null, "-5", true, "a NEGATIVE duration is untrustworthy → no opinion, allowed"], [null, "abc", true, "a non-number → no opinion, allowed"],
  [null, "Infinity", true, "infinity → no opinion, allowed"], [null, 120, false, "a numeric 120 (JSON body) is judged too"], [5, "1200", true, "a non-text trap value is ignored"],
];
for (const [trap, el, ok, what] of verdict) {
  check(BC, `botVerdict(${JSON.stringify(trap)}, ${JSON.stringify(el)}) — ${what}`, HOW, async () => { const b = await fresh(BC); const v = b.botVerdict(trap, el); return { ok: v.ok === ok, note: JSON.stringify(v) }; });
}
check(BC, "the refusal names WHICH signal (trap / too_fast), so the log can say it", HOW, async () => { const b = await fresh(BC); return b.botVerdict("x", "1").reason === "trap" && b.botVerdict("", "1").reason === "too_fast"; });
check(BC, "the trap field's name is not one a password manager autofills, and the floor is 400 ms", HOW, async () => {
  const b = await fresh(BC); return !/email|user|phone|name|login|pass/i.test(b.BOT_TRAP_FIELD) && b.BOT_TRAP_FIELD === "lfh_hp_ref" && b.BOT_ELAPSED_FIELD === "lfh_hp_ms" && b.MIN_HUMAN_MS === 400;
});
const withEnv = async (k, v, fn) => { const keep = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; try { return await fn(); } finally { if (keep === undefined) delete process.env[k]; else process.env[k] = keep; } };
check(BC, "verifyTurnstile(): with no secret configured it is skipped entirely (allowed)", HOW, async () => { const b = await fresh(BC); return withEnv("TURNSTILE_SECRET_KEY", undefined, async () => (await b.verifyTurnstile(undefined)) === true); });
check(BC, "…with a secret and NO token it refuses — which is why no form may send without the widget (see Part 4)", HOW, async () => { const b = await fresh(BC); return withEnv("TURNSTILE_SECRET_KEY", "s", async () => (await b.verifyTurnstile(undefined)) === false); });
check(BC, "…Cloudflare's own verdict decides when it answers (success:true → allowed, false → refused)", HOW, async () => {
  const b = await fresh(BC); return withEnv("TURNSTILE_SECRET_KEY", "s", async () => {
    globalThis.fetch = async () => ({ json: async () => ({ success: true }) }); const y = await b.verifyTurnstile("tok", "1.2.3.4");
    globalThis.fetch = async () => ({ json: async () => ({ success: false }) }); const n = await b.verifyTurnstile("tok"); return y === true && n === false;
  });
});
check(BC, "…an unreachable Cloudflare does not stop a restaurant signing in (fails open), and the call has a 4 s deadline", HOW, async () => {
  const b = await fresh(BC); return withEnv("TURNSTILE_SECRET_KEY", "s", async () => {
    let init; globalThis.fetch = async (_u, i) => { init = i; throw new Error("ENOTFOUND"); }; const r = await b.verifyTurnstile("tok", "9.9.9.9");
    return r === true && !!init.signal && String(init.body).includes("remoteip=9.9.9.9");
  });
});
// ── channelKey ──
for (const [what, cell, val, want] of [
  ["absent (undefined) leaves the stored key AND the legacy copy exactly as they are", { key: "K", api_key: "OLD", on: true }, undefined, { key: "K", api_key: "OLD", on: true }],
  ["'' (a write-only field saved blank) leaves the stored key standing", { key: "K", on: true }, "", { key: "K", on: true }],
  ["'   ' is blank too, and leaves it", { key: "K" }, "   ", { key: "K" }],
  ["null CLEARS it — both the key and the legacy copy — and keeps everything else", { key: "K", api_key: "OLD", on: true, note: "x" }, null, { on: true, note: "x" }],
  ["a real value replaces it, trimmed, and takes the legacy copy with it", { key: "K", api_key: "OLD", on: false }, "  NEW  ", { on: false, key: "NEW" }],
  ["a channel never set up gets a cell with just the key", undefined, "NEW", { key: "NEW" }],
  ["a number sent by a hand-made request is stored as its text", {}, 12345, { key: "12345" }],
]) {
  check(CK, `applyChannelKey: ${what}`, HOW, async () => {
    const c = await fresh(CK); const r = c.applyChannelKey(cell, val); const norm = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    return { ok: norm(r) === norm(want), note: JSON.stringify(r) };
  });
}
check(CK, "applyChannelKey caps a runaway key at 500 characters", HOW, async () => { const c = await fresh(CK); return c.applyChannelKey({}, "k".repeat(900)).key.length === 500 && c.CHANNEL_KEY_MAX === 500; });
check(CK, "applyChannelKey returns a NEW cell — the caller's stored object is never mutated under it", HOW, async () => { const c = await fresh(CK); const cell = { key: "K", api_key: "O" }; const r = c.applyChannelKey(cell, null); return r !== cell && cell.key === "K" && cell.api_key === "O"; });
check(CK, "channelKeyAction: absent and blank are 'none', null is 'clear', a value is 'set'", HOW, async () => {
  const c = await fresh(CK); return c.channelKeyAction(undefined) === "none" && c.channelKeyAction("") === "none" && c.channelKeyAction("  ") === "none" && c.channelKeyAction(null) === "clear" && c.channelKeyAction("k") === "set";
});
// ── BotTrap.botFields ──
check(BT, "botFields(null) answers an empty pair rather than throwing at submit", HOW, async () => { const b = await fresh(BT); const r = b.botFields(null); return r.trap === "" && r.elapsed === ""; });
check(BT, "botFields(form) reads exactly the two named fields, and '' for a field that is missing", HOW, async () => {
  const b = await fresh(BT); const keep = globalThis.FormData;
  globalThis.FormData = class { constructor(f) { this.f = f; } get(k) { return this.f[k] ?? null; } };
  try { const r = b.botFields({ lfh_hp_ref: "", lfh_hp_ms: "1500", password: "secret" }); const m = b.botFields({}); return r.trap === "" && r.elapsed === "1500" && m.trap === "" && m.elapsed === "" && !("password" in r); }
  finally { globalThis.FormData = keep; }
});
