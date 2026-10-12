// scripts/sweep/t14s10/rerun-t11-banks.mjs — sweep #10 · terminal 14 (the bill and KOT document).
//
// Re-runs the inherited ledger rows whose SUBJECT is a file in T14's territory and which live in
// sweep #8 T11's banks. It loads ONLY the banks that hold those rows, through T11's own run(), so
// every row is executed by the exact code that first wrote it.
//
// Why not scripts/sweep/t11/run.mjs: that entry point imports every bank, and one of them
// (new-J.mjs) now refuses to load — its own count assertion expects 140 rows and finds 139. That
// bank holds none of T14's rows, so this driver simply does not import it.
//
//   T11_BASE=http://localhost:4414 node --experimental-strip-types --no-warnings \
//     scripts/sweep/t14s10/rerun-t11-banks.mjs [--only P03780] [--json-out file]
import { run } from "../t11/lib.mjs";
await import("../t11/rerun-GHIJ.mjs");
await import("../t11/rerun-K.mjs");
await import("../t11/rerun-LMN.mjs");
await import("../t11/rerun-OTHERS.mjs");
await import("../t11/new-I.mjs");
const { closeBrowser } = await import("../t11/browser.mjs");
process.on("exit", () => { closeBrowser().catch(() => {}); });
await run("T14 · re-run of T11's rows on the bill and KOT document");
