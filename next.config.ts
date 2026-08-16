import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE HEADERS THE BROWSER USES AS PROTECTION (added 2026-08-16).
//
// Until now the only headers this app set were Cache-Control ones (vercel.json). The ones
// below cost nothing at runtime, change no behaviour, and are the ones every browser already
// knows how to act on. Each is deliberately the PERMISSIVE-ENOUGH variant — the brief was
// "add the protection without changing how the app works" — so anything that could break a
// real screen is either SCOPED to the staff surfaces or shipped REPORT-ONLY. Read the note
// above a header before tightening it; every allowance below was written from a grep of this
// codebase, not from a template.
// ─────────────────────────────────────────────────────────────────────────────

// Applies EVERYWHERE, including the guest menu.
const BASE_HEADERS = [
  // Stops a browser second-guessing a Content-Type. Nothing here relies on sniffing: every
  // upload is served with the contentType we stored it with (PNG/JPG/WEBP only, SVG refused).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Full URL to ourselves, origin only to anyone else. This is already Next's default;
  // stating it means it survives a framework default changing under us.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The three device powers the app ACTUALLY uses stay allowed on our own pages:
  //   camera      → the guest QR scanner   (components/SessionGate.tsx, BarcodeDetector)
  //   microphone  → voice note on an issue (public/panels/issue-raise.js)
  //   geolocation → the at-the-table check (lib/session.ts)
  // Everything else is off because nothing in the app asks for it. Getting THIS list wrong is
  // the one way this header breaks a live screen, so it was built by grepping for each API.
  {
    key: "Permissions-Policy",
    value: [
      "camera=(self)",
      "microphone=(self)",
      "geolocation=(self)",
      "payment=()",
      "usb=()",
      "serial=()",
      "bluetooth=()",
      "midi=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
    ].join(", "),
  },
];

// HTTPS-ONLY, PRODUCTION ONLY. Vercel already serves HTTPS and nothing else; this makes the
// BROWSER remember that for two years, so a phone on a café's Wi-Fi never tries plain HTTP
// even once. Deliberately NOT sent in development: a browser that learns "localhost is
// HTTPS-only" makes `npm run dev` on :4000 unreachable, which is a genuinely painful thing to
// undo. No `preload` either — that submits the domain to a browser-vendor list that is slow to
// come back off, and it is not ours to commit aevinite.shop to.
const HSTS =
  process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : [];

// ONLY the staff/office surfaces refuse to be put inside someone else's page. SAMEORIGIN, not
// DENY, because this app frames ITSELF constantly: /manager and /editor embed
// public/panels/editor/, the owner console embeds the panel and the menu editor
// (components/PanelFrame.tsx, components/owner/*), and printing goes through a hidden iframe.
// DENY would break every one of those.
//
// The GUEST menu is deliberately left OUT of this list. There is no embed feature today, but
// these are restaurants with their own websites, and the first one to put its menu in an
// iframe would find it blank with no clue why. Nothing on the guest menu is private, so the
// header would buy nothing while being able to break a client's site.
const FRAME_HEADERS = [{ key: "X-Frame-Options", value: "SAMEORIGIN" }];
const STAFF_PATHS = ["/aevinite/:path*", "/owner/:path*", "/manager/:path*", "/editor/:path*", "/kitchen/:path*", "/tablet/:path*", "/login", "/staff-login"];

// CONTENT SECURITY POLICY — REPORT-ONLY ON PURPOSE, and it must stay that way until the
// console is quiet on every panel.
//
// Report-Only means the browser ENFORCES NOTHING: it loads the page exactly as before and
// merely prints what a real policy would have stopped. That is the only honest way to add a
// CSP to an app this size, because a wrong policy shows up as a blank screen for a waiter
// mid-service, not as a test failure. The allow-list below is the real inventory:
//   'unsafe-inline'  → the theme boot script (app/layout.tsx), the per-restaurant accent
//                      <style> blocks, styled-jsx, and the print documents.
//   'unsafe-eval'    → Next's dev overlay and <model-viewer>'s shader compilation.
//   googleapis/gstatic/cdnjs → Inter + Playfair, Font Awesome, and model-viewer 3.4.0.
//   *.supabase.co    → every read/write plus the realtime socket and the GLB/photo buckets.
//   sentry.io        → error reporting (instrumentation*.ts).
//   blob:            → the service worker, print iframes, and camera frames.
// TO TIGHTEN LATER: watch the console on guest menu + all five panels, fix what it names,
// THEN rename the header to Content-Security-Policy. Do not flip it blind.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://ajax.googleapis.com https://cdnjs.cloudflare.com blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io https://ajax.googleapis.com",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS folder. A stray lockfile in the user's
  // home dir (C:\Users\rishi\package-lock.json) makes Turbopack otherwise
  // infer the wrong root, which has caused intermittent dev 500s / panics.
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    // littlefrenchhouse.in was here for restaurant #1's dish photos and came OUT on 2026-08-08 —
    // those photos are served from public/dishes/french-house/ now, so nothing loads from that
    // outside WordPress site any more. (Dish cards render a plain <img>, not next/image, so this
    // list never optimized them anyway; it only ever granted permission.)
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...BASE_HEADERS,
          ...HSTS,
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
        ],
      },
      ...STAFF_PATHS.map((source) => ({ source, headers: FRAME_HEADERS })),
    ];
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
