// scripts/sweep/t6s10/probe.mjs — open the real manager panel once and print what it can see.
// A smoke test for the harness itself: if this cannot reach the panel, no LIVE row can.
import { panel, ev, closeLive, MY_LAST_LINE, DECLS } from "./lib.mjs";
console.log("my half ends at line", MY_LAST_LINE, "·", DECLS.size, "declarations in the file");
const t0 = Date.now();
await panel();
console.log("panel open in", Date.now() - t0, "ms");
console.log(await ev(`({ tab: state.tab, rid: panelRid(), role: XRAY_WHO && XRAY_WHO.role, tables: (state.data.settings||{}).table_count, inr: inr(1018.6), tiles: document.querySelectorAll('.ftile, [data-floor-table]').length })`));
await closeLive();
