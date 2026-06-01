import type { Metadata } from "next";
import { type Viewport } from "next";
import "./globals.css";
import ModelToastHost from "@/components/ModelToastHost";
import OrderConfirmModal from "@/components/OrderConfirmModal";
import OrderTracker from "@/components/OrderTracker";
import MiniCart from "@/components/MiniCart";
import CartPanel from "@/components/CartPanel";
import ToastHost from "@/components/ToastHost";

export const metadata: Metadata = {
  title: "Little French House - 4D Menu",
  description: "Authentic French Cuisine",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5, // allow pinch-zoom (accessibility) instead of locking it
  userScalable: true,
  viewportFit: 'cover',
};

const themeBootScript = `
(function(){try{var saved=localStorage.getItem('lfh_theme');var t;if(saved==='dark'||saved==='light'){t=saved;}else{t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
`.trim();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,50&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body>
        {children}
        <ModelToastHost />
        <OrderConfirmModal />
        <OrderTracker />
        <MiniCart />
        <CartPanel />
        <ToastHost />
      </body>
    </html>
  );
}
