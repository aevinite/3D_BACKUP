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
import { getMenuItems, getItemReviews, submitReview as submitReviewRpc } from "@/lib/menu"; // dishes + reviews + the review-saving RPC
import { getDeviceId } from "@/lib/device";          // stable per-browser id (one rating per dish per device)
import { allergenIcon, allergenLabel } from "@/lib/allergens"; // allergen icon + label
import { useFeatures } from "@/lib/features"; // per-restaurant feature switches
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format"; // money formatting
import { gateAddToCart } from "@/lib/tableConnection"; // "must be at a table to order" gate
import { useTranslation } from "@/lib/i18n";         // translated text strings
import VegIcon from "@/components/VegIcon";           // the little veg/non-veg dot

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
  longDescription: string;
  rating: string;
  time: string;
  nutrition: {
    calories: string;
    protein: string;
    carbs: string;
    sugar?: string;
  };
  ingredients: {
    emoji: string;
    name: string;
  }[];
  reviews: {
    name: string;
    rating: number;
    text: string;
  }[];
  relatedSlugs: string[];
  allergens: string[];
  tags: string[];  // filter slugs this dish matches; "sold-out" means it can't be ordered
  options?: { name: string; type: "single" | "multi"; choices: { label: string; price: number }[] }[];
}

// The dish detail component. It receives `slug` (which dish to show) and
// `fromCat` (which category the guest came from, for prev/next arrows).
export default function ItemClient({ slug, fromCat }: { slug: string; fromCat?: string }) {
  const t = useTranslation();  // translated text for the current language
  const features = useFeatures(); // which restaurant features are switched on
  // All the little pieces of memory this page keeps (current value + setter):
  const [allItems, setAllItems] = useState<FoodItem[]>([]);  // every dish (for related/next/prev)
  const [item, setItem] = useState<FoodItem | null>(null);   // THIS dish (null until found)
  const [loading, setLoading] = useState(true);              // still fetching?
  const [favorited, setFavorited] = useState(false);         // is this dish hearted?
  const [showFavHint, setShowFavHint] = useState(false); // one-time "tap to save" coachmark
  const [descExpanded, setDescExpanded] = useState(false);   // is the description expanded?
  const [imageLoaded, setImageLoaded] = useState(false);     // has the photo faded in?
  const [selectedRating, setSelectedRating] = useState(0);   // stars chosen in the review form
  const [reviewName, setReviewName] = useState("");          // reviewer's typed name
  const [reviewText, setReviewText] = useState("");          // reviewer's typed comment
  const [localReviews, setLocalReviews] = useState<{name: string; rating: number; text: string; deviceId?: string}[]>([]); // reviews shown (incl. ones just added)
  const [reviewTab, setReviewTab] = useState<"rate" | "reviews">("reviews"); // which review tab is open
  const [imgZoom, setImgZoom] = useState(false);             // is the full-screen photo open?
  const [lbScale, setLbScale] = useState(1);                 // zoom level in the lightbox (1 = normal)
  const [lbPos, setLbPos] = useState({ x: 0, y: 0 });        // pan offset while zoomed in
  // useRef holds a value across redraws WITHOUT causing a redraw — handy for
  // tracking finger gestures mid-pinch.
  const pinchRef = useRef<number | null>(null);              // distance between two fingers
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null); // last finger position
  const [theme, setTheme] = useState<'dark' | 'light'>('light'); // dark or light mode
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null); // currency for prices
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
      router.push(`/view/${item.modelFolder}?from=${encodeURIComponent(item.slug)}`);
    }
  };

  // Go back to the menu.
  const goToMenu = () => router.push("/menu");

  // Fetch the dishes and find the one matching this page's slug.
  // Re-runs if the slug changes (e.g. navigating to a different dish).
  useEffect(() => {
    getMenuItems()
      .then((items) => {
        // Compare ignoring upper/lowercase so "Croissant" and "croissant" match.
        const normalizedSlug = (slug || "").toLowerCase();
        const found = items.find(
          (it) => it.slug?.toLowerCase() === normalizedSlug
        );

        setAllItems(items);                 // keep the full list for related/nav
        setItem(found || null);             // this dish (or null if not found)
        // Real reviews load separately (getMenuItems carries only the rating
        // average); a failure here just leaves the list empty.
        if (found) getItemReviews(found.slug).then(setLocalReviews).catch(() => {});
        setLoading(false);                  // done loading
        setTimeout(() => setImageLoaded(true), 50); // trigger the photo fade-in

        // Load favorite state
        try {
          const savedFavorites = localStorage.getItem('lfh-favorites');
          if (savedFavorites) {
            const favorites = JSON.parse(savedFavorites);  // text back into a list
            setFavorited(favorites.includes(found?.id));    // is this dish in it?
          }
        } catch (e) {
          console.error('Failed to load favorites', e);
        }
      })
      .catch((err) => {
        // If the fetch failed, log it and stop the spinner.
        console.error(err);
        setLoading(false);
      });
  }, [slug]);

  // Background preload: this dish's model first, then the next & previous dishes
  // in the category (their GLBs + images), so moving between dishes — and opening
  // the 3D view — feels instant. Downloads run through the singleton loader.
  // Re-runs when the dish, the full list, or the source category changes.
  useEffect(() => {
    if (!item) return;  // nothing to preload until we know the dish
    const urls: string[] = [];  // the model files we'll queue for download
    // Add a dish's 3D model files (small + optimized) to the download list.
    const queue4d = (it?: FoodItem | null) => {
      if (!it?.is4d) return;  // skip dishes without a 3D model
      if (it.modelSmallUrl) urls.push(it.modelSmallUrl);
      if (it.modelOptimizedUrl) urls.push(it.modelOptimizedUrl);
    };
    // Quietly start loading a dish's PHOTO in the background.
    const preloadImg = (it?: FoodItem | null) => {
      if (it?.image) {
        const im = new window.Image();  // an off-screen image just to warm the cache
        im.src = it.image;
      }
    };
    queue4d(item); // current dish first
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
  }, [item, allItems, fromCat]);

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
      const savedFavorites = localStorage.getItem('lfh-favorites');
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
      localStorage.setItem('lfh-favorites', JSON.stringify(favorites));  // save back
      setFavorited(!favorited);  // flip the heart on screen
      // Tell the menu's Favorites tab to refresh (same-tab; storage event covers others).
      window.dispatchEvent(new Event("lfh:favorites-updated"));
    } catch (e) {
      console.error('Failed to update favorites', e);
    }
  };

  // "Add to Cart" — instead of adding directly, it opens the shared confirm
  // popup (quantity + total) by broadcasting an event the modal listens for.
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
    // Server-side save: validates stars/device/dish, upserts on repeat ratings.
    const myDevice = getDeviceId();
    const res = await submitReviewRpc(item.slug, myDevice, selectedRating, reviewName.trim(), reviewText.trim());
    if (!res.ok) {
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

  // If loading finished but no matching dish was found, show a friendly
  // "not found" message with a link back to the menu.
  if (!item) {
    return (
      <div id="detail-page" className="page active item-detail-page flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">{t.itemNotFound}</h2>
        <p className="text-[var(--muted)] mb-4">{t.itemNotFoundDesc}</p>
        <Link href="/menu" className="text-[var(--accent)] font-semibold hover:underline">
          ← {t.backToMenu}
        </Link>
      </div>
    );
  }

  // The shown rating: the average of the REAL reviews on screen (the list
  // starts as the database's reviews and grows when this guest posts one).
  // Zero reviews -> rating 0 and the UI shows a "New" badge instead of stars.
  const rating = localReviews.length > 0
    ? localReviews.reduce((sum, r) => sum + r.rating, 0) / localReviews.length
    : 0;
  const reviewCount = localReviews.length;  // how many reviews to show in "(N reviews)"

  // From here down is the actual dish page layout (the markup).
  return (
    <div id="detail-page" className="page active item-detail-page">
      {/* The floating top bar: a back arrow on the left, the heart on the right. */}
      <div className="nav" style={{ position: 'fixed', top: 0, left: 0, width: '100%', background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none', borderBottom: 'none', zIndex: 51 }}>
        {/* Back to the menu. */}
        <Link href="/menu" className="nav-btn" style={{ textDecoration: 'none' }}>
          <i className="fas fa-arrow-left"></i>
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
          Tap the <i className="fas fa-heart" aria-hidden="true"></i> to save this to your Favorites
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
        {/* The veg / non-veg badge in the corner. */}
        <span className="detail-diet-badge">
          <VegIcon isVeg={item.veg} size={28} />
        </span>
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
          {/* The X button — closes and resets the zoom/pan. */}
          <button
            className="img-lightbox-close"
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

        {/* The nutrition stats row: calories, protein, carbs, sugar. */}
        <div className="stats-row" id="stats-row">
          <div className="stat-box">
            <div className="stat-num">{item.nutrition.calories}</div>
            <div className="stat-label">{t.cal}</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{item.nutrition.protein}</div>
            <div className="stat-label">{t.protein}</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{item.nutrition.carbs}</div>
            <div className="stat-label">{t.carbs}</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{item.nutrition.sugar ?? '—'}</div>
            <div className="stat-label">{t.sugar}</div>
          </div>
        </div>

        {/* The "About this dish" section. */}
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
            {item.ingredients.map((ingItem, i) => {
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
              <div className="ing-inside-label">Contains</div>
              <div className="allergens-list">
                {item.allergens.map((a) => (
                  <span key={a} className="allergen-chip">{allergenIcon(a)} {allergenLabel(a)}</span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* The action buttons: Add to Cart, plus View in 3D (or a disabled
            placeholder when this dish has no 3D model). */}
        <div className="btn-row">
          {/* Sold-out dishes show a disabled "Not available" button instead of
              Add to Cart — matching the menu card, so you can't order one here. */}
          {(item.tags || []).includes("sold-out") ? (
            <button className="btn btn-gold" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
              <i className="fas fa-ban"></i> Not available
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
          {features.model3d && (item.is4d && item.modelFolder ? (
            <button id="view-3d-btn" className="btn btn-cyan" onClick={goToViewer}>
              <i className="fas fa-cube"></i> {t.viewIn3D}
            </button>
          ) : (
            <button className="btn btn-cyan" style={{ opacity: 0.5, cursor: 'not-allowed' }} disabled>
              <i className="fas fa-cube"></i> {t.preview3dUnavailable}
            </button>
          ))}
        </div>

        {/* The customer reviews area: two tabs (write one / read them).
            The ENTIRE area (label, tabs, form, list) disappears when the
            restaurant switches the reviews feature off. */}
        {features.reviews && (<>
        <div className="section-label" style={{ marginTop: '24px' }}>{t.customerReviews}</div>
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
            💬 {t.tabReviews} ({localReviews.length})
          </button>
        </div>

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

        {/* The "You might like" row — only shown if there are suggestions. */}
        {relatedItems.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>{t.youMightLike}</div>
            <div className="related-section" id="related-section">
              {/* One tappable card per suggested dish. */}
              {relatedItems.map((related) => (
                <Link key={related.slug} href={`/item/${related.slug}`} className="related-card-link" style={{ textDecoration: 'none' }}>
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
          // Carry the category in the link so the next page keeps the same nav list.
          const catParam = navCat !== item.category ? `?cat=${navCat}` : "";
          return (
            <>
              {/* Left strip: go to the previous dish (only if there is one). */}
              {prev && (
                <Link
                  href={`/item/${prev.slug}${catParam}`}
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
                  href={`/item/${next.slug}${catParam}`}
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
        <div className="btn-row" style={{ marginTop: '8px' }}>
          <button className="btn btn-secondary" onClick={goToMenu}>
            <i className="fas fa-arrow-left"></i> {t.backToMenu}
          </button>
        </div>
      </div>
    </div>
  );
}
