// scripts/sweep/t24-sweep.mjs — the whole of terminal 24's sweep, in one command.
//   node scripts/sweep/t24-sweep.mjs            # everything
//   node scripts/sweep/t24-sweep.mjs --quiet     # only the failures
//   node scripts/sweep/t24-sweep.mjs --ledger    # the markdown table for the ledger file
import { run, F } from "./t24-run.mjs";
await F.warmLive();
await import("./t24-checks.mjs");
await import("./t24-new-a.mjs");
await import("./t24-new-b.mjs");
await import("./t24-new-c.mjs");
await import("./t24-new-d.mjs");
await import("./t24-new-e.mjs");
await import("./t24-new-f.mjs");
await run();
