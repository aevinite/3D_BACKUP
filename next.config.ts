import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS folder. A stray lockfile in the user's
  // home dir (C:\Users\rishi\package-lock.json) makes Turbopack otherwise
  // infer the wrong root, which has caused intermittent dev 500s / panics.
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "littlefrenchhouse.in" },
    ],
  },
};

// Wrap the config so Sentry can auto-instrument the build and (in CI, with an
// auth token) upload source maps for readable production stack traces.
export default withSentryConfig(nextConfig, {
  org: "avess-org",
  project: "javascript-nextjs",
  // Only print source-map upload logs in CI; keep local builds quiet.
  silent: !process.env.CI,
});
