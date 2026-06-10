// Sentry init for the Edge runtime (middleware and edge routes).
// Loaded by instrumentation.ts when the server boots in the "edge" runtime.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Public DSN — same project as the server/client configs. Safe to commit.
  dsn: "https://de475986760bc6c27374add4d365a5b7@o4511538547982336.ingest.us.sentry.io/4511538551259136",
  // Attach request headers + user IP to events for easier debugging.
  sendDefaultPii: true,
  // Trace 100% in development, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Forward structured logs to Sentry.
  enableLogs: true,
});
