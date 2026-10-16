// scripts/sweep/t14r2/run.mjs — sweep #10 · T14 · ROUND 2: the owner's fresh full re-test (2026-10-16).
//   node --experimental-strip-types --no-warnings scripts/sweep/t14r2/run.mjs [--only P214001] [--quiet] [--ledger] [--no-db]
// Ids P214001–P214999 (claimed on main first, #1532). Runner and SQL door: ../t14s10/lib.mjs.
import { runAll } from "../t14s10/lib.mjs";
await import("./a-money.mjs");
await import("./b-db.mjs");
await import("./cde.mjs");
await import("./f-sheet.mjs");
await import("./ghijl.mjs");
await runAll("T14 round 2 · the bill and KOT document, re-tested from scratch");
