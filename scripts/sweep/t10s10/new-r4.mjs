// Round 4 (2026-10-11) — the owner's "do 3,4,5,6". P211563 onward (round 3's claimed block).
//   item 3  the waiter tablet refuses a typed price with a minus sign (the twin of item 20)
//   item 4  the refusals and words that could never be reached are removed from the manager route
//   item 5  on a phone the restaurant's name sits on its own line under "Manager", whole
//   item 6  the printing sweep's own red rows: three colour/size/cut faults on the admin board, and a
//           test bill that fell outside a manager's reach
// The guard lines are read from `verify:t10-writes` (one row per "(round 4)" line it prints), and the
// manager route is driven in memory exactly as round 3 drove it.
import { execFileSync } from "node:child_process";
import { check, call, ROOT } from "./lib.mjs";
import { fullWorld, ID } from "./endpoints.mjs";

let n = 211563;
const row = (what, fn, how = "STUB · the real route, French House manager unless named") => check(`P${n++}`, what, how, fn);
const run = async (setup, verb, path, body) => {
  const G = await fullWorld(setup); G.HONOUR_UPDATE_RETURN = true; G.HONOUR_COLUMNS = false;
  if (setup.mut) setup.mut(G);
  return { G, r: await call(verb, path, body === undefined || body === null ? {} : { body }) };
};
const nowIso = () => new Date().toISOString();
const PRINT = { settings: { modules: { printing: { routes: { bill: { agent: "ag1", printer: "EPSON" } } } }, auto_print_kot: true, auto_print_kot_allowed: true },
  mut: (G) => { G.FIX.print_agents = [{ id: "ag1", restaurant_id: "rest-1", name: "Till PC", printers: [{ name: "EPSON" }], last_seen_at: nowIso(), revoked_at: null, owner_device: "dev-test", seen_fingerprints: [] }]; G.FIX.print_jobs = []; } };

// ── item 4: what the deleted lines were guarding still behaves exactly as before ──────────────
row("item 4 · a counter parcel is still taken (the always-on parcel switch's refusal is gone, the door is not)", async () => {
  const { G, r } = await run({ rpc: { lfh_platform_insert: { id: ID.plat } } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }] });
  return { ok: r.status === 200 && G.RPCS.some((c) => c.name === "lfh_platform_insert"), note: `${r.status}` }; });
row("item 4 · …and a parcel naming a dish that is not on the menu is refused BY NAME, as it always was before the dead 'no valid dishes' line", async () => {
  const { r } = await run({}, "POST", "parcel", { items: [{ id: "ghost", qty: 1 }] }); return { ok: r.status === 400 && /isn't on the menu/.test(r.text), note: r.text.slice(0, 60) }; });
row("item 4 · the owner's demo delivery order still works with the dead 'Platform board' line gone", async () => {
  const { r } = await run({ who: "owner", rpc: { lfh_platform_insert: { id: "p-demo" } }, settings: { platform_channels: { zomato: { on: true } } } }, "POST", "platform/test", { channel: "zomato" });
  return { ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 50)}` }; });
row("item 4 · a test page on this computer's printer still goes out now that its wrapper is gone", async () => {
  const { G, r } = await run(PRINT, "POST", "printing/test", { printer: "EPSON" });
  return { ok: r.status === 200 && G.FIX.print_jobs.some((j) => j.kind === "test"), note: `${r.status} ${r.text.slice(0, 50)}` }; });
row("item 4 · …a SAMPLE bill still goes to the computer that owns bills", async () => {
  const { r } = await run(PRINT, "POST", "printing/test", { sample: "bill" }); return { ok: r.status === 200 && /EPSON/.test(r.text), note: `${r.status} ${r.text.slice(0, 50)}` }; });
row("item 4 · …and every other printing verb is still refused — only Aevidine sets printers up", async () => {
  const s = []; for (const p of ["printing/route", "printing/zap", "printing"]) s.push((await run(PRINT, "POST", p, {})).r.status); return { ok: s.every((x) => x === 403 || x === 404), note: JSON.stringify(s) }; });
row("item 4 · cancelling an unpaid ticket writes the Activity line 'cancelled'; a PAID ticket is still refused the cancel", async () => {
  const a = await run({}, "PATCH", `orders/${ID.order}`, { status: "cancelled" }); const l = a.G.LOGS.find((x) => x.action === "order_cancel");
  const b = await run({ mut: (G) => { G.FIX.orders.find((o) => o.id === ID.order).payment_status = "paid"; } }, "PATCH", `orders/${ID.order}`, { status: "cancelled" });
  return { ok: l && l.detail === "cancelled" && b.r.status === 409, note: `${l && l.detail} / ${b.r.status}` }; });

// ── items 3, 4, 5: one row per "(round 4)" line of the guard ──────────────────────────────────
let lines = null;
const guard = () => {
  if (!lines) { let out; try { out = execFileSync("node", ["scripts/verify-t10-manager-writes.mjs"], { cwd: ROOT, stdio: "pipe", timeout: 300000 }).toString(); } catch (e) { out = String(e.stdout || ""); }
    lines = out.split("\n").filter((l) => /^\s+[✓✗] item \d+ \(round 4\)/.test(l)).map((l) => ({ ok: l.trim().startsWith("✓"), text: l.trim().slice(2) })); }
  return lines;
};
for (let i = 0; i < 10; i++) check(`P${n++}`, `verify:t10-writes (round 4) line ${i + 1}`, "npm run verify:t10-writes — the real manager and tablet routes driven in memory; the style sheet read",
  () => { const L = guard()[i]; return L ? { ok: L.ok, note: L.text } : { ok: false, note: "the guard no longer prints this line" }; });
