// Sentry init for the Node.js server runtime.
// Loaded by instrumentation.ts when the server boots in the "nodejs" runtime.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Public DSN — tells the SDK which Sentry project to send events to. Safe to commit.
  dsn: "https://de475986760bc6c27374add4d365a5b7@o4511538547982336.ingest.us.sentry.io/4511538551259136",
  // Attach request headers + user IP to events so errors are easier to debug.
  sendDefaultPii: true,
  // Trace 100% of requests in development, 10% in production (keeps the prod quota sane).
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Forward structured logs to Sentry as well.
  enableLogs: true,
});
