// Next.js instrumentation hook — runs once when the server starts.
// We use it to load the correct Sentry init for whichever runtime is active.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Normal Node.js server runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  // Edge runtime (middleware, edge routes)
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown in Server Components, route handlers, and middleware.
export const onRequestError = Sentry.captureRequestError;
