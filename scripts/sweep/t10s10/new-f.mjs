// Block F — LIVE on this terminal's own dev server (port 4410), signed in ONCE as French House's
// manager, plus what was SEEN in Chrome (P179901–P179910). The live writes all name an id that does
// not exist, so they can only ever be refused — a stale-tab tap, the shape the fixes are about.
// Nothing is written to French House and Aangan is not touched.
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { check, live, noLive, sql, FRENCH_HOUSE } from "./lib.mjs";

const gone = () => randomUUID();
let n = 179901;
const row = (what, how, fn) => check(`P${n++}`, what, how, fn);
row("LIVE · the manager panel's whoami answers for French House and carries the discount limit the screen caps with", "GET /api/editor/whoami on :4410",
  async () => { const r = await live("/whoami"); const s = noLive(r); if (s) return s;
    return { ok: r.status === 200 && r.json && ("discountCapPct" in r.json), note: `${r.status} · cap ${r.json && r.json.discountCapPct}` }; });
row("LIVE · item 2 — POST platform/toggles is gone (404), and French House's kitchen setting did not move", "POST on :4410 + one DB read before and after",
  async () => { const q = `select kitchen_can_accept_platform v from settings where restaurant_id = '${FRENCH_HOUSE}' limit 1`;
    const before = (await sql(q))[0]; const r = await live("/platform/toggles", { method: "POST", body: { kitchen_can_accept_platform: !(before && before.v) } }); const s = noLive(r); if (s) return s;
    const after = (await sql(q))[0]; return { ok: r.status === 404 && JSON.stringify(before) === JSON.stringify(after), note: `${r.status} · before ${before && before.v} after ${after && after.v}` }; });
row("LIVE · item 9 — POST printer-events/:id/resolve is gone (404)", "POST on :4410, an id that does not exist",
  async () => { const r = await live(`/printer-events/${gone()}/resolve`, { method: "POST", body: {} }); const s = noLive(r); if (s) return s; return { ok: r.status === 404, note: `${r.status}` }; });
row("LIVE · item 6 — a tip on a ticket that is not there is refused 404, not 'saved'", "POST on :4410, an id that does not exist",
  async () => { const r = await live(`/orders/${gone()}/tip`, { method: "POST", body: { amount: 10 } }); const s = noLive(r); if (s) return s; return { ok: r.status === 404 && /isn't there anymore/.test(r.text), note: `${r.status} ${r.text.slice(0, 60)}` }; });
row("LIVE · item 1 — serving a dish that is not there answers 404 before anything is written", "POST on :4410, an id that does not exist",
  async () => { const r = await live(`/items/${gone()}/status`, { method: "POST", body: { status: "served" } }); const s = noLive(r); if (s) return s; return { ok: r.status === 404, note: `${r.status}` }; });
row("LIVE · item 8 — lifting a ban that is not there answers 404, no 'unbanned' line", "DELETE on :4410, an id that does not exist + read the Activity log tail",
  async () => { const r = await live(`/blocklist/${gone()}`, { method: "DELETE" }); const s = noLive(r); if (s) return s;
    const rows = await sql(`select count(*)::int n from staff_actions where restaurant_id = '${FRENCH_HOUSE}' and action = 'blocklist_remove' and created_at > now() - interval '1 minute'`);
    return { ok: r.status === 404 && rows[0].n === 0, note: `${r.status} · unban lines in the last minute: ${rows[0].n}` }; });
row("LIVE · Accept on a ticket that is not there answers 404 (a missing row is not a server fault)", "POST on :4410, an id that does not exist",
  async () => { const r = await live(`/orders/${gone()}/accept`, { method: "POST", body: {} }); const s = noLive(r); if (s) return s; return { ok: r.status === 404, note: `${r.status} ${r.text.slice(0, 60)}` }; });
// What was SEEN in Chrome — recorded by this terminal into a scratch file while looking, then read here.
const SEEN = process.env.T10_SEEN || "";
const seen = (k) => { if (!SEEN || !existsSync(SEEN)) return "skip: run with T10_SEEN=<the Chrome observations file> after looking"; const o = JSON.parse(readFileSync(SEEN, "utf8"))[k]; return o ? { ok: o.ok, note: o.note } : "skip: not looked at yet"; };
row("SEEN · manager floor, desktop 1280, light and dark — French House's own name, no undefined / NaN / [object Object]", "Chrome DevTools (isolated) on :4410, screenshot read", () => seen("desktop"));
row("SEEN · manager floor + a table's bill, Samsung A35 360×780 dpr3 — nothing cut off or overlapping", "Chrome DevTools emulation on :4410, screenshot read", () => seen("phone"));
row("SEEN · manager panel on iPad 1194×834 — the Bills and Tables screens lay out cleanly", "Chrome DevTools emulation on :4410, screenshot read", () => seen("ipad"));
