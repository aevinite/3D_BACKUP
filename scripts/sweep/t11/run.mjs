// node scripts/sweep/t11/run.mjs [--only P03506] [--from P03550] [--quiet]
import { run } from "./lib.mjs";
await import("./rerun-A.mjs");
await import("./rerun-B.mjs");
await import("./rerun-CDE.mjs");
await import("./rerun-GHIJ.mjs");
await run("T11 · re-run of the inherited printing ledger + this run's new checks");
