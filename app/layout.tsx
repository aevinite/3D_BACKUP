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
import ModelToastHost from "@/components/ModelToastHost";
import OrderConfirmModal from "@/components/OrderConfirmModal";
import OrderTracker from "@/components/OrderTracker";
import MiniCart from "@/components/MiniCart";
import CartPanel from "@/components/CartPanel";
import ToastHost from "@/components/ToastHost";
import SessionGate from "@/components/SessionGate";
import SessionOwner from "@/components/SessionOwner";
import SessionCartSync from "@/components/SessionCartSync";
import SessionStatusWidget from "@/components/SessionStatusWidget";
// The admin-only floating panel switcher. It renders nothing unless this browser
// is in admin mode, so customers never see it.
import AdminSwitcher from "@/components/AdminSwitcher";

// The browser-tab title and the description search engines show.
export const metadata: Metadata = {
  title: "Little French House - 4D Menu",
  description: "Authentic French Cuisine",
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
// never "flashes" the wrong color while the app boots. It checks the saved
// choice in the browser's storage first, otherwise follows the phone's system
// setting, and if anything goes wrong it just falls back to light mode.
// (Leave the text inside the backticks exactly as-is — it's a script string.)
const themeBootScript = `
(function(){try{var saved=localStorage.getItem('lfh_theme');var t;if(saved==='dark'||saved==='light'){t=saved;}else{t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
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
        {/* Load the two web fonts the design uses (Inter + Playfair Display). */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,50&display=swap" rel="stylesheet" />
        {/* Font Awesome — the icon set used for all the little symbols. */}
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body>
        {/* The current page gets drawn right here. */}
        {children}
        {/* Below: always-on helpers, mounted once for the whole app. They stay
            invisible until something triggers them, then pop up over any page. */}
        {/* Toast pop-ups when a 3D model finishes loading or fails. */}
        <ModelToastHost />
        {/* The "confirm your order" popup (quantity + total) before adding. */}
        <OrderConfirmModal />
        {/* Live tracker showing the status of a placed order. */}
        <OrderTracker />
        {/* The small floating cart button/summary. */}
        <MiniCart />
        {/* The full slide-out cart panel. */}
        <CartPanel />
        {/* Generic little message toasts ("Review posted", etc.). */}
        <ToastHost />
        {/* The dining-session pieces: gate (access control), owner tracking,
            cart syncing across devices, and a small status widget. */}
        <SessionGate />
        <SessionOwner />
        <SessionCartSync />
        <SessionStatusWidget />
        {/* Admin-only floating panel switcher (self-hides for customers). */}
        <AdminSwitcher />
      </body>
    </html>
  );
}
