#!/usr/bin/env node
// verify:sentry-privacy — an error report never carries a sign-in cookie, a typed password or a
// credential header OUT of this app (sweep #10, T17, item 1, 2026-10-08).
//
// WHY. All three Sentry setups said `sendDefaultPii: true`. In @sentry/nextjs 10.x that copies the
// incoming request's headers wholesale into every error report, cookie header included — so the staff
// session (`lfh_user`), the admin console session (`lfh_staff_auth`), the print helper's token
// (`x-lfh-agent`) and a webhook secret all went to the outside error service on every server error.
// lib/sentryPrivacy.ts is the fix; this guard proves it the only way that counts — by running the
// SDK's OWN request-copying code over a realistic signed-in request and reading what comes out.
//
// THE GUARD CHECKS ITS OWN EYES FIRST. Section A feeds the same request through the OLD settings and
// asserts the secrets DO appear. If that ever stops being true (an SDK upgrade that changes the shape),
// the "no secret in the report" checks below would be passing for the wrong reason, so the guard fails
// rather than going green on nothing.
//
// Repo-only: no server, no database, no key. Run: npm run verify:sentry-privacy
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const core = require("@sentry/core");
const { resolveDataCollectionOptions } = require(join(ROOT, "node_modules/@sentry/core/build/cjs/utils/data-collection/resolveDataCollectionOptions.js"));
const { SENTRY_DATA_COLLECTION, scrubSentryEvent, isSecretName } = await import(join(ROOT, "lib/sentryPrivacy.ts"));

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
};

// Recognisable fake values — never a real key. If one of these strings survives into the report, a
// real one would have too.
const SECRETS = {
  staff: "STAFFCOOKIE.1700000000000.sigsigsig",
  admin: "ADMINCOOKIEHASH0123456789abcdef",
  reveal: "1700000000000.REVEALSIG",
  agent: "PRINTHELPERTOKEN-xyz",
  bearer: "BEARERTOKEN-abc",
  webhook: "WEBHOOKSECRET-123",
  password: "typed-password-hunter2",
};
const request = {
  method: "POST",
  url: "https://3-d-backup.vercel.app/api/panel-login",
  headers: {
    cookie: `lfh_user=${SECRETS.staff}; lfh_staff_auth=${SECRETS.admin}; lfh_reveal=${SECRETS.reveal}; lfh_panel_theme=dark`,
    "x-lfh-agent": SECRETS.agent,
    authorization: `Bearer ${SECRETS.bearer}`,
    "x-webhook-secret": SECRETS.webhook,
    "user-agent": "Mozilla/5.0 (verify-sentry-privacy)",
    "x-forwarded-for": "203.0.113.7",
    "x-lfh-action-id": "act-123",
  },
  data: JSON.stringify({ username: "diagm1", password: SECRETS.password }),
};

// Run the SDK's real requestDataIntegration over an event, under a given set of client options.
function reportFor(options, scrub) {
  const integ = core.requestDataIntegration();
  const client = { getDataCollectionOptions: () => resolveDataCollectionOptions(options) };
  let ev = { message: "boom", sdkProcessingMetadata: { normalizedRequest: structuredClone(request), ipAddress: "203.0.113.7" } };
  ev = integ.processEvent(ev, {}, client);
  // And the span path: the attributes a traced request would carry.
  const spanData = core.httpHeadersToSpanAttributes(structuredClone(request.headers), resolveDataCollectionOptions(options), "request");
  const tx = { type: "transaction", contexts: { trace: { data: { ...spanData } } }, spans: [{ data: { ...spanData } }] };
  const span = { data: { ...spanData } };
  delete ev.sdkProcessingMetadata;
  if (scrub) { scrubSentryEvent(ev); scrubSentryEvent(tx); scrubSentryEvent(span); }
  return { ev, tx, span };
}
const leaked = (obj) => Object.entries(SECRETS).filter(([, v]) => JSON.stringify(obj).includes(v)).map(([k]) => k);

console.log("── A. the guard can see a secret when one is there (the OLD settings) ──");
{
  const { ev, tx } = reportFor({ sendDefaultPii: true }, false);
  const l = leaked(ev);
  check("the old `sendDefaultPii: true` copies the staff sign-in cookie into an error report", l.includes("staff"), `saw ${l.join(",") || "nothing"}`);
  check("…and the admin console cookie", l.includes("admin"));
  check("…and the print helper's token header", l.includes("agent"));
  check("…and the webhook secret header", l.includes("webhook"));
  check("…and a traced request's span names the staff cookie too", leaked(tx).includes("staff"), `saw ${leaked(tx).join(",") || "nothing"}`);
}

