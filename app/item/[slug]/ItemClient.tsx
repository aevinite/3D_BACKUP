// "use client" = this runs in the visitor's browser, because the dish page is
// highly interactive (favoriting, zooming the photo, posting reviews, etc.).
"use client";

// React's tools. useMemo = remember the result of a calculation so we don't
// redo it on every redraw (used here so the "related dishes" don't reshuffle).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";              // fast page-to-page navigation
import { useRouter } from "next/navigation"; // lets us send the user to another page in code
import StarRating from "@/components/StarRating";   // the tappable star picker
import InfinityLoader from "@/components/InfinityLoader"; // the loading spinner
import { modelLoader } from "@/lib/modelLoader";     // 3D model download manager
import { getMenuItems, getMenuItem, CARD_COLUMNS, getItemReviews, submitReview as submitReviewRpc, getSettings } from "@/lib/menu"; // dishes + reviews + the review-saving RPC + per-restaurant settings (Google link)
import { getDeviceId } from "@/lib/device";          // stable per-browser id (one rating per dish per device)
import { allergenIcon, allergenLabel } from "@/lib/allergens"; // allergen icon + label
import { useFeatures, getFeatures } from "@/lib/features"; // per-restaurant feature switches
import { tget, tset } from "@/lib/tenantStorage"; // tenant-scoped storage (favorites)
import { formatPrice, getCurrency, DEFAULT_CURRENCY, type CurrencyMeta } from "@/lib/format"; // money formatting
import { gateAddToCart } from "@/lib/tableConnection"; // "must be at a table to order" gate
import { useTranslation } from "@/lib/i18n";         // translated text strings
import VegIcon from "@/components/VegIcon";           // the little veg/non-veg dot
import { useBackClose } from "@/lib/backStack";       // phone back button closes overlays first

// A TAP ON A BUTTON MUST BE THE BUTTON, RIGHT TO ITS EDGE (owner, 2026-08-17:
// *"make sure the cart button is in front of changing the screen … so that whenever you click the
// edge of Add to Cart, it will add to cart only"*).
//
// The prev/next dish strips are `position: fixed`, 36px wide, full height, `z-index: 49` and
// `pointer-events: auto` (`app/globals.css` → `.dish-nav-strip`). At 360px the Add to Cart button
// spans x 28→332 and the "next" strip starts at x 324, so the button's last 8px belonged to "go to
// the next dish": a thumb drifting to the right edge of Add to Cart navigated away instead of
// ordering. Measured point by point across the button — the last two of 76 sample points.
//
// So the button ROWS sit above the strips. 50 is above the strips (49) and below the pinned add bar
// (60), so the pinned bar still covers the row when it slides in. `position: relative` with no
// offsets changes no layout at all — it only creates the stacking context z-index needs. Inline,
// because the stylesheet belongs to another part of this sweep; if `.btn-row` ever gets this at
// source these become redundant rather than wrong.
//
// The strips still work everywhere else on the page — this only reclaims the ~44px band each button
// row occupies, which is exactly the band where a tap means "order this", not "show me another".
const BTN_ROW_ABOVE_NAV_STRIPS = { position: "relative" as const, zIndex: 50 };

// WHERE THE PINNED ADD BAR BELONGS (owner, 2026-08-17: *"you can fix the 16th one … it doesn't
// require because menu will be never open in laptop, but still you can fix it"*).
//
// The bar exists because the real button starts ~880px down the page ON A PHONE, so a diner read the
// dish and then had to scroll to buy it. On a laptop the same rule fired, and there the bar is not a
// thumb-reachable shortcut — it is a panel floating in the middle of the page ON TOP of the "About
// this dish" text (measured at 1280×800: the bar sat at y=754, covering two lines of the
// description). A guest menu is a phone-and-tablet thing, so the bar is now one too.
//
// 1024px keeps every phone and every tablet, in both orientations, and drops it on a laptop. It is a
// live matchMedia, not a one-off read, so rotating a tablet or dragging a window gets the right
// answer. The stylesheet already hides the bar under `max-height: 420px` (a phone in landscape has
// no height to spare) — this is the width half of the same idea.
const PINNED_BAR_MAX_WIDTH = 1024;

// HOW LONG THIS SCREEN WILL WAIT FOR ITS DISH (sweep #7 T2, 2026-08-22 — item 6).
//
// 8 seconds, the same patience the floor's own reads use. Long enough for a genuinely slow first
// load on restaurant wi-fi; short enough that a diner with no signal is not left staring at a
// spinner. See the note on `readTimedOut`: past this the screen says so, honestly, with a way out
// — and if the reply lands later it still wins.
const DISH_READ_DEADLINE_MS = 8000;

// THE TWO "SOMETHING WENT WRONG" CARDS HAVE TO BE CENTRED BY INLINE STYLE (sweep #7 T2 — item 7).
//
// Both cards carry `flex flex-col items-center justify-center min-h-screen p-4`, and NONE of it
// applies. Measured on the running page: `#detail-page` computes to `padding: 70px 0 0`,
// `align-items: normal`, `justify-content: normal`, and the heading's left edge is at x=0 — hard
// against the side of a 360px phone, with the Try again button running edge to edge.
//
// The cause is the cascade, not the markup. `#detail-page` is an ID selector in app/globals.css
// and it sets `padding-top` and `flex-direction` as plain author rules; Tailwind 4 puts its
// utilities in a layer that those rules outrank. So the utility classes are inert here and have
// been since the "Dish not found" card was written — this was found by building a sibling of it.
//
// An inline style outranks any stylesheet rule short of `!important`, so this cannot lose. Kept as
// one shared object precisely so the two cards can never drift apart. `paddingTop` is left to the
// stylesheet's 70px, which is the room the fixed header needs.
const ERROR_CARD_LAYOUT: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  textAlign: "center", gap: 12, minHeight: "60vh", paddingLeft: 24, paddingRight: 24,
};

// This describes the "shape" of one dish — every field a dish object can have.
// It's a TypeScript guide so the editor can catch typos; it doesn't run.

interface FoodItem {
  id: string;
  slug: string;
  title: string;
  price: string;
  image: string;
  category: string;
  veg: boolean;
  is4d: boolean;
  modelFolder?: string;
  modelSmallUrl?: string;
  modelOptimizedUrl?: string;
  description: string;
  // Optional to match lib/menu.ts's MenuItem (T9 improvement 15, 2026-08-06): the detail-only fields
  // are ABSENT on a card-shaped read and present on a full-row read, which is what this page does.
  longDescription?: string;
  rating: string;
  reviewCount?: number;   // real-review count from the aggregate (audit fix 2026-07-06)
  time: string;
  nutrition?: {
    calories: string;
    protein: string;
    carbs: string;
    sugar?: string;
  };
  ingredients?: {
    emoji: string;
    name: string;
  }[];
  reviews?: {
    name: string;
    rating: number;
    text: string;
  }[];
  relatedSlugs?: string[];
  allergens: string[];
  tags: string[];  // filter slugs this dish matches; "sold-out" means it can't be ordered
  options?: { name: string; type: "single" | "multi"; choices: { label: string; price: number }[] }[];
}

