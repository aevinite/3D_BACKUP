"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StarRating from "@/components/StarRating";
import InfinityLoader from "@/components/InfinityLoader";
import { modelLoader } from "@/lib/modelLoader";
import { getMenuItems } from "@/lib/menu";
import { allergenIcon, allergenLabel } from "@/lib/allergens";
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import VegIcon from "@/components/VegIcon";

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
  options?: { name: string; type: "single" | "multi"; choices: { label: string; price: number }[] }[];
}

export default function ItemClient({ slug, fromCat }: { slug: string; fromCat?: string }) {
  const t = useTranslation();
  const [allItems, setAllItems] = useState<FoodItem[]>([]);
  const [item, setItem] = useState<FoodItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [favorited, setFavorited] = useState(false);
  const [showFavHint, setShowFavHint] = useState(false); // one-time "tap to save" coachmark
  const [descExpanded, setDescExpanded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [reviewName, setReviewName] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [localReviews, setLocalReviews] = useState<{name: string; rating: number; text: string}[]>([]);
  const [reviewTab, setReviewTab] = useState<"rate" | "reviews">("reviews");
  const [imgZoom, setImgZoom] = useState(false);
  const [lbScale, setLbScale] = useState(1);
  const [lbPos, setLbPos] = useState({ x: 0, y: 0 });
  const pinchRef = useRef<number | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null);
  const router = useRouter();

  // First-time-only nudge so guests learn the top-right heart saves a dish to
  // Favorites. Shows briefly, then never again (localStorage flag).
  useEffect(() => {
    let seen = true;
    try { seen = !!localStorage.getItem("lfh-fav-hint-seen"); } catch {}
    if (seen) return;
    const show = setTimeout(() => setShowFavHint(true), 700);
    const hide = setTimeout(() => {
      setShowFavHint(false);
      try { localStorage.setItem("lfh-fav-hint-seen", "1"); } catch {}
    }, 5500);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, []);

  useEffect(() => {
    setCurrencyState(getCurrency());
    const onCur = () => setCurrencyState(getCurrency());
    window.addEventListener("lfh:currency-changed", onCur);
    return () => window.removeEventListener("lfh:currency-changed", onCur);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const read = () => setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  
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
  
  const emojiIndexMap: Record<string, number> = {};
  
  const goToViewer = () => {
    if (item?.is4d && item?.modelFolder) {
      router.push(`/view/${item.modelFolder}?from=${encodeURIComponent(item.slug)}`);
    }
  };
  
  const goToMenu = () => router.push("/menu");

  useEffect(() => {
    getMenuItems()
      .then((items) => {
        const normalizedSlug = (slug || "").toLowerCase();
        const found = items.find(
          (it) => it.slug?.toLowerCase() === normalizedSlug
        );

        setAllItems(items);
        setItem(found || null);
        setLocalReviews(found?.reviews || []);
        setLoading(false);
        setTimeout(() => setImageLoaded(true), 50);

        // Load favorite state
        try {
          const savedFavorites = localStorage.getItem('lfh-favorites');
          if (savedFavorites) {
            const favorites = JSON.parse(savedFavorites);
            setFavorited(favorites.includes(found?.id));
          }
        } catch (e) {
          console.error('Failed to load favorites', e);
        }
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [slug]);

  // Background preload: this dish's model first, then the next & previous dishes
  // in the category (their GLBs + images), so moving between dishes — and opening
  // the 3D view — feels instant. Downloads run through the singleton loader.
  useEffect(() => {
    if (!item) return;
    const urls: string[] = [];
    const queue4d = (it?: FoodItem | null) => {
      if (!it?.is4d) return;
      if (it.modelSmallUrl) urls.push(it.modelSmallUrl);
      if (it.modelOptimizedUrl) urls.push(it.modelOptimizedUrl);
    };
    const preloadImg = (it?: FoodItem | null) => {
      if (it?.image) {
        const im = new window.Image();
        im.src = it.image;
      }
    };
    queue4d(item); // current dish first
    if (allItems.length) {
      const navCat = fromCat || item.category;
      const sibs = navCat === "all" ? allItems : allItems.filter((it) => it.category === navCat);
      const i = sibs.findIndex((it) => it.slug === item.slug);
      if (i >= 0) {
        const next = i < sibs.length - 1 ? sibs[i + 1] : null;
        const prev = i > 0 ? sibs[i - 1] : null;
        queue4d(next); // next is the most likely move
        queue4d(prev);
        preloadImg(next);
        preloadImg(prev);
      }
    }
    if (urls.length) modelLoader.prioritize(urls);
  }, [item, allItems, fromCat]);

  const getRelatedItems = (): FoodItem[] => {
    if (!item || !allItems.length) return [];
    const TOTAL = 10;
    const SAME_TARGET = 5; // 5 same-category + 5 related — then shuffle so they interleave
    const rating = (it: FoodItem) => parseFloat(it.rating) || 0;
    const byRating = (a: FoodItem, b: FoodItem) => rating(b) - rating(a);

    const others = allItems.filter((it) => it.slug !== item.slug);
    const same = others.filter((it) => it.category === item.category).sort(byRating);
    const diff = others.filter((it) => it.category !== item.category).sort(byRating);

    const samePick = same.slice(0, SAME_TARGET);
    const diffPick = diff.slice(0, TOTAL - samePick.length);
    let picked = [...samePick, ...diffPick];
    if (picked.length < TOTAL) picked = picked.concat(same.slice(samePick.length));
    picked = picked.slice(0, TOTAL);

    // Shuffle so same- and other-category dishes are interleaved, not grouped.
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    return picked;
  };

  const toggleFavorite = () => {
    if (!item) return;
    // Any tap on the heart means the hint did its job — retire it for good.
    if (showFavHint) setShowFavHint(false);
    try { localStorage.setItem("lfh-fav-hint-seen", "1"); } catch {}
    try {
      let favorites: string[] = [];
      const savedFavorites = localStorage.getItem('lfh-favorites');
      if (savedFavorites) {
        favorites = JSON.parse(savedFavorites);
      }
      if (favorited) {
        favorites = favorites.filter(id => id !== item.id);
      } else {
        favorites.push(item.id);
      }
      localStorage.setItem('lfh-favorites', JSON.stringify(favorites));
      setFavorited(!favorited);
      // Tell the menu's Favorites tab to refresh (same-tab; storage event covers others).
      window.dispatchEvent(new Event("lfh:favorites-updated"));
    } catch (e) {
      console.error('Failed to update favorites', e);
    }
  };

  const addToCart = () => {
    if (!item) return;
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
  };

  const submitReview = () => {
    if (!reviewName.trim() || !reviewText.trim() || selectedRating === 0) {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Almost there", subtitle: "add a name, note & rating", kicker: "review", variant: "error" } }));
      return;
    }
    const newReview = {
      name: reviewName.trim(),
      rating: selectedRating,
      text: reviewText.trim(),
    };
    setLocalReviews([newReview, ...localReviews]);
    setReviewName("");
    setReviewText("");
    setSelectedRating(0);
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Review posted", subtitle: "thanks for sharing", kicker: "review", variant: "success" } }));
  };

  // Pick + shuffle once per dish/data change. Computing this during render
  // re-ran Math.random() on every keystroke/toggle, reshuffling the row each time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const relatedItems = useMemo(() => getRelatedItems(), [item, allItems]);

  if (loading) {
    return (
      <div id="detail-page" className="page active item-detail-page flex items-center justify-center min-h-screen">
        <InfinityLoader label={t.loadingLabel} />
      </div>
    );
  }

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

  const rating = localReviews.length > 0
    ? localReviews.reduce((sum, r) => sum + r.rating, 0) / localReviews.length
    : parseFloat(item.rating);
  const reviewCount = localReviews.length;

  return (
    <div id="detail-page" className="page active item-detail-page">
      <div className="nav" style={{ position: 'fixed', top: 0, left: 0, width: '100%', background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none', borderBottom: 'none', zIndex: 51 }}>
        <Link href="/menu" className="nav-btn" style={{ textDecoration: 'none' }}>
          <i className="fas fa-arrow-left"></i>
        </Link>
        <div style={{ flex: 1 }}></div>
        <button id="detail-fav" className="nav-btn" onClick={toggleFavorite}>
          <i className={`${favorited ? 'fas' : 'far'} fa-heart`} style={{ color: favorited ? '#ef4444' : '' }}></i>
        </button>
      </div>

      {showFavHint && (
        <div className="fav-hint" role="status">
          <span className="fav-hint-tip" aria-hidden="true"></span>
          Tap the <i className="fas fa-heart" aria-hidden="true"></i> to save this to your Favorites
        </div>
      )}

      <div className="detail-visual" onClick={() => setImgZoom(true)} style={{ cursor: 'zoom-in' }}>
        <img
          id="detail-img"
          className={`detail-img ${imageLoaded ? 'show' : ''}`}
          src={item.image}
          alt={item.title}
          decoding="async"
        />
        <div className="detail-img-overlay"></div>
        <span className="img-zoom-hint"><i className="fas fa-expand-alt"></i></span>
        <span className="detail-diet-badge">
          <VegIcon isVeg={item.veg} size={28} />
        </span>
      </div>

      {imgZoom && (
        <div
          className="img-lightbox"
          onClick={() => { if (lbScale <= 1) { setImgZoom(false); setLbScale(1); setLbPos({ x: 0, y: 0 }); } }}
        >
          <button
            className="img-lightbox-close"
            onClick={(e) => { e.stopPropagation(); setImgZoom(false); setLbScale(1); setLbPos({ x: 0, y: 0 }); }}
          >
            <i className="fas fa-times"></i>
          </button>
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
      
      <div className="detail-body">
        <h2 id="detail-title" className="detail-title">{item.title}</h2>
        <div className="rating-row" id="detail-rating-row">
          <div className="stars">
            {Array.from({ length: 5 }, (_, i) => {
              const full = i + 1 <= Math.floor(rating);
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
          <span className="rating-value">{rating.toFixed(1)}</span>
          <span className="rating-count">({reviewCount} {reviewCount === 1 ? t.review : t.reviews})</span>
        </div>
        
        <div className="divider"></div>

        <div className="price-row">
          <span className="detail-price" id="detail-price">{currency ? formatPrice(item.price, currency) : `$${item.price}`}</span>
        </div>
        
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

        <div className="section-label">{t.aboutDish}</div>
        <div className="desc-box">
          <p id="detail-desc" className={`detail-desc ${descExpanded ? 'expanded' : ''}`}>
            {item.longDescription}
          </p>
          <span id="desc-toggle" className="desc-toggle" onClick={() => setDescExpanded(!descExpanded)}>
            {descExpanded ? t.readLess : t.readMore}
          </span>
          {descExpanded && <div className="ing-inside-label">{t.ingredients}</div>}
          {descExpanded && <div className="ingredients-row" id="tags-row">
            {item.ingredients.map((ingItem, i) => {
              if (!emojiIndexMap[ingItem.emoji]) emojiIndexMap[ingItem.emoji] = 0;
              const colorOptions = colorMap[ingItem.emoji as keyof typeof colorMap] || [{ bg: 'rgba(212, 165, 116, 0.15)', border: '#D4A574', glow: 'rgba(212, 165, 116, 0.4)' }];
              const colors = colorOptions[emojiIndexMap[ingItem.emoji] % colorOptions.length];
              emojiIndexMap[ingItem.emoji]++;
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
          {descExpanded && item.allergens.length > 0 && (
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

        <div className="btn-row">
          <button className="btn btn-gold" onClick={addToCart}>
            <i className="fas fa-shopping-bag"></i> {t.addToCart}
          </button>
          {item.is4d && item.modelFolder ? (
            <button id="view-3d-btn" className="btn btn-cyan" onClick={goToViewer}>
              <i className="fas fa-cube"></i> {t.viewIn3D}
            </button>
          ) : (
            <button className="btn btn-cyan" style={{ opacity: 0.5, cursor: 'not-allowed' }} disabled>
              <i className="fas fa-cube"></i> {t.preview3dUnavailable}
            </button>
          )}
        </div>

        <div className="section-label" style={{ marginTop: '24px' }}>{t.customerReviews}</div>
        <div className="review-tabs">
          <button
            className={`review-tab-btn ${reviewTab === "rate" ? "active" : ""} ${reviewTab === "reviews" ? "tab-glow" : ""}`}
            onClick={() => setReviewTab("rate")}
          >
            ⭐ {t.tabRate}
          </button>
          <button
            className={`review-tab-btn ${reviewTab === "reviews" ? "active" : ""}`}
            onClick={() => setReviewTab("reviews")}
          >
            💬 {t.tabReviews} ({localReviews.length})
          </button>
        </div>

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

        {reviewTab === "reviews" && (
          <div className="reviews-section" id="reviews-section">
            {localReviews.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
                No reviews yet. Be the first to review!
              </p>
            ) : (
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
        
        {relatedItems.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>{t.youMightLike}</div>
            <div className="related-section" id="related-section">
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
        
        {(() => {
          if (!allItems.length || !item) return null;
          const navCat = fromCat || item.category;
          const siblings = navCat === "all" ? allItems : allItems.filter((it) => it.category === navCat);
          const idx = siblings.findIndex((it) => it.slug === item.slug);
          if (idx < 0) return null;
          // No wrap-around: hide the arrow when there's nothing before/after.
          const prev = idx > 0 ? siblings[idx - 1] : null;
          const next = idx < siblings.length - 1 ? siblings[idx + 1] : null;
          if (!prev && !next) return null;
          const catParam = navCat !== item.category ? `?cat=${navCat}` : "";
          return (
            <>
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

        <div className="btn-row" style={{ marginTop: '8px' }}>
          <button className="btn btn-secondary" onClick={goToMenu}>
            <i className="fas fa-arrow-left"></i> {t.backToMenu}
          </button>
        </div>
      </div>
    </div>
  );
}
