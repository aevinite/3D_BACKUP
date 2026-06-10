// Sentry init for the browser. Next.js loads this automatically on the client.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Public DSN — ships to the browser anyway; safe to commit.
  dsn: "https://de475986760bc6c27374add4d365a5b7@o4511538547982336.ingest.us.sentry.io/4511538551259136",
  // Attach basic request info to events.
  sendDefaultPii: true,
  // Trace 100% in development, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Forward structured logs to Sentry.
  enableLogs: true,
  // NOTE: session replay + the feedback widget are intentionally left out for now
  // (they add bundle weight and a visible on-page widget). Easy to add later.
});

// Lets Sentry measure client-side route navigations (App Router transitions).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
