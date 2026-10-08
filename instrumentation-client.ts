// Sentry init for the browser. Next.js loads this automatically on the client.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION, scrubSentryEvent } from "./lib/sentryPrivacy";

Sentry.init({
  // Public DSN — ships to the browser anyway; safe to commit.
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
  // NOTE: session replay + the feedback widget are intentionally left out for now
  // (they add bundle weight and a visible on-page widget). Easy to add later.
});

// Lets Sentry measure client-side route navigations (App Router transitions).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
