// scripts/sweep/t14s10/run.mjs — sweep #10 · terminal 14 · the bill and KOT document.
//   node --experimental-strip-types --no-warnings scripts/sweep/t14s10/run.mjs [--only P…] [--quiet] [--ledger] [--no-db]
// The driven checks are separate (./live.mjs) because they need a running app.
import { runAll } from "./lib.mjs";
await import("./rerun.mjs");
await import("./new-a.mjs");
await import("./new-b.mjs");
await import("./new-c.mjs");
await import("./new-d.mjs");
await import("./new-e.mjs");
await import("./new-g.mjs");
await runAll("T14 · the bill and KOT document");
