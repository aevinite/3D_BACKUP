// node scripts/sweep/t11/run.mjs [--only P03506] [--from P03550] [--quiet]
import { run } from "./lib.mjs";
await import("./rerun-A.mjs");
await import("./rerun-B.mjs");
await import("./rerun-CDE.mjs");
await import("./rerun-GHIJ.mjs");
await import("./rerun-F.mjs");
await import("./rerun-F-live.mjs");
await import("./rerun-K.mjs");
await import("./rerun-LMN.mjs");
await import("./new-A.mjs");
await import("./new-B.mjs");
await import("./new-E.mjs");
await import("./new-C.mjs");
await import("./new-D.mjs");
await import("./new-F.mjs");
const { closeBrowser } = await import("./browser.mjs");
process.on("exit", () => { closeBrowser().catch(() => {}); });
await run("T11 · re-run of the inherited printing ledger + this run's new checks");
