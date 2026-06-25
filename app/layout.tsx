// This is the "layout" — the shared frame that wraps EVERY page of the app.
// Whatever page you're on (menu, a dish, the 3D viewer), it lives inside here.
// So this is the right place to put things that should always be present:
// the page <head>, fonts, and the always-on popups/widgets at the bottom.

// Types that just describe the shape of the metadata/viewport settings below.
import type { Metadata } from "next";
import { type Viewport } from "next";
// The site-wide stylesheet (colors, fonts, spacing for the whole app).
import "./globals.css";
// These are the always-present background helpers, mounted once for the whole
// app so any page can trigger them. Each is explained where it's used below.
// GuestChrome bundles all the customer-facing always-on widgets (cart, dining
// session, toasts, 3D toast host) and renders them ONLY on guest pages — never
// on the staff panels. (Previously these were mounted globally here, which made
// the guest session logic run on /admin and auto-open tables.)
import GuestChrome from "@/components/GuestChrome";
// The admin-only floating panel switcher. It renders nothing unless this browser
// is signed in as staff, so customers never see it.
import AdminSwitcher from "@/components/AdminSwitcher";
// Tells the global guest widgets which restaurant the current /r/<slug> URL is for.
import { RestaurantProvider } from "@/lib/restaurant-context";

// The DEFAULT browser-tab title (staff/login/admin chrome). Each restaurant's guest
// menu overrides this with its own name via generateMetadata (white-label), so a
// guest sees the restaurant brand while the SaaS chrome stays "Aevidine".
export const metadata: Metadata = {
  title: "Aevidine — Restaurant OS",
  description: "Aevidine — the all-in-one platform that runs your restaurant.",
};

// How the page fits on a phone screen (zoom, width, etc.).
export const viewport: Viewport = {
  width: 'device-width',   // match the device's actual screen width
  initialScale: 1,         // start at normal (100%) zoom
  maximumScale: 5, // allow pinch-zoom (accessibility) instead of locking it
  userScalable: true,      // let guests pinch-zoom (good for accessibility)
  viewportFit: 'cover',    // draw under notches/rounded corners edge-to-edge
};

// This tiny script runs the instant the page loads, BEFORE anything is drawn.
// Its job: decide light vs dark theme and apply it immediately, so the screen
// never "flashes" the wrong color while the app boots. It honours the visitor's
// OWN saved choice first; otherwise it DEFAULTS TO LIGHT (the brand's default) —
// it deliberately does NOT follow the phone's system dark setting, so the menu
// always opens light for new visitors (owner, 2026-06-17). Falls back to light on error.
// (Leave the text inside the backticks exactly as-is — it's a script string.)
const themeBootScript = `
(function(){try{var saved=localStorage.getItem('lfh_theme');document.documentElement.setAttribute('data-theme',saved==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
`.trim();

// The main layout function. "children" is whatever page is currently showing —
// Next slots the active page into that spot. Everything around it (head, fonts,
// the always-on widgets) stays the same no matter which page you're on.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The root of the HTML document. suppressHydrationWarning silences a
    // harmless warning caused by the theme script above tweaking the page
    // before React takes over.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Run the theme-picking script above as the very first thing. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* "preconnect" = warm up the connection to Google's font servers
            early, so the fonts arrive a little faster. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Warm up the icon CDN too — the Font Awesome stylesheet below is
            render-blocking, so starting its DNS/TLS handshake early shaves
            time off the very first (cold-cache) paint. */}
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="" />
        {/* Load the two web fonts the design uses (Inter + Playfair Display). */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,50&display=swap" rel="stylesheet" />
        {/* Font Awesome — the icon set used for all the little symbols. */}
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body>
        {/* RestaurantProvider derives the active restaurant from the /r/<slug> URL
            (defaults to restaurant #1 everywhere else) so the global guest widgets
            below scope their RPCs/settings/realtime to the right restaurant. */}
        <RestaurantProvider>
          {/* The current page gets drawn right here. */}
          {children}
          {/* Guest-only always-on widgets (cart, dining session, toasts) — rendered
              only on customer pages, never on the staff panels. */}
          <GuestChrome />
          {/* Admin-only floating panel switcher (self-hides for customers). */}
          <AdminSwitcher />
        </RestaurantProvider>
      </body>
    </html>
  );
}
