// SWEEP #10 T17 ROUND 5 — part of verify:t17-signin (scripts/verify-t17-signin.mjs). HERMETIC: every row this suite
// touches — staff_users, staff_actions, rate_limit_events, login_throttle, fail_count, restaurants — lives in the in-memory
// stub (./sb.mjs) and is wiped by world() before each check, so no wrong password here ever reaches a database, a limit
// counter or the owner's phone (any fetch a check has not replaced is refused).
process.env.R4_FAKE_SENTRY = "1";
import { t, save, root } from "./r5lib.mjs";
import { readFileSync } from "node:fs";
const S = (globalThis.__R4SENTRY ||= { inits: [] }); const SP = await import("@/lib/sentryPrivacy.ts");
const W = root + "/";
const opts = {};
for (const f of ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]) { const n = S.inits.length; await import(W + f); opts[f] = S.inits[n]; }
const keys = Object.values(opts).map((o) => JSON.stringify(Object.keys(o).sort()));
t("sentry.server.config.ts", "the server, edge and browser reporters are set up with exactly the same options", new Set(keys).size === 1 && new Set(Object.values(opts).map((o) => o.dsn)).size === 1, keys[0]);
for (const [f, o] of Object.entries(opts)) {
  t(f, "structured logs are switched on (enableLogs)", o.enableLogs === true);
  t(f, "nothing in the setup asks for request bodies, cookies or database values", JSON.stringify(o.dataCollection) === JSON.stringify(SP.SENTRY_DATA_COLLECTION));
  t(f, "R61: the owner's 'no' to item 32 is written on the trace-rate line itself", /REJECTED \(owner, 2026-10-09\): lowering the developer-machine rate below 1\.0 — "don't do 32"\. docs\/REJECTED-IDEAS\.md R61\.\n\s*tracesSampleRate:/.test(readFileSync(W + f, "utf8")));
}
const keepEnv = process.env.NODE_ENV; process.env.NODE_ENV = "production";
const n = S.inits.length; await import(W + "sentry.server.config.ts?prod=1");
t("sentry.server.config.ts", "on the live site the reporter samples exactly 10% of page loads", S.inits[n]?.tracesSampleRate === 0.1);
process.env.NODE_ENV = "development"; const n2 = S.inits.length; await import(W + "sentry.edge.config.ts?dev=1");
t("sentry.edge.config.ts", "on a developer machine it samples 100% (the owner chose to keep this — R61)", S.inits[n2]?.tracesSampleRate === 1);
process.env.NODE_ENV = keepEnv;
const I = await import(W + "instrumentation.ts");
t("instrumentation.ts", "start-up is an async function (Next waits for it)", I.register.constructor.name === "AsyncFunction");
save((process.env.T17_SAVE || "") + "/U-sentry.json");
