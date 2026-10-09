// Runs the whole round-2 suite once under node:test so --experimental-test-coverage can measure it.
import { test } from "node:test";
test("sweep #10 T30 round 2 — every branch of the money libraries", async () => {
  process.env.T30_NOEXIT = "1";
  process.argv.push("--quiet");
  await import("./run.mjs");
});
