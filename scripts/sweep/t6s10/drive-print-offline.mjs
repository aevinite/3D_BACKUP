// scripts/sweep/t6s10/drive-print-offline.mjs — item 2, DRIVEN: press Print on a bill with no
// signal and watch what the panel does. Nothing is written: window.open is stubbed (it records
// that the bill window was asked for), and the device is taken offline with Playwright, so the
// send can only ever reach this device's own queue — which the fix must empty again.
import { panel, closeLive } from "./lib.mjs";
const p = await panel();
const sid = await p.frame.evaluate(`(() => { const o = (state.data.orders || []).find((x) => x.session_id); return o ? o.session_id : null; })()`);
const fake = "00000000-0000-4000-8000-00000000c0de";
await p.ctx.setOffline(true);
const r = await p.frame.evaluate(`(async (sid) => {
  window.__opened = 0; const real = window.open; window.open = () => { window.__opened++; return { document: { open() {}, write() {}, close() {} }, focus() {} }; };
  const before = (LFH_OUTBOX.getSnapshot().queued || []).filter((x) => /print\\/send/.test(x.path)).length;
  await printBill("7", { id: sid }, [{ id: "t6-offline", session_id: sid, table_number: "7", status: "served", payment_status: "pending", items: [{ title: "Tea", qty: 1, price: 20 }], subtotal: 20, total: 21 }]);
  await new Promise((f) => setTimeout(f, 1500));
  const t = document.getElementById("toast"); const said = t && !t.hidden ? t.textContent : "";
  const after = (LFH_OUTBOX.getSnapshot().queued || []).filter((x) => /print\\/send/.test(x.path)).length;
  window.open = real;
  return { opened: window.__opened, said, before, after };
})(${JSON.stringify(sid || fake)})`);
await p.ctx.setOffline(false);
console.log(JSON.stringify(r));
const ok = r.opened === 1 && !/Sent to/.test(r.said) && r.after === r.before;
console.log(ok ? "✅ offline Print opens the bill here, says nothing about sending, and leaves nothing in the queue" : "❌ offline Print did not behave");
await closeLive();
process.exit(ok ? 0 : 1);
