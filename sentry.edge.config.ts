// Sentry init for the Edge runtime (middleware and edge routes).
// Loaded by instrumentation.ts when the server boots in the "edge" runtime.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION, scrubSentryEvent } from "./lib/sentryPrivacy";

Sentry.init({
  // Public DSN — same project as the server/client configs. Safe to commit.
  dsn: "https://de475986760bc6c27374add4d365a5b7@o4511538547982336.ingest.us.sentry.io/4511538551259136",
  // Request headers + the user's IP still ride along, so errors stay easy to debug — but NOT cookies,
  // request bodies or any credential header. `sendDefaultPii: true` used to send all of those: the
  // staff and admin sign-in cookies, the print helper's token and a webhook secret were copied into
  // every server error report (sweep #10 T17 item 1). lib/sentryPrivacy.ts says what and why.
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
  beforeSendSpan: scrubSentryEvent,
  // Trace 100% in development, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Forward structured logs to Sentry.
  enableLogs: true,
});