console.log("── B. the settings this app now uses ──");
{
  const opts = { dataCollection: SENTRY_DATA_COLLECTION, sendDefaultPii: true };
  const { ev, tx, span } = reportFor(opts, true);
  check("no secret reaches an ERROR report", leaked(ev).length === 0, `still there: ${leaked(ev).join(",")}`);
  check("no secret reaches a TRANSACTION", leaked(tx).length === 0, `still there: ${leaked(tx).join(",")}`);
  check("no secret reaches a SPAN", leaked(span).length === 0, `still there: ${leaked(span).join(",")}`);
  check("the report still carries the user agent (debugging is not lost)", ev.request?.headers?.["user-agent"]?.includes("verify-sentry-privacy"));
  check("…and the person's IP", ev.user?.ip_address === "203.0.113.7", JSON.stringify(ev.user));
  check("…and our own x-lfh-action-id bookkeeping header", ev.request?.headers?.["x-lfh-action-id"] === "act-123");
  check("no `cookies` object is attached at all", !("cookies" in (ev.request || {})));
  check("no request body is attached (a sign-in body is a typed password)", !("data" in (ev.request || {})));
  // Collection alone, WITHOUT the cleaner — layer 1 must already drop the cookies by itself.
  const raw = reportFor(opts, false);
  check("layer 1 alone (no cleaner) already keeps every cookie out", !leaked(raw.ev).some((k) => ["staff", "admin", "reveal"].includes(k)), leaked(raw.ev).join(","));
  // And the cleaner alone on the OLD collection — layer 2 must also hold by itself.
  const two = reportFor({ sendDefaultPii: true }, true);
  check("layer 2 alone (old collection + cleaner) also removes every secret", leaked(two.ev).length === 0 && leaked(two.tx).length === 0, `${leaked(two.ev)} / ${leaked(two.tx)}`);
}

console.log("── C. the name test ──");
for (const n of ["cookie", "Cookie", "authorization", "x-lfh-agent", "x-webhook-secret", "http.request.header.cookie.lfh_user", "lfh_reveal", "lfh_staff_auth", "x-api-key"]) {
  check(`"${n}" is treated as a credential`, isSecretName(n) === true);
}
for (const n of ["user-agent", "User-Agent", "x-lfh-action-id", "x-forwarded-for", "referer", "content-type"]) {
  check(`"${n}" is kept`, isSecretName(n) === false);
}
check("the cleaner never throws on a junk event", (() => { try { scrubSentryEvent(null); scrubSentryEvent({ request: 5, spans: "x" }); return true; } catch { return false; } })());

console.log("── D. every Sentry setup in the repo uses it ──");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
for (const f of ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]) {
  const code = strip(readFileSync(join(ROOT, f), "utf8"));
  check(`${f} calls Sentry.init`, /Sentry\.init\(/.test(code));
  check(`${f} sets dataCollection: SENTRY_DATA_COLLECTION`, /dataCollection:\s*SENTRY_DATA_COLLECTION/.test(code));
  for (const hook of ["beforeSend", "beforeSendTransaction", "beforeSendSpan"]) {
    check(`${f} runs ${hook} through scrubSentryEvent`, new RegExp(`${hook}:\\s*scrubSentryEvent`).test(code));
  }
  check(`${f} no longer switches sendDefaultPii on`, !/sendDefaultPii:\s*true/.test(code));
}
// A FOURTH init somewhere would be outside all of the above.
{
  const { execFileSync } = await import("node:child_process");
  const files = execFileSync("git", ["grep", "-l", "-E", "Sentry\\.init\\(", "--", ":!node_modules", ":!scripts/verify-sentry-privacy.mjs"], { cwd: ROOT, encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort();
  check("there are exactly three Sentry.init calls, the three checked above", JSON.stringify(files) === JSON.stringify(["instrumentation-client.ts", "sentry.edge.config.ts", "sentry.server.config.ts"]), files.join(", "));
}

console.log(fail ? `\n✗ FAIL — ${pass} passed, ${fail} failed` : `\n✅ verify:sentry-privacy — all ${pass} checks passed: an error report carries no sign-in cookie, typed password or credential header.`);
process.exit(fail ? 1 : 0);