// The dish detail component. It receives `slug` (which dish to show) and
// `fromCat` (which category the guest came from, for prev/next arrows).
export default function ItemClient({ slug, fromCat, restaurantId, restaurantSlug, initialItem, initialFeatures }: { slug: string; fromCat?: string; restaurantId?: string; restaurantSlug?: string; initialItem?: FoodItem | null; initialFeatures?: Record<string, boolean> | null }) {
  const t = useTranslation();  // translated text for the current language
  // Seeded from the switches the SERVER already read, so the first paint — and, on a reload with no
  // signal, the ONLY paint — obeys the real ones. Without this the server built the page with
  // FEATURE_DEFAULTS and a ratings-off restaurant had a five-star row in its own HTML. See the note
  // on `seed` in lib/features.ts.
  const features = useFeatures(restaurantId, initialFeatures);
  // Links stay inside this restaurant when opened from /r/<slug>/...; on the default
  // single-restaurant page there's no slug, so links stay global — unchanged for #1.
  const itemBase = restaurantSlug ? `/r/${restaurantSlug}` : "";
  // All the little pieces of memory this page keeps (current value + setter):
  const [allItems, setAllItems] = useState<FoodItem[]>([]);  // every dish (for related/next/prev)
  // THE DISH THE SERVER ALREADY HELD (owner's item 9, 2026-09-01).
  //
  // Both dish routes read this dish on the server to decide whether the page exists at all
  // (`if (!(await getMenuItem(...))) notFound()`), and then threw it away — so the phone asked for
  // exactly the same row a second time, and a diner watched "Plating your dish" while the answer
  // was already in the HTML. Handing it down instead means the dish is ON SCREEN in the first
  // paint, one database read disappears from the hottest guest page in the product, and a page
  // restored from the device with no signal shows the dish instead of a spinner.
  //
  // `initialItem` is only ever the SERVER's answer for THIS slug, so starting state from it cannot
  // mismatch what the server rendered. The client still re-reads below — that is what keeps a price
  // change or a sold-out flag honest on a page left open — it simply no longer starts from nothing.
  const [item, setItem] = useState<FoodItem | null>(initialItem ?? null);
  // …and therefore nothing is "loading" when the server already answered. This is the line that
  // removes the spinner: it was unconditionally true.
  const [loading, setLoading] = useState(!initialItem);
  // THE DISH READ DID NOT COME BACK (sweep #7 T2, 2026-08-22 — item 6).
  //
  // Measured with the network switched off after the page had been visited once: this screen sat
  // on "PLATING YOUR DISH" at 2 s, 5 s, 10 s, 20 s and 35 s — a spinner with no dish, no honest
  // word and no way out. The guest MENU beside it renders fine offline, which is what makes the
  // difference so stark to a diner: the list works, the dish is a dead screen.
  //
  // The reason it hangs is not this file's to fix. The menu's data comes through
  // `/api/r/<restaurant>/menu-data`, which `public/sw.js` → DATA_PATHS serves from the device;
  // this page's reads go STRAIGHT to Supabase, and every DATA_PATHS pattern is an `/api/…` one, so
  // the service worker never sees them and the request simply never settles. That is a handoff
  // (`public/sw.js` and `lib/menu.ts` belong to other territories) — recorded in the findings.
  //
  // What IS this file's to fix: a screen must never spin forever. Every read here gets a deadline,
  // and when it passes the guest gets an honest card with a way out and a Try again. If the real
  // reply lands afterwards it still wins, so the page heals itself the moment the signal returns.
  const [readTimedOut, setReadTimedOut] = useState(false);
  // Bumped by Try again, and a dependency of the fetch, so retrying really re-reads.
  const [retryNonce, setRetryNonce] = useState(0);
  const [favorited, setFavorited] = useState(false);         // is this dish hearted?
  const [showFavHint, setShowFavHint] = useState(false); // one-time "tap to save" coachmark
  const [descExpanded, setDescExpanded] = useState(false);   // is the description expanded?
  // When the server handed the dish down there is no fetch to wait for, so the photo must not sit
  // invisible waiting for a fade-in that the fetch used to trigger.
  const [imageLoaded, setImageLoaded] = useState(!!initialItem);
  const [selectedRating, setSelectedRating] = useState(0);   // stars chosen in the review form
  const [reviewName, setReviewName] = useState("");          // reviewer's typed name
  const [reviewText, setReviewText] = useState("");          // reviewer's typed comment
  const [localReviews, setLocalReviews] = useState<{name: string; rating: number; text: string; deviceId?: string}[]>([]); // reviews shown (incl. ones just added)
  const [reviewTab, setReviewTab] = useState<"rate" | "reviews">("reviews"); // which review tab is open
  const reviewSubmittingRef = useRef(false); // blocks a double-tap from firing two review saves (audit)
  // After a HIGH rating (>= 4★) we invite the guest to share it on Google — but ONLY if
  // this restaurant configured a Google review link. A low rating stays private (no
  // nudge). null = prompt hidden. (owner 2026-07-09 "do push to google review")
  const [googleReviewUrl, setGoogleReviewUrl] = useState<string | null>(null);
  // The admin-chosen Google-review MODE + destination link for THIS restaurant (mig 187),
  // loaded once on mount. Mode drives whether/how the Google invite shows relative to the
  // normal in-menu reviews: off · google (CTA only) · google_plus_normal (both) ·
  // google_after_normal (the post-rating nudge above). Default off. (owner 2026-07-24)
  const [googleMode, setGoogleMode] = useState<"off" | "google" | "google_plus_normal" | "google_after_normal">("off");
  const [googleCfgUrl, setGoogleCfgUrl] = useState<string | null>(null);
  const [imgZoom, setImgZoom] = useState(false);             // is the full-screen photo open?
  const [lbScale, setLbScale] = useState(1);                 // zoom level in the lightbox (1 = normal)
  const [lbPos, setLbPos] = useState({ x: 0, y: 0 });        // pan offset while zoomed in
  // Phone back button closes the full-screen photo first, instead of leaving the
  // dish page (every overlay must register — audit fix 2026-07-06).
  useBackClose("item-zoom", imgZoom, () => { setImgZoom(false); setLbScale(1); setLbPos({ x: 0, y: 0 }); });
  // useRef holds a value across redraws WITHOUT causing a redraw — handy for
  // tracking finger gestures mid-pinch.
  const pinchRef = useRef<number | null>(null);              // distance between two fingers
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null); // last finger position
  const [theme, setTheme] = useState<'dark' | 'light'>('light'); // dark or light mode
  // START FROM THE REAL DEFAULT, NOT FROM NOTHING (owner's item 9, 2026-09-01).
  //
  // This was `null`, and every price on the page falls back to `$${price}` while it is. That was
  // invisible before, because the spinner covered the whole page until the client fetch landed —
  // but now the server renders the dish in the first paint, and the first thing a diner saw was
  // **$550 on a rupee menu**. Measured on the offline reload, where React never boots at all, so
  // the `$` was not a flicker: it was the price, permanently.
  //
  // `getCurrency()` is SSR-safe by design — it returns DEFAULT_CURRENCY (INR) whenever the device
  // cannot answer, which includes the server — so this is exactly what the server would compute,
  // and hydration matches. A guest who picked a different currency still gets it applied by the
  // effect below, one frame later, the same as before; they just start from ₹ instead of $.
  //
  // The `currency ? … : \`$…\`` guards downstream are left in place deliberately: they are now
  // unreachable, and they are the thing that stops this regressing to a bare crash if a later
  // change makes this nullable again.
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(DEFAULT_CURRENCY); // currency for prices
  const router = useRouter();  // used below to navigate to the 3D view / menu

  // First-time-only nudge so guests learn the top-right heart saves a dish to
  // Favorites. Shows briefly, then never again (localStorage flag).
  // Runs once when the page appears.
  useEffect(() => {
    let seen = true;
    // Have we shown this tip before? (stored in the browser's notebook)
    try { seen = !!localStorage.getItem("lfh-fav-hint-seen"); } catch {}
    if (seen) return;  // already shown — don't show again
    // Pop the hint after 0.7s...
    const show = setTimeout(() => setShowFavHint(true), 700);
    // ...then hide it after 5.5s and remember we've shown it.
    const hide = setTimeout(() => {
      setShowFavHint(false);
      try { localStorage.setItem("lfh-fav-hint-seen", "1"); } catch {}
    }, 5500);
    // Cleanup: cancel both timers if we leave before they fire.
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, []);

  // Keep the displayed currency in sync. Reads it once, then listens for a
  // "currency changed" signal (e.g. the guest switched currency elsewhere).
  useEffect(() => {
    setCurrencyState(getCurrency());
    const onCur = () => setCurrencyState(getCurrency());
    window.addEventListener("lfh:currency-changed", onCur);
    return () => window.removeEventListener("lfh:currency-changed", onCur);  // stop listening on leave
  }, []);

  // Watch for dark/light theme changes so the ingredient-tag colors adapt.
  useEffect(() => {
    if (typeof document === "undefined") return;  // safety: skip if no page (server)
    const root = document.documentElement;  // the <html> element holds the theme
    // Read the current theme into our state.
    const read = () => setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    // A MutationObserver watches the <html> tag and re-reads if the theme attribute changes.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();  // stop watching on leave
  }, []);
  
  // A lookup table of colors for ingredient tags, keyed by emoji. Each emoji
  // has two color choices so repeated emojis don't look identical; some include
  // separate light-mode colors so they stay readable on a light background.
  const colorMap = {
    '🧀': [
      { bg: 'rgba(255, 215, 0, 0.15)', border: '#FFD700', glow: 'rgba(255, 215, 0, 0.4)' },
      { bg: 'rgba(255, 223, 128, 0.15)', border: '#FFDF80', glow: 'rgba(255, 223, 128, 0.4)' }
    ],
    '🥬': [
      { bg: 'rgba(34, 197, 94, 0.15)', border: '#22C55E', glow: 'rgba(34, 197, 94, 0.4)' },
      { bg: 'rgba(74, 222, 128, 0.15)', border: '#4ADE80', glow: 'rgba(74, 222, 128, 0.4)' }
    ],
    '🍅': [
      { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', glow: 'rgba(239, 68, 68, 0.4)' },
      { bg: 'rgba(248, 113, 113, 0.15)', border: '#F87171', glow: 'rgba(248, 113, 113, 0.4)' }
    ],
    '🧂': [
      { bg: 'rgba(148, 163, 184, 0.15)', border: '#94A3B8', glow: 'rgba(148, 163, 184, 0.4)' },
      { bg: 'rgba(203, 213, 225, 0.15)', border: '#CBD5E1', glow: 'rgba(203, 213, 225, 0.4)' }
    ],
    '🌿': [
      { bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981', glow: 'rgba(16, 185, 129, 0.4)' },
      { bg: 'rgba(52, 211, 153, 0.15)', border: '#34D399', glow: 'rgba(52, 211, 153, 0.4)' }
    ],
    '🥖': [
      { bg: 'rgba(217, 119, 6, 0.15)', border: '#D97706', glow: 'rgba(217, 119, 6, 0.4)' },
      { bg: 'rgba(251, 146, 60, 0.15)', border: '#FB923C', glow: 'rgba(251, 146, 60, 0.4)' }
    ],
    '🫒': [
      { bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981', glow: 'rgba(16, 185, 129, 0.4)' },
      { bg: 'rgba(52, 211, 153, 0.15)', border: '#34D399', glow: 'rgba(52, 211, 153, 0.4)' }
    ],
    '🍞': [
      { bg: 'rgba(245, 158, 11, 0.15)', border: '#F59E0B', glow: 'rgba(245, 158, 11, 0.4)' },
      { bg: 'rgba(251, 191, 36, 0.15)', border: '#FBBF24', glow: 'rgba(251, 191, 36, 0.4)' }
    ],
    '🐟': [
      { bg: 'rgba(59, 130, 246, 0.15)', border: '#3B82F6', glow: 'rgba(59, 130, 246, 0.4)' },
      { bg: 'rgba(96, 165, 250, 0.15)', border: '#60A5FA', glow: 'rgba(96, 165, 250, 0.4)' }
    ],
    '🍣': [
      { bg: 'rgba(236, 72, 153, 0.15)', border: '#EC4899', glow: 'rgba(236, 72, 153, 0.4)' },
      { bg: 'rgba(244, 114, 182, 0.15)', border: '#F472B6', glow: 'rgba(244, 114, 182, 0.4)' }
    ],
    '🍚': [
      { bg: 'rgba(250, 250, 250, 0.15)', border: '#F3F4F6', glow: 'rgba(250, 250, 250, 0.4)', lightBorder: '#374151', lightText: '#111827' },
      { bg: 'rgba(249, 250, 251, 0.15)', border: '#E5E7EB', glow: 'rgba(249, 250, 251, 0.4)', lightBorder: '#4B5563', lightText: '#1F2937' }
    ],
    '🌱': [
      { bg: 'rgba(34, 197, 94, 0.15)', border: '#22C55E', glow: 'rgba(34, 197, 94, 0.4)' },
      { bg: 'rgba(74, 222, 128, 0.15)', border: '#4ADE80', glow: 'rgba(74, 222, 128, 0.4)' }
    ],
    '🥢': [
      { bg: 'rgba(139, 90, 43, 0.15)', border: '#8B5A2B', glow: 'rgba(139, 90, 43, 0.4)' },
      { bg: 'rgba(168, 85, 247, 0.15)', border: '#A855F7', glow: 'rgba(168, 85, 247, 0.4)' }
    ],
    '🧈': [
      { bg: 'rgba(250, 204, 21, 0.15)', border: '#FACC15', glow: 'rgba(250, 204, 21, 0.4)' },
      { bg: 'rgba(253, 224, 71, 0.15)', border: '#FDE047', glow: 'rgba(253, 224, 71, 0.4)' }
    ],
    '🥓': [
      { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', glow: 'rgba(239, 68, 68, 0.4)' },
      { bg: 'rgba(248, 113, 113, 0.15)', border: '#F87171', glow: 'rgba(248, 113, 113, 0.4)' }
    ],
    '🥚': [
      { bg: 'rgba(250, 250, 250, 0.15)', border: '#F3F4F6', glow: 'rgba(250, 250, 250, 0.4)', lightBorder: '#374151', lightText: '#111827' },
      { bg: 'rgba(249, 250, 251, 0.15)', border: '#E5E7EB', glow: 'rgba(249, 250, 251, 0.4)', lightBorder: '#4B5563', lightText: '#1F2937' }
    ],
    '🌶️': [
      { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', glow: 'rgba(239, 68, 68, 0.4)' },
      { bg: 'rgba(248, 113, 113, 0.15)', border: '#F87171', glow: 'rgba(248, 113, 113, 0.4)' }
    ],
    '🍝': [
      { bg: 'rgba(245, 158, 11, 0.15)', border: '#F59E0B', glow: 'rgba(245, 158, 11, 0.4)' },
      { bg: 'rgba(251, 191, 36, 0.15)', border: '#FBBF24', glow: 'rgba(251, 191, 36, 0.4)' }
    ],
    '🧄': [
      { bg: 'rgba(250, 250, 250, 0.15)', border: '#F3F4F6', glow: 'rgba(250, 250, 250, 0.4)', lightBorder: '#374151', lightText: '#111827' },
      { bg: 'rgba(249, 250, 251, 0.15)', border: '#E5E7EB', glow: 'rgba(249, 250, 251, 0.4)', lightBorder: '#4B5563', lightText: '#1F2937' }
    ],
    '🥩': [
      { bg: 'rgba(185, 28, 28, 0.15)', border: '#B91C1C', glow: 'rgba(185, 28, 28, 0.4)' },
      { bg: 'rgba(220, 38, 38, 0.15)', border: '#DC2626', glow: 'rgba(220, 38, 38, 0.4)' }
    ],
    '🧅': [
      { bg: 'rgba(250, 250, 250, 0.15)', border: '#F3F4F6', glow: 'rgba(250, 250, 250, 0.4)', lightBorder: '#374151', lightText: '#111827' },
      { bg: 'rgba(249, 250, 251, 0.15)', border: '#E5E7EB', glow: 'rgba(249, 250, 251, 0.4)', lightBorder: '#4B5563', lightText: '#1F2937' }
    ],
    '🌮': [
      { bg: 'rgba(245, 158, 11, 0.15)', border: '#F59E0B', glow: 'rgba(245, 158, 11, 0.4)' },
      { bg: 'rgba(251, 191, 36, 0.15)', border: '#FBBF24', glow: 'rgba(251, 191, 36, 0.4)' }
    ],
    '🍋': [
      { bg: 'rgba(250, 204, 21, 0.15)', border: '#FACC15', glow: 'rgba(250, 204, 21, 0.4)' },
      { bg: 'rgba(253, 224, 71, 0.15)', border: '#FDE047', glow: 'rgba(253, 224, 71, 0.4)' }
    ]
  };
  
  // Counts how many times we've used each emoji, so we can alternate between
  // its two color choices as the ingredient tags are drawn.
  const emojiIndexMap: Record<string, number> = {};

  // Open the 3D viewer for this dish (only if it actually has a 3D model).
  // The "?from=" tells the viewer which dish to link back to.
  const goToViewer = () => {
    if (item?.is4d && item?.modelFolder) {
      // Carry the restaurant slug so the (tenant-less) /view route can build a
      // back link into THIS restaurant and price/add against it — without it the
      // viewer defaulted to restaurant #1, showing the wrong dish/price the moment
      // any non-#1 restaurant enabled a 3D dish (audit fix 2026-07-06).
      const r = restaurantSlug ? `&r=${encodeURIComponent(restaurantSlug)}` : "";
      // Carry the browsing category too, so the viewer's Back link returns to the
      // SAME list the guest came from (audit fix bug #17).
      const c = fromCat ? `&cat=${encodeURIComponent(fromCat)}` : "";
      router.push(`/view/${item.modelFolder}?from=${encodeURIComponent(item.slug)}${r}${c}`);
    }
  };

  // Go back to the menu.
  const goToMenu = () => router.push(`${itemBase}/menu`);

  // Fetch the dishes and find the one matching this page's slug.
  // Re-runs if the slug changes (e.g. navigating to a different dish).
  useEffect(() => {
    // CONCURRENCY GUARD: navigating dish→dish fast re-fires this fetch before the
    // previous one resolves; without this flag a slow earlier response could land
    // last and show the WRONG dish (older response clobbering the newer slug).
    let cancelled = false;
    // EGRESS (audit fix 2026-07-08): fetch the CURRENT dish FULL (getMenuItem = one row
    // with the heavy detail fields) and the REST LIGHT (CARD_COLUMNS — only what the
    // "You might like" cards + prev/next nav need). Before, this pulled the WHOLE menu
    // with every heavy column (long_description, nutrition, ingredients, reviews…) on
    // every single dish open — the "SELECT * on a hot path" the egress rules warn about.
    // THE DEADLINE. See the note on `readTimedOut`. 8 s is the same patience the floor's own reads
    // use — long enough for a slow first load on restaurant wi-fi, short enough that a diner is not
    // left staring. `landed` is a plain local, not state: it must be readable from the timer's
    // closure without waiting for a render.
    let landed = false;
    const deadline = setTimeout(() => {
      if (cancelled || landed) return;
      setReadTimedOut(true);
      setLoading(false);   // stop the spinner and show the honest card instead
    }, DISH_READ_DEADLINE_MS);
    Promise.all([
      // THE DISH IS ONLY RE-READ WHEN WE DID NOT ALREADY GET IT (owner's item 9).
      //
      // On a first load the server has just read this exact row to decide the 404 and handed it
      // down, milliseconds ago — asking again is a duplicate read on the hottest guest page in the
      // product, and it bought nothing: this page has no poll and no realtime refresh, so the
      // value it replaced the server's with was identical.
      //
      // `retryNonce > 0` is the exception that matters: Try again, and item 8's territory, MUST
      // reach the database. Without this test the button would "succeed" instantly by handing back
      // the same stale object and the diner would be no better off.
      initialItem && retryNonce === 0
        ? Promise.resolve(initialItem)
        : getMenuItem(slug, restaurantId).catch(() => null),    // this dish, full detail
      getMenuItems(restaurantId, CARD_COLUMNS).catch(() => []), // the rest, light (related/nav)
    ])
      .then(([dish, items]) => {
        if (cancelled) return; // a newer slug's fetch superseded this one
        // A reply that arrives AFTER the deadline still wins — the screen heals itself rather than
        // making the guest tap Try again for something that has already arrived.
        landed = true;
        clearTimeout(deadline);
        setReadTimedOut(false);
        setAllItems(items);                 // light list for related/nav
        // KEEP THE SERVER'S DISH IF THE CLIENT RE-READ COMES BACK EMPTY. The re-read is a refresh,
        // not the source of truth for whether the dish exists — the server already answered that,
        // and answered it with a 404 when it did not. A transient empty reply must not blank a
        // page the server rendered perfectly well.
        setItem(dish || initialItem || null);
        // (Reviews load in their own effect below — see why there.)
        setLoading(false);                  // done loading
        setTimeout(() => { if (!cancelled) setImageLoaded(true); }, 50); // trigger the photo fade-in

        // Load favorite state
        try {
          const savedFavorites = tget('lfh-favorites');
          if (savedFavorites) {
            const favorites = JSON.parse(savedFavorites);  // text back into a list
            setFavorited(favorites.includes(dish?.id));    // is this dish in it?
          }
        } catch (e) {
          console.error('Failed to load favorites', e);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // If the fetch failed, log it and stop the spinner.
        landed = true;
        clearTimeout(deadline);
        console.error(err);
        setReadTimedOut(true);   // an outright failure is as honest a "couldn't reach it" as a stall
        setLoading(false);
      });
    return () => { cancelled = true; clearTimeout(deadline); };
    // `restaurantId` belongs in here as well as `slug` (sweep #7 T2, 2026-08-22 — item 3).
    //
    // Both reads above are SCOPED BY IT — getMenuItem(slug, restaurantId) and
    // getMenuItems(restaurantId, …) — but it was not a dependency, so the fetch only re-ran when
    // the dish slug changed. `/r/<a>/item/x` → `/r/<b>/item/x` is the same route pattern with the
    // same slug, so React reconciles ItemClient in place rather than remounting it: the component
    // would keep restaurant A's dish, price and menu list under restaurant B's address. The two
    // effects below already key on `restaurantId` (reviews, and the Google-review settings), so
    // this one was the odd one out.
    //
    // No path inside the product reaches it today — nothing links from one restaurant's dish to
    // another's, and a shared link opens a fresh document — which is why it has never been seen.
    // It is still the wrong dependency list, and `restaurantId` is a stable string prop, so adding
    // it costs no extra fetch on any journey that exists.
  }, [slug, restaurantId, retryNonce]);

  // Real reviews, in their OWN effect keyed on the switch.
  //
  // They used to load inside the dish fetch above, which depends only on [slug] — so it ran
  // with the DEFAULT feature map (reviews: true) before this restaurant's real switches had
  // landed, and fetched up to 20 review rows on every dish open for a restaurant that had
  // reviews switched OFF. Keying the fetch on features.reviews means it happens once the
  // truth is known, and not at all when the answer is "off" (guest sweep 2026-08-04).
  //
  // …AND ON THE SAME CONDITION THAT DECIDES WHETHER THEY CAN BE SEEN (sweep #7 T2 — item 5).
  //
  // The fetch was keyed on `features.reviews` alone, but NOTHING on this page draws a review
  // unless BOTH switches are on: the list, the star row and the tab count are all behind
  // `features.ratings && features.reviews` (see `normalOn` below, and the star row's own
  // `!features.ratings` test). So a restaurant with reviews ON and ratings OFF paid for up to
  // twenty review rows on EVERY dish open and could not render one of them.
  //
  // Not hypothetical: measured on French House, which is in exactly that state today — one
  // `reviews` read per dish open, `select=name,stars,comment,device_id,created_at ... limit=20`,
  // for a section that returns null. That is the egress rule's own case: the cheapest read is
  // the one you do not make.
  //
  // `showNormal` below adds one more condition (Google-ONLY mode also replaces the list), but it
  // is derived during render from state this effect would have to duplicate. The two switches are
  // the part worth gating on: they are per-restaurant and permanent, where the Google mode is one
  // restaurant's choice among four and still shows the list in two of them.
  //
  // …AND IT ASKS THE RESOLVED SWITCHES, NOT THE DEFAULTS (owner's item 9 caused this, 2026-09-01).
  //
  // `useFeatures()` hands back FEATURE_DEFAULTS on the first render and the restaurant's real
  // switches one tick later. That used to be harmless here, because `item` was null until the
  // client fetch landed and by then the truth had arrived. Item 9 changed exactly that: the server
  // now hands the dish down, so `item` is set on the very first render — and this effect fired
  // against the defaults, where `ratings` and `reviews` are both true. Measured immediately after
  // item 9 went in: French House, which has ratings OFF, was reading its review rows again on
  // every dish open. That is the fault item 5 had just fixed, walked back in by an unrelated change
  // two commits later.
  //
  // `getFeatures()` is the async, per-restaurant cached reader the 3D screen already uses for the
  // same reason. Asking it costs nothing after the first call and it cannot answer with a default
  // it has not verified.
  const reviewsCanBeSeen = !!features.reviews && !!features.ratings;
  useEffect(() => {
    if (!item) { setLocalReviews([]); return; }
    let cancelled = false;
    (async () => {
      const real = await getFeatures(restaurantId).catch(() => null);
      if (cancelled) return;
      // No answer at all → behave as if it is off. A read we cannot justify is one we do not make.
      if (!real || !real.reviews || !real.ratings) { setLocalReviews([]); return; }
      const r = await getItemReviews(item.slug, restaurantId).catch(() => null);
      if (!cancelled && r) setLocalReviews(r);
    })();
    return () => { cancelled = true; };
    // `reviewsCanBeSeen` stays in the list so a live toggle still re-runs this — it is the hook's
    // own value, which updates when a realtime breadcrumb refreshes the switches.
  }, [item, restaurantId, reviewsCanBeSeen]);

  // Load THIS restaurant's Google-review mode + link once (getSettings is cached per
  // restaurant, so this is effectively free). Drives the persistent Google call-to-action
  // and, for the "google_after_normal" mode, the post-rating nudge. (mig 187)
  useEffect(() => {
    let cancelled = false;
    getSettings(restaurantId)
      .then((s) => { if (!cancelled) { setGoogleMode(s.googleReviewMode); setGoogleCfgUrl(s.googleReviewUrl); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [restaurantId]);

  // Background preload: this dish's model first, then the next & previous dishes
  // in the category (their GLBs + images), so moving between dishes — and opening
  // the 3D view — feels instant. Downloads run through the singleton loader.
  // Re-runs when the dish, the full list, or the source category changes.
  useEffect(() => {
    if (!item) return;  // nothing to preload until we know the dish
    const urls: string[] = [];  // the model files we'll queue for download
    // Add a dish's 3D model files to the download list. Skips ALL model bytes when
    // this restaurant has 3D switched OFF (the button is hidden anyway — no point
    // fetching ~9MB GLBs). Only the CURRENT dish warms the heavy optimized tier;
    // neighbours get just the small (~2MB) file, so opening a dish doesn't quietly
    // pull ~33MB on mobile data (audit fix 2026-07-06).
    const queue4d = (it?: FoodItem | null, heavy = false) => {
      if (!features.model3d) return; // 3D off for this restaurant → download nothing
      if (!it?.is4d) return;  // skip dishes without a 3D model
      if (it.modelSmallUrl) urls.push(it.modelSmallUrl);
      if (heavy && it.modelOptimizedUrl) urls.push(it.modelOptimizedUrl);
    };
    // Quietly start loading a dish's PHOTO in the background.
    const preloadImg = (it?: FoodItem | null) => {
      if (it?.image) {
        const im = new window.Image();  // an off-screen image just to warm the cache
        im.src = it.image;
      }
    };
    queue4d(item, true); // current dish first — warm BOTH tiers so 3D opens instantly
    if (allItems.length) {
      // Figure out the dish's "neighbors" in the same category, so we can
      // preheat whatever the guest is most likely to open next.
      const navCat = fromCat || item.category;
      const sibs = navCat === "all" ? allItems : allItems.filter((it) => it.category === navCat);
      const i = sibs.findIndex((it) => it.slug === item.slug);  // where we are in that list
      if (i >= 0) {
        const next = i < sibs.length - 1 ? sibs[i + 1] : null;  // dish after this one
        const prev = i > 0 ? sibs[i - 1] : null;                // dish before this one
        queue4d(next); // next is the most likely move
        queue4d(prev);
        preloadImg(next);
        preloadImg(prev);
      }
    }
    // Hand the collected model URLs to the loader to download first.
    if (urls.length) modelLoader.prioritize(urls);
  }, [item, allItems, fromCat, features.model3d]);

  // Builds the "You might like" row: a mix of same-category and other dishes,
  // picked by rating, then shuffled so they're interleaved rather than grouped.
  const getRelatedItems = (): FoodItem[] => {
    if (!item || !allItems.length) return [];  // nothing to suggest yet
    const TOTAL = 10;       // how many suggestions to show
    const SAME_TARGET = 5; // 5 same-category + 5 related — then shuffle so they interleave
    const rating = (it: FoodItem) => parseFloat(it.rating) || 0;  // rating as a number
    const byRating = (a: FoodItem, b: FoodItem) => rating(b) - rating(a);  // sort high→low

    // Every dish except this one — and NEVER suggest a sold-out dish (you can't
    // order it, so recommending it is a dead end / the "you might also like a
    // dish you can't have" bug).
    const others = allItems.filter((it) => it.slug !== item.slug && !(it.tags || []).includes("sold-out"));
    const same = others.filter((it) => it.category === item.category).sort(byRating);  // same category
    const diff = others.filter((it) => it.category !== item.category).sort(byRating);  // other categories

    const samePick = same.slice(0, SAME_TARGET);            // top few from same category
    const diffPick = diff.slice(0, TOTAL - samePick.length); // fill the rest from others
    let picked = [...samePick, ...diffPick];
    // If we still don't have enough, top up with more from the same category.
    if (picked.length < TOTAL) picked = picked.concat(same.slice(samePick.length));
    picked = picked.slice(0, TOTAL);  // never more than TOTAL

    // Shuffle so same- and other-category dishes are interleaved, not grouped.
    // (This is the Fisher–Yates shuffle: swap each item with a random earlier one.)
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];  // swap the two
    }
    return picked;
  };

  // Heart / un-heart this dish. Saves the updated list to the browser and
  // tells the menu to refresh its Favorites tab.
  const toggleFavorite = () => {
    if (!item) return;
    // Any tap on the heart means the hint did its job — retire it for good.
    if (showFavHint) setShowFavHint(false);
    try { localStorage.setItem("lfh-fav-hint-seen", "1"); } catch {}
    try {
      let favorites: string[] = [];
      const savedFavorites = tget('lfh-favorites');
      if (savedFavorites) {
        favorites = JSON.parse(savedFavorites);  // read the current list
      }
      if (favorited) {
        // It was hearted — remove it.
        favorites = favorites.filter(id => id !== item.id);
      } else {
        // It wasn't — add it.
        favorites.push(item.id);
      }
      tset('lfh-favorites', JSON.stringify(favorites));  // save back
      setFavorited(!favorited);  // flip the heart on screen
      // Tell the menu's Favorites tab to refresh (same-tab; storage event covers others).
      window.dispatchEvent(new Event("lfh:favorites-updated"));
    } catch (e) {
      console.error('Failed to update favorites', e);
    }
  };

  // "Add to Cart" — instead of adding directly, it opens the shared confirm
  // popup (quantity + total) by broadcasting an event the modal listens for.
  // ── A PINNED "Add to Cart" WHILE THE REAL ONE IS OFF SCREEN (owner, 2026-08-13) ──────────────
  // Measured on his phone: the real button starts ~880px down this page, so every guest read the
  // dish and then had to scroll to buy it. A pinned copy fixes that — but pinned FOREVER is not
  // what he asked for: "it will stuck if you scroll up, when you come to page where it exist with
  // smooth way it will unpin and merge like actual button, not pin". So the bar is visible ONLY
  // while the real row is out of view, and it fades/slides away as the real row arrives, which
  // reads as the two becoming one. IntersectionObserver, so there is no scroll handler at all.
  const btnRowRef = useRef<HTMLDivElement>(null);
  const [realBtnOffScreen, setRealBtnOffScreen] = useState(false);
  useEffect(() => {
    const el = btnRowRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => setRealBtnOffScreen(!e.isIntersecting),
      // A margin at the bottom so the pinned bar leaves BEFORE the real button is under it —
      // otherwise the two overlap for a moment and it looks like two Add buttons.
      { root: null, rootMargin: "0px 0px -96px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [item?.slug]);

  // Is this a screen the pinned bar belongs on? See PINNED_BAR_MAX_WIDTH above. Starts `true` so a
  // phone never flashes without it on first paint; a laptop drops it on the first effect tick.
  const [barFitsScreen, setBarFitsScreen] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(max-width: ${PINNED_BAR_MAX_WIDTH}px)`);
    const read = () => setBarFitsScreen(mq.matches);
    read();
    // addEventListener on a MediaQueryList is the modern form; older WebKit only has addListener,
    // and this menu runs on old phones, so support both rather than losing the listener silently.
    if (mq.addEventListener) { mq.addEventListener("change", read); return () => mq.removeEventListener("change", read); }
    mq.addListener(read);
    return () => mq.removeListener(read);
  }, []);

  const addToCart = () => {
    // No item, or it's sold out -> do nothing (the button is disabled too; this is
    // the belt-and-braces guard so a sold-out dish can never reach the cart).
    if (!item || (item.tags || []).includes("sold-out")) return;
    // Same table gate as the menu cards: if dining-sessions are on and the guest
    // isn't connected, send them to join first; the popup opens once they're in.
    gateAddToCart(() => {
      window.dispatchEvent(
        new CustomEvent("lfh:open-order-confirm", {
          detail: {
            item: {
              id: item.id,
              title: item.title,
              price: item.price,
              image: item.image,
            },
            options: item.options,
            allergens: item.allergens,
          },
        })
      );
    });
  };

  // Post a review. Saves it to the DATABASE (one live rating per device per
  // dish — re-rating updates your previous one) and shows it immediately.
  // The name is optional now; stars + a note are required.
  const submitReview = async () => {
    if (!reviewText.trim() || selectedRating === 0) {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Almost there", subtitle: "add a note & star rating", kicker: "review", variant: "error" } }));
      return;
    }
    if (!item) return; // no dish loaded -> nothing to review
    if (reviewSubmittingRef.current) return; // in-flight guard: a fast double-tap should fire ONE save, not two (audit)
    reviewSubmittingRef.current = true;
    // Server-side save: validates stars/device/dish, upserts on repeat ratings.
    const myDevice = getDeviceId();
    let res;
    try {
      res = await submitReviewRpc(item.slug, myDevice, selectedRating, reviewName.trim(), reviewText.trim(), restaurantId);
    } catch { res = { ok: false }; }
    finally { reviewSubmittingRef.current = false; }
    if (!res || !res.ok) {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Couldn't save review", subtitle: "please try again", kicker: "review", variant: "error" } }));
      return;
    }
    const newReview = {
      name: reviewName.trim() || "Guest",
      rating: selectedRating,
      text: reviewText.trim(),
      deviceId: myDevice,
    };
    // The DB upserts (one review per device per dish) — mirror that on screen:
    // drop this device's previous review before prepending the new one, so
    // re-rating never shows two reviews or skews the average.
    setLocalReviews([newReview, ...localReviews.filter((r) => r.deviceId !== myDevice)]);
    setReviewName("");        // clear the form
    setReviewText("");
    setSelectedRating(0);
    // Show a friendly success toast.
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Review posted", subtitle: "thanks for sharing", kicker: "review", variant: "success" } }));
    // HAPPY diner → invite a Google review, but ONLY in the "google_after_normal" mode
    // (owner 2026-07-24). A low rating (< 4★) stays private. The other Google modes show a
    // standing call-to-action instead (see the review section), so they don't post-nudge.
    // Reuse the mode/link already loaded on mount — no extra fetch, no egress.
    if (selectedRating >= 4 && googleMode === "google_after_normal" && googleCfgUrl) {
      setGoogleReviewUrl(googleCfgUrl);
    }
  };

  // Pick + shuffle once per dish/data change. Computing this during render
  // re-ran Math.random() on every keystroke/toggle, reshuffling the row each time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const relatedItems = useMemo(() => getRelatedItems(), [item, allItems]);

  // While the dish is still loading, show only the spinner.
  if (loading) {
    return (
      <div id="detail-page" className="page active item-detail-page flex items-center justify-center min-h-screen">
        <InfinityLoader label={t.loadingLabel} />
      </div>
    );
  }

  // THE READ NEVER CAME BACK — say so, rather than calling a dish that exists "not found".
  // Different words from the branch below on purpose: "Dish not found" would be a lie when the
  // truth is that this phone cannot reach the menu, and it would send a diner looking for a dish
  // that is on the table's paper menu in front of them. Deliberately English, like the 3D screen's
  // own unavailable card beside it (R23 — the guest translation set is parked).
  if (!item && readTimedOut) {
    return (
      <div id="detail-page" className="page active item-detail-page" style={ERROR_CARD_LAYOUT}>
        <div style={{ fontSize: 40 }} aria-hidden="true">📶</div>
        <h2 className="text-xl font-bold text-[var(--text)]">We couldn&apos;t load this dish</h2>
        <p className="text-[var(--muted)]" style={{ maxWidth: 320 }}>
          Your phone can&apos;t reach the menu right now. Check your connection, or ask a member of staff.
        </p>
        <button
          className="btn btn-gold"
          style={{ marginTop: 4 }}
          onClick={() => { setReadTimedOut(false); setLoading(true); setRetryNonce((v) => v + 1); }}
        >
          <i className="fas fa-rotate-right" aria-hidden="true"></i> Try again
        </button>
        <Link href={`${itemBase}/menu`} className="text-[var(--accent)] font-semibold hover:underline">
          ← {t.backToMenu}
        </Link>
      </div>
    );
  }

  // If loading finished but no matching dish was found, show a friendly
  // "not found" message with a link back to the menu.
  if (!item) {
    return (
      <div id="detail-page" className="page active item-detail-page" style={ERROR_CARD_LAYOUT}>
        <div style={{ fontSize: 40 }} aria-hidden="true">⚠️</div>
        <h2 className="text-xl font-bold text-[var(--text)]">{t.itemNotFound}</h2>
        <p className="text-[var(--muted)]" style={{ maxWidth: 320 }}>{t.itemNotFoundDesc}</p>
        <Link href={`${itemBase}/menu`} className="text-[var(--accent)] font-semibold hover:underline">
          ← {t.backToMenu}
        </Link>
      </div>
    );
  }

  // The shown rating uses the SAME authoritative aggregate the menu card uses
  // (item.rating / item.reviewCount from item_ratings), so the two never disagree.
  // The old code averaged only the loaded review LIST, which is capped at 20 rows —
  // so any dish with >20 reviews showed a different star average + count here than
  // on the card (audit fix 2026-07-06). We still fall back to the on-screen list
  // when there's no aggregate yet, and bump the count if this guest just posted one.
  // Does THIS restaurant have any 3D dish at all? The greyed "3D preview unavailable"
  // button is deliberate on the flagship (owner, 2026-06-10: it tells a diner 3D previews
  // exist here, just not for this dish). On a restaurant with NO 3D dishes it advertises
  // nothing and reads as broken on every single dish page — Aangan has ~199 of them
  // (guest sweep 2026-08-04). `allItems` is this restaurant's own list, so this is a free
  // in-memory check; while it is still loading we fall back to showing the button only for
  // a dish that genuinely has a model.
  const restaurantHas3d = allItems.some((it) => it.is4d);
  // DOES THE VEG / NON-VEG MARK MEAN ANYTHING ON THIS MENU? (owner, 2026-08-12: *"there shouldn't
  // be a non-veg chip … because it's veg"* — on a menu where every dish is on the same side of the
  // line, the chips AND the per-dish mark both go, because marking all 199 dishes green says
  // nothing.)
  //
  // components/MenuView.tsx has derived exactly this since that day and passes it to each card as
  // `showDiet`. This page never got it, so a pure-veg restaurant showed ZERO marks in the grid and
  // one the moment you opened any dish. Same derivation, from the same list, so the two surfaces
  // can only ever agree. Guarded on `allItems.length` exactly as MenuView guards on
  // `menuData.length`: while the menu is still loading we keep today's behaviour (the switch
  // alone) rather than flickering the mark away.
  const dietMeaningful =
    allItems.length === 0 || !(allItems.every((it) => it.veg) || allItems.every((it) => !it.veg));
  const showDiet = !!features.diet_filter && dietMeaningful;
  const aggCount = item.reviewCount ?? 0;
  const aggAvg = parseFloat(item.rating) || 0;
  const reviewCount = Math.max(aggCount, localReviews.length);
  const rating = aggCount > 0
    ? aggAvg
    : (localReviews.length > 0 ? localReviews.reduce((sum, r) => sum + r.rating, 0) / localReviews.length : 0);

  // From here down is the actual dish page layout (the markup).
  return (
    <div id="detail-page" className="page active item-detail-page">
      {/* The floating top bar: a back arrow on the left, the heart on the right. */}
      <div className="nav" style={{ position: 'fixed', top: 0, left: 0, width: '100%', background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none', borderBottom: 'none', zIndex: 51 }}>
        {/* Back to the menu. */}
        {/* aria-label, because the only thing inside is an icon: a screen reader announced this
            as just "link", with no name — on the ONE control that returns a guest to the menu,
            while every other button in this header has a name (T11 sweep, 2026-08-15). */}
        <Link href={`${itemBase}/menu`} className="nav-btn" aria-label={t.backToMenu || "Back to menu"} title={t.backToMenu || "Back to menu"} style={{ textDecoration: 'none' }}>
          <i className="fas fa-arrow-left" aria-hidden="true"></i>
        </Link>
        {/* A flexible spacer that pushes the heart to the right edge. */}
        <div style={{ flex: 1 }}></div>
        {/* The favorite heart. "fas" = solid (hearted), "far" = outline (not).
            Gone entirely when the favorites feature is switched off. */}
        {features.favorites && (
          <button id="detail-fav" className="nav-btn" onClick={toggleFavorite}>
            <i className={`${favorited ? 'fas' : 'far'} fa-heart`} style={{ color: favorited ? '#ef4444' : '' }}></i>
          </button>
        )}
      </div>

      {/* The one-time "tap the heart to save" coachmark, shown only briefly. */}
      {features.favorites && showFavHint && (
        <div className="fav-hint" role="status">
          <span className="fav-hint-tip" aria-hidden="true"></span>
          Tap the <i className="fas fa-heart" aria-hidden="true"></i> to save this to your Favourites
        </div>
      )}

      {/* The big dish photo. Tapping it opens the full-screen zoom view. */}
      <div className="detail-visual" onClick={() => setImgZoom(true)} style={{ cursor: 'zoom-in' }}>
        {/* The photo fades in (the "show" class is added once it's loaded). */}
        <img
          id="detail-img"
          className={`detail-img ${imageLoaded ? 'show' : ''}`}
          src={item.image}
          alt={item.title}
          decoding="async"
        />
        {/* A subtle gradient overlay on top of the photo. */}
        <div className="detail-img-overlay"></div>
        {/* The little "expand" icon hinting you can tap to zoom. */}
        <span className="img-zoom-hint"><i className="fas fa-expand-alt"></i></span>
        {/* The veg / non-veg badge in the corner — same single switch as the menu cards
            (Access → Menu → Veg / non-veg) AND the same "does it mean anything here?" test they
            use, so a pure-veg restaurant genuinely shows no mark anywhere. See `showDiet` above. */}
        {showDiet && (
          <span className="detail-diet-badge">
            <VegIcon isVeg={item.veg} size={28} />
          </span>
        )}
      </div>

      {/* The full-screen zoom view ("lightbox"), shown only when imgZoom is on.
          It supports pinch-to-zoom and dragging once zoomed in. */}
      {/* The dark full-screen backdrop below. Tapping it closes the view (but
          only when not zoomed in — the onClick checks lbScale). */}
      {imgZoom && (
        <div
          className="img-lightbox"
          onClick={() => { if (lbScale <= 1) { setImgZoom(false); setLbScale(1); setLbPos({ x: 0, y: 0 }); } }}
        >
          {/* The X button — closes and resets the zoom/pan.
              THE ONLY WAY OUT MUST STAY TAPPABLE WHILE THE PHOTO IS ZOOMED (sweep #8 T2,
              2026-09-02 — item 2). `.img-lightbox-close` is `position: absolute` with no z-index,
              and the photo below it is a later sibling carrying a `transform` — which makes its own
              stacking context and paints on top. MEASURED on a 360x780 phone: at 1x,
              elementFromPoint at the X's own centre is the X; the moment the photo is zoomed it
              grows to 780x780 and that same point answers `.img-lightbox-img`, at 2.5x and again at
              5x. So a diner who pinched into the dish photo and tapped the visible X did not close
              anything — the tap landed on the photo and merely un-zoomed it, and only a SECOND tap
              on the X closed the view. Backdrop-tap is deliberately disabled while zoomed (you are
              panning, not leaving), so the X is the only way out and it was the one thing not
              working.
              A z-index puts it back in front. Inline, like the two constants at the top of this
              file, because `app/globals.css` belongs to another part of this sweep; if that rule
              ever grows a z-index of its own this becomes redundant rather than wrong. */}
          <button
            className="img-lightbox-close"
            style={{ zIndex: 1 }}
            onClick={(e) => { e.stopPropagation(); setImgZoom(false); setLbScale(1); setLbPos({ x: 0, y: 0 }); }}
          >
            <i className="fas fa-times"></i>
          </button>
          {/* The zoomable image. The style applies the current zoom + pan, and
              the touch handlers below implement pinch-to-zoom and dragging. */}
          <img
            src={item.image}
            alt={item.title}
            className="img-lightbox-img"
            style={{
              transform: `scale(${lbScale}) translate(${lbPos.x / lbScale}px, ${lbPos.y / lbScale}px)`,
              transformOrigin: "center center",
              transition: lbScale === 1 ? "transform 0.25s" : "none",
              cursor: lbScale > 1 ? "move" : "zoom-in",
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (lbScale > 1) { setLbScale(1); setLbPos({ x: 0, y: 0 }); }
              else setLbScale(2.5);
            }}
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                pinchRef.current = Math.hypot(
                  e.touches[1].clientX - e.touches[0].clientX,
                  e.touches[1].clientY - e.touches[0].clientY
                );
              } else if (e.touches.length === 1 && lbScale > 1) {
                lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && pinchRef.current !== null) {
                const dist = Math.hypot(
                  e.touches[1].clientX - e.touches[0].clientX,
                  e.touches[1].clientY - e.touches[0].clientY
                );
                setLbScale(s => Math.min(5, Math.max(1, s * (dist / pinchRef.current!))));
                pinchRef.current = dist;
              } else if (e.touches.length === 1 && lbScale > 1 && lastTouchRef.current) {
                const dx = e.touches[0].clientX - lastTouchRef.current.x;
                const dy = e.touches[0].clientY - lastTouchRef.current.y;
                setLbPos(p => ({ x: p.x + dx, y: p.y + dy }));
                lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }
            }}
            onTouchEnd={() => { pinchRef.current = null; lastTouchRef.current = null; }}
          />
        </div>
      )}
      
      {/* Everything below the photo: title, rating, price, stats, description,
          buttons, reviews, related dishes, and prev/next navigation. */}
      <div className="detail-body">
        {/* The dish name. */}
        <h2 id="detail-title" className="detail-title">{item.title}</h2>
        {/* The star rating row — real reviews only. With none yet, the row
            stays empty: no invented stars, no badges (the owner rejected a
            "New" badge on 2026-06-10). */}
        <div className="rating-row" id="detail-rating-row">
          {/* Hidden entirely when the restaurant switches ratings off. */}
          {!features.ratings || reviewCount === 0 ? null : (
            <>
              <div className="stars">
                {/* Draw 5 stars: full, a partial one, or empty, based on the rating. */}
                {Array.from({ length: 5 }, (_, i) => {
                  const full = i + 1 <= Math.floor(rating);  // is this whole star filled?
                  const frac = rating - Math.floor(rating);
                  if (full) return <span key={i} className="star">★</span>;
                  if (i === Math.floor(rating) && frac > 0) {
                    return (
                      <span key={i} className="star-half-wrap">
                        <span className="star" style={{ color: "var(--muted2, rgba(212,165,116,0.3))" }}>★</span>
                        <span className="star-half-fill" style={{ width: `${frac * 100}%` }}>★</span>
                      </span>
                    );
                  }
                  return <span key={i} className="star" style={{ color: "var(--muted2, rgba(212,165,116,0.3))" }}>★</span>;
                })}
              </div>
              {/* The numeric rating (e.g. "4.5") and the review count. */}
              <span className="rating-value">{rating.toFixed(1)}</span>
              <span className="rating-count">({reviewCount} {reviewCount === 1 ? t.review : t.reviews})</span>
            </>
          )}
        </div>

        <div className="divider"></div>

        {/* The price, formatted for the current currency (falls back to $). */}
        <div className="price-row">
          <span className="detail-price" id="detail-price">{currency ? formatPrice(item.price, currency) : `$${item.price}`}</span>
        </div>

        {/* The nutrition stats row: calories, protein, carbs, sugar. Only shown when the
            dish actually HAS nutrition data — restaurants that don't fill it in were
            getting four empty labelled boxes that read as a broken page (sweep MENU1). */}
        {[item.nutrition?.calories, item.nutrition?.protein, item.nutrition?.carbs, item.nutrition?.sugar]
          .some((v) => v != null && String(v).trim() !== "" && String(v).trim() !== "—") && (
        <div className="stats-row" id="stats-row">
          <div className="stat-box">
            <div className="stat-num">{item.nutrition?.calories}</div>
            <div className="stat-label">{t.cal}</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{item.nutrition?.protein}</div>
            <div className="stat-label">{t.protein}</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{item.nutrition?.carbs}</div>
            <div className="stat-label">{t.carbs}</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{item.nutrition?.sugar ?? '—'}</div>
            <div className="stat-label">{t.sugar}</div>
          </div>
        </div>
        )}

        {/* The "About this dish" section — only when there's a description to show, so a
            restaurant with no description doesn't render an empty labelled card (MENU1).
            (Ingredients/allergens live inside and are only reachable via this section's
            Read-more, so hiding it when empty loses nothing.) */}
        {!!(item.longDescription && item.longDescription.trim()) && (<>
        <div className="section-label">{t.aboutDish}</div>
        <div className="desc-box">
          {/* The description. The "expanded" class shows the full text. */}
          <p id="detail-desc" className={`detail-desc ${descExpanded ? 'expanded' : ''}`}>
            {item.longDescription}
          </p>
          {/* The Read more / Read less toggle. */}
          <span id="desc-toggle" className="desc-toggle" onClick={() => setDescExpanded(!descExpanded)}>
            {descExpanded ? t.readLess : t.readMore}
          </span>
          {/* When expanded, also reveal the ingredients list and allergens. */}
          {descExpanded && <div className="ing-inside-label">{t.ingredients}</div>}
          {descExpanded && <div className="ingredients-row" id="tags-row">
            {/* Draw a colored chip for each ingredient. */}
            {(item.ingredients ?? []).map((ingItem, i) => {
              // Pick a color for this ingredient's emoji (alternating between
              // its two choices), falling back to a default beige if unknown.
              if (!emojiIndexMap[ingItem.emoji]) emojiIndexMap[ingItem.emoji] = 0;
              const colorOptions = colorMap[ingItem.emoji as keyof typeof colorMap] || [{ bg: 'rgba(212, 165, 116, 0.15)', border: '#D4A574', glow: 'rgba(212, 165, 116, 0.4)' }];
              const colors = colorOptions[emojiIndexMap[ingItem.emoji] % colorOptions.length];
              emojiIndexMap[ingItem.emoji]++;  // next time, use the other color
              // In light mode, some colors swap to a darker, readable variant.
              const isLightTheme = theme === 'light';
              let textColor = colors.border;
              let borderColor = colors.border;
              if (isLightTheme && (colors as any).lightBorder && (colors as any).lightText) {
                borderColor = (colors as any).lightBorder;
                textColor = (colors as any).lightText;
              }
              return (
                <div
                  key={i}
                  className="ing-tag"
                  style={{ background: colors.bg, border: `1px solid ${borderColor}`, color: textColor, ['--ing-glow' as any]: colors.glow }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 18px ${colors.glow}`; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
                >
                  {ingItem.emoji} {ingItem.name}
                </div>
              );
            })}
          </div>}
          {/* When expanded and the dish has allergens, list them too —
              unless the allergy feature is switched off for this restaurant. */}
          {features.allergies && descExpanded && item.allergens.length > 0 && (
            <>
              <div className="ing-inside-label">{t.contains}</div>
              <div className="allergens-list">
                {item.allergens.map((a) => (
                  <span key={a} className="allergen-chip">{allergenIcon(a)} {allergenLabel(a)}</span>
                ))}
              </div>
            </>
          )}
        </div>
        </>)}

        {/* The action buttons: Add to Cart, plus View in 3D (or a disabled
            placeholder when this dish has no 3D model). */}
        {/* style: see BTN_ROW_ABOVE_NAV_STRIPS — the Add button owns its own edge. */}
        <div className="btn-row" ref={btnRowRef} style={BTN_ROW_ABOVE_NAV_STRIPS}>
          {/* Sold-out dishes show a disabled "Not available" button instead of
              Add to Cart — matching the menu card, so you can't order one here. */}
          {(item.tags || []).includes("sold-out") ? (
            <button className="btn btn-gold" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
              <i className="fas fa-ban"></i> {t.notAvailable}
            </button>
          ) : (
            <button className="btn btn-gold" onClick={addToCart}>
              <i className="fas fa-shopping-bag"></i> {t.addToCart}
            </button>
          )}
          {/* Show the live 3D button if a model exists; otherwise the greyed-out
              "3D preview unavailable" status. The owner WANTS the status visible
              (2026-06-10): it tells guests 3D previews are a feature of this
              menu, just not ready for this dish yet. Do not remove it.
              (Both vanish only when the whole 3D FEATURE is switched off.) */}
          {features.model3d && (restaurantHas3d || (item.is4d && item.modelFolder)) && (item.is4d && item.modelFolder ? (
            <button id="view-3d-btn" className="btn btn-cyan" onClick={goToViewer}>
              <i className="fas fa-cube"></i> {t.viewIn3D}
            </button>
          ) : (
            <button className="btn btn-cyan" style={{ opacity: 0.5, cursor: 'not-allowed' }} disabled>
              <i className="fas fa-cube"></i> {t.preview3dUnavailable}
            </button>
          ))}
        </div>

        {/* The customer reviews area (mig 187 modes). "Normal" in-menu reviews show when the
            restaurant's reviews/ratings feature is on — EXCEPT in Google-ONLY mode, which
            replaces them with a Google call-to-action. A STANDING Google invite shows in the
            google / google_plus_normal modes; the post-rating nudge fires only in
            google_after_normal. When everything's off, the whole area disappears. */}
        {(() => {
          const normalOn = features.ratings && features.reviews;
          const showNormal = normalOn && googleMode !== "google";
          const showGoogleCta = (googleMode === "google" || googleMode === "google_plus_normal") && !!googleCfgUrl;
          if (!showNormal && !showGoogleCta) return null;
          // One adaptive review-invite card, reused by the standing CTA and the post-rating
          // nudge. It ADAPTS to the destination so the label never promises "Google" while
          // opening our @aevinite Instagram (the default link for a brand-new restaurant).
          const cta = (u: string, dismissable: boolean) => {
            const isInsta = /instagram\.com/i.test(u);
            const heading = dismissable
              ? (isInsta ? "Thank you! Would you follow us on Instagram?" : "Thank you! Would you share it on Google?")
              : (isInsta ? "Enjoying it? Follow us on Instagram" : "Enjoying it? Review us on Google");
            return (
              <div className="google-review-prompt" style={{ background: "var(--card, rgba(255,255,255,0.06))", border: "1px solid var(--accent)", borderRadius: 14, padding: "16px 18px", margin: "0 0 16px", textAlign: "center" }}>
                <div style={{ fontSize: 26, marginBottom: 6 }} aria-hidden="true">⭐</div>
                <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{heading}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{isInsta ? "A quick follow really helps us — it only takes a moment." : "A quick review really helps us — it only takes a moment."}</div>
                <a href={u} target="_blank" rel="noopener noreferrer" className="btn btn-gold" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }} onClick={() => { if (dismissable) setGoogleReviewUrl(null); }}>
                  <i className={isInsta ? "fab fa-instagram" : "fab fa-google"} aria-hidden="true"></i> {isInsta ? "Follow on Instagram" : "Review on Google"}
                </a>
                {dismissable && <div><button type="button" onClick={() => setGoogleReviewUrl(null)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12.5, marginTop: 10, cursor: "pointer" }}>No thanks</button></div>}
              </div>
            );
          };
          return (<>
        <div className="section-label" style={{ marginTop: '24px' }}>{t.customerReviews}</div>
        {/* Standing Google invite (google / google_plus_normal modes). */}
        {showGoogleCta && cta(googleCfgUrl as string, false)}
        {showNormal && (<>
        <div className="review-tabs">
          {/* Tab 1: the "rate this dish" form. */}
          <button
            className={`review-tab-btn ${reviewTab === "rate" ? "active" : ""} ${reviewTab === "reviews" ? "tab-glow" : ""}`}
            onClick={() => setReviewTab("rate")}
          >
            ⭐ {t.tabRate}
          </button>
          {/* Tab 2: the list of existing reviews. */}
          <button
            className={`review-tab-btn ${reviewTab === "reviews" ? "active" : ""}`}
            onClick={() => setReviewTab("reviews")}
          >
            {/* The SAME authoritative count the star row shows. `localReviews` is capped at
                20 rows by getItemReviews, so a dish with 35 reviews used to read
                "(35 reviews)" beside the stars and "Reviews (20)" here, on one screen
                (guest sweep 2026-08-04). */}
            💬 {t.tabReviews} ({reviewCount})
          </button>
        </div>

        {/* Post-rating nudge (google_after_normal) — appears after a HIGH rating (>= 4★).
            Tapping opens it in a new tab; "No thanks" (or tapping through) dismisses it. */}
        {googleReviewUrl && cta(googleReviewUrl, true)}
        {/* The review form — shown only when the "rate" tab is active. */}
        {reviewTab === "rate" && (
          <div className="review-form" id="review-form">
            <div className="form-title">{t.rateThisDish}</div>
            <div className="form-top-row">
              <StarRating value={selectedRating} onChange={setSelectedRating} />
            </div>
            <input
              type="text"
              className="review-name-input"
              id="review-name"
              placeholder={t.yourName}
              value={reviewName}
              onChange={(e) => setReviewName(e.target.value)}
            />
            <textarea
              className="review-textarea"
              id="review-text"
              placeholder={t.sharePlaceholder}
              rows={3}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
            ></textarea>
            <button className="btn-submit-review" id="submit-review" onClick={submitReview}>{t.submitReview}</button>
          </div>
        )}

        {/* The list of reviews — shown only when the "reviews" tab is active. */}
        {reviewTab === "reviews" && (
          <div className="reviews-section" id="reviews-section">
            {/* If there are no reviews, show an encouraging empty message. */}
            {localReviews.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
                No reviews yet. Be the first to review!
              </p>
            ) : (
              // Otherwise, draw a card for each review.
              localReviews.map((review, i) => (
                <div key={i} className="review-card">
                  <div className="review-stars">
                    {Array.from({ length: 5 }, (_, j) => (
                      <svg key={j} className={`review-star ${j < review.rating ? "" : "empty"}`} viewBox="0 0 24 24">
                        <polygon points="12,2 15,8 22,9 17,14 18,21 12,18 6,21 7,14 2,9 9,8"/>
                      </svg>
                    ))}
                  </div>
                  <div className="review-name">{review.name}</div>
                  <div className="review-comment">{review.text}</div>
                </div>
              ))
            )}
          </div>
        )}
        </>)}
          </>);
        })()}

        {/* The "You might like" row — only shown if there are suggestions. */}
        {relatedItems.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>{t.youMightLike}</div>
            <div className="related-section" id="related-section">
              {/* One tappable card per suggested dish. */}
              {relatedItems.map((related) => (
                <Link key={related.slug} href={`${itemBase}/item/${related.slug}`} className="related-card-link" style={{ textDecoration: 'none' }}>
                  <div className="related-card">
                    <img
                      className="related-img"
                      src={related.image}
                      alt={related.title}
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="related-name">{related.title}</div>
                    <div className="related-price">{currency ? formatPrice(related.price, currency) : `$${related.price}`}</div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
        
        {/* The previous / next dish arrows down the sides. This little inline
            function works out the neighbors and only shows arrows that exist. */}
        {(() => {
          if (!allItems.length || !item) return null;  // nothing to navigate yet
          // The list we step through: the same category we came from.
          const navCat = fromCat || item.category;
          const siblings = navCat === "all" ? allItems : allItems.filter((it) => it.category === navCat);
          const idx = siblings.findIndex((it) => it.slug === item.slug);  // our spot in it
          if (idx < 0) return null;
          // No wrap-around: hide the arrow when there's nothing before/after.
          const prev = idx > 0 ? siblings[idx - 1] : null;
          const next = idx < siblings.length - 1 ? siblings[idx + 1] : null;
          if (!prev && !next) return null;  // only one dish — no arrows
          // Always carry the category in the link so the next page keeps the SAME
          // nav list (previously omitted when navCat === the dish's own category,
          // which relied on a fallback and lost the context the viewer preserves).
          const catParam = `?cat=${encodeURIComponent(navCat)}`;
          return (
            <>
              {/* Left strip: go to the previous dish (only if there is one). */}
              {prev && (
                <Link
                  href={`${itemBase}/item/${prev.slug}${catParam}`}
                  className="dish-nav-strip prev"
                  title={prev.title}
                  aria-label={`${t.previous}: ${prev.title}`}
                >
                  <i className="fas fa-chevron-left"></i>
                  <i className="fas fa-chevron-left"></i>
                </Link>
              )}
              {/* Right strip: go to the next dish (only if there is one). */}
              {next && (
                <Link
                  href={`${itemBase}/item/${next.slug}${catParam}`}
                  className="dish-nav-strip next"
                  title={next.title}
                  aria-label={`${t.next}: ${next.title}`}
                >
                  <i className="fas fa-chevron-right"></i>
                  <i className="fas fa-chevron-right"></i>
                </Link>
              )}
            </>
          );
        })()}

        {/* A final "Back to menu" button at the bottom. */}
        {/* Same edge rule as the Add row above — this button is full width too, so the strip was
            taking its last 8px as well. */}
        <div className="btn-row" style={{ marginTop: '8px', ...BTN_ROW_ABOVE_NAV_STRIPS }}>
          <button className="btn btn-secondary" onClick={goToMenu}>
            <i className="fas fa-arrow-left"></i> {t.backToMenu}
          </button>
        </div>
      </div>

      {/* THE PINNED ADD BAR. Shown only while the real button row is off screen (see the
          IntersectionObserver above) and it carries the dish's price, so the one thing this page
          exists for is always one tap away. A sold-out dish never gets one — there is nothing to
          tap. It clears the chef bell / offline bar the same way the mini-cart does, through the
          shared --lfh-offbar-h and the safe-area inset. */}
      {item && !(item.tags || []).includes("sold-out") && barFitsScreen && (
        <div className={`item-addbar${realBtnOffScreen ? " on" : ""}`} aria-hidden={!realBtnOffScreen}>
          <span className="item-addbar-price">{currency ? formatPrice(item.price, currency) : `$${item.price}`}</span>
          <button className="btn btn-gold" onClick={addToCart} tabIndex={realBtnOffScreen ? 0 : -1}>
            <i className="fas fa-shopping-bag"></i> {t.addToCart}
          </button>
        </div>
      )}
    </div>
  );
}
