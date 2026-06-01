"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import FoodCard from "@/components/FoodCard";
import HeroTitle from "@/components/HeroTitle";
import { modelLoader } from "@/lib/modelLoader";
import {
  getMenuItems,
  getCategories,
  localized,
  type MenuItem,
  type Category,
} from "@/lib/menu";
import { useTranslation, useLanguage } from "@/lib/i18n";

// The card list works with the full MenuItem shape from the data layer.
type FoodItem = MenuItem;

// Sort options. Each re-orders the list rather than hiding dishes.
const SORTS = [
  { slug: "popular", label: "🔥 Popular" },
  { slug: "top-rated", label: "⭐ Top Rated" },
  { slug: "price", label: "💲 Low Price" },
];

// Veg / Non-Veg are FILTERS (show only matching), driven by the dish veg flag.
const DIETS = [
  { slug: "veg", label: "🌿 Veg" },
  { slug: "non-veg", label: "🍖 Non-Veg" },
];

const ratingOf = (it: FoodItem) => parseFloat(it.rating) || 0;

export default function MenuPage() {
  const t = useTranslation();
  const lang = useLanguage();
  const [menuData, setMenuData] = useState<FoodItem[]>([]);
  const [dbCategories, setDbCategories] = useState<Category[]>([]);
  const [currentCategory, setCurrentCategory] = useState("");
  const [currentSort, setCurrentSort] = useState(""); // "" = recommended (menu order)
  const [currentDiet, setCurrentDiet] = useState(""); // "" | "veg" | "non-veg"
  const [layout, setLayout] = useState("gallery"); // gallery is the default first-visit view
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]); // dish ids the guest hearted
  const restoredRef = useRef(false); // skip persisting UI state until after the restore
  // Only show skeletons if loading is actually slow — avoids a flash on fast /
  // cached loads where the data is ready almost immediately.
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Category bar — the DB categories, then a curated "Chef's Special" tab
  // (backed by the chef-special tag, not a real category), and a "Favorites"
  // tab LAST. One category is ALWAYS selected.
  const categories = [
    ...dbCategories.map((c) => ({
      slug: c.slug,
      name: localized(c.name, lang),
      icon: c.icon || "fa-utensils",
      color: c.color || "#d4a574",
    })),
    { slug: "chef-special", name: "Chef's Special", icon: "fa-star", color: "#e8b884" },
    { slug: "favorites", name: "Favorites", icon: "fa-heart", color: "#ef4444" },
  ];

  // A category is ALWAYS selected — clicking just switches, never clears.
  // Picking a category also clears any active search: search is a global "all
  // view", so clicking a category drops you straight into that category.
  const selectCategory = (slug: string) => {
    setCurrentCategory(slug);
    setSearchQuery("");
  };
  // Sort DOES toggle: clicking the active sort returns to the recommended order.
  const toggleSort = (slug: string) =>
    setCurrentSort((cur) => (cur === slug ? "" : slug));
  // Diet filter toggles too (veg / non-veg are mutually exclusive).
  const toggleDiet = (slug: string) =>
    setCurrentDiet((cur) => (cur === slug ? "" : slug));

  // Read the hearted dishes from localStorage (written by the dish detail page).
  const loadFavorites = () => {
    try {
      const raw = localStorage.getItem("lfh-favorites");
      const parsed = raw ? JSON.parse(raw) : [];
      setFavorites(Array.isArray(parsed) ? parsed : []);
    } catch { setFavorites([]); }
  };

  useEffect(() => {
    getMenuItems()
      .then((items) => setMenuData(items))
      .catch((err) => console.error("Error loading menu data:", err));
    getCategories()
      .then((cats) => {
        setDbCategories(cats);
        // Restore the last-viewed category (e.g. after pressing Back from a dish
        // page), otherwise default to the first one. One is always selected.
        let saved = "";
        try {
          saved = sessionStorage.getItem("lfh_menu_cat") || "";
        } catch {}
        const valid =
          saved === "chef-special" || saved === "favorites" || cats.some((c) => c.slug === saved);
        setCurrentCategory((cur) => cur || (valid ? saved : cats[0]?.slug || ""));
      })
      .catch((err) => console.error("Error loading categories:", err));

    // Restore the rest of the browse state so Back from a dish lands you exactly
    // where you left: view mode, sort, diet, search. (Category is handled above.)
    try {
      const sl = sessionStorage.getItem("lfh_menu_layout");
      if (sl === "list" || sl === "gallery") setLayout(sl);
      const ss = sessionStorage.getItem("lfh_menu_sort");
      if (ss !== null) setCurrentSort(ss);
      const sd = sessionStorage.getItem("lfh_menu_diet");
      if (sd !== null) setCurrentDiet(sd);
      const sq = sessionStorage.getItem("lfh_menu_search");
      if (sq) setSearchQuery(sq);
    } catch {}

    loadFavorites();
    // Keep favorites fresh if the guest hearts a dish in another tab/route.
    const onFav = () => loadFavorites();
    window.addEventListener("lfh:favorites-updated", onFav);
    window.addEventListener("storage", onFav);
    return () => {
      window.removeEventListener("lfh:favorites-updated", onFav);
      window.removeEventListener("storage", onFav);
    };
  }, []);

  // Persist the browse state so it survives a navigate-away + Back. Skip the
  // first run: on mount these still hold the defaults while the restore (above)
  // is being applied, so writing now would clobber the saved values with defaults.
  useEffect(() => {
    if (!restoredRef.current) { restoredRef.current = true; return; }
    try {
      sessionStorage.setItem("lfh_menu_layout", layout);
      sessionStorage.setItem("lfh_menu_sort", currentSort);
      sessionStorage.setItem("lfh_menu_diet", currentDiet);
      sessionStorage.setItem("lfh_menu_search", searchQuery);
    } catch {}
  }, [layout, currentSort, currentDiet, searchQuery]);

  // If the data hasn't arrived within a moment, reveal the skeleton.
  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(true), 200);
    return () => clearTimeout(t);
  }, []);

  // Remember how far down the list the guest scrolled, so Back returns them to
  // the same spot instead of the top. The scroll lives on <main id="main-scroll">.
  const scrollRestored = useRef(false);
  useEffect(() => {
    const el = document.getElementById("main-scroll");
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try { sessionStorage.setItem("lfh_menu_scroll", String(el.scrollTop)); } catch {}
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  // Restore that scroll position once the list has actually painted.
  useEffect(() => {
    if (scrollRestored.current || !menuData.length) return;
    scrollRestored.current = true;
    try {
      const y = parseInt(sessionStorage.getItem("lfh_menu_scroll") || "0", 10);
      if (y > 0) {
        const el = document.getElementById("main-scroll");
        // Two frames: let the cards lay out before we jump.
        requestAnimationFrame(() => requestAnimationFrame(() => { if (el) el.scrollTop = y; }));
      }
    } catch {}
  }, [menuData]);

  // Remember the active category so navigating away and Back returns you here.
  useEffect(() => {
    if (!currentCategory) return;
    try {
      sessionStorage.setItem("lfh_menu_cat", currentCategory);
    } catch {}
  }, [currentCategory]);

  useEffect(() => {
    if (!menuData.length) return;

    const fourD = menuData.filter(
      (i) => i.is4d && i.modelSmallUrl && i.modelOptimizedUrl
    );

    const inCat = !currentCategory
      ? fourD
      : fourD.filter((i) => i.category === currentCategory);
    const outCat = !currentCategory
      ? []
      : fourD.filter((i) => i.category !== currentCategory);

    const smallIfNeeded = (i: FoodItem) =>
      modelLoader.isLoaded(i.modelOptimizedUrl) ? null : i.modelSmallUrl!;

    // On the menu, preload only the SMALL (fast ~2MB) models. The heavy optimized
    // model is preloaded on the dish detail page instead (see ItemClient), so the
    // 3D view still opens instantly without the menu downloading ~9MB in the bg.
    modelLoader.setQueue(
      inCat.map(smallIfNeeded).filter((u): u is string => !!u),
      outCat.map(smallIfNeeded).filter((u): u is string => !!u),
      [],
      []
    );
  }, [menuData, currentCategory]);

  // Search matches the dish name OR its category (slug + translated name), so
  // typing "croissant" finds the croissant-category dishes even though their
  // display names don't contain the word.
  const q = searchQuery.trim().toLowerCase();
  const catNameOf = (slug: string) =>
    localized(dbCategories.find((c) => c.slug === slug)?.name, lang).toLowerCase();
  const matchesSearch = (i: FoodItem) =>
    i.title.toLowerCase().includes(q) ||
    i.category.toLowerCase().includes(q) ||
    catNameOf(i.category).includes(q) ||
    (i.searchAlias || "").toLowerCase().includes(q);

  const visibleItems = menuData.filter((item) => {
    // While searching, the list becomes a global "all view" (every category),
    // ignoring the selected category. Clear the search to fall back to it.
    if (q) {
      if (!matchesSearch(item)) return false;
    } else if (currentCategory === "favorites") {
      if (!favorites.includes(item.id)) return false;
    } else if (currentCategory === "chef-special") {
      if (!item.tags.includes("chef-special")) return false;
    } else if (currentCategory && item.category !== currentCategory) {
      return false;
    }
    if (currentDiet === "veg" && !item.veg) return false;
    if (currentDiet === "non-veg" && item.veg) return false;
    return true;
  });

  // The search dropdown — top matches across all categories. Name-starts-with
  // first, then by rating.
  const searchResults = q
    ? menuData
        .filter(matchesSearch)
        .sort((a, b) => {
          const aStarts = a.title.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.title.toLowerCase().startsWith(q) ? 0 : 1;
          return aStarts - bStarts || ratingOf(b) - ratingOf(a);
        })
        .slice(0, 8)
    : [];

  // Apply the chosen sort (a stable copy so the menu order stays the default).
  const filteredItems = [...visibleItems].sort((a, b) => {
    switch (currentSort) {
      case "popular": {
        const pa = a.tags.includes("bestseller") ? 1 : 0;
        const pb = b.tags.includes("bestseller") ? 1 : 0;
        return pb - pa || ratingOf(b) - ratingOf(a);
      }
      case "top-rated":
        return ratingOf(b) - ratingOf(a);
      case "price":
        return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
      default:
        return 0; // recommended = original menu order
    }
  });

  return (
    <AppShell>
      <main id="main-scroll">
        <div className="hero">
          <HeroTitle greeting={t.greeting} title={t.heroTitle} />
        </div>

        <div className="section-header">
          <span className="section-title">{t.categories}</span>
          <span className="browse-hint" aria-hidden="true">
            {t.slide} <i className="fas fa-arrow-right"></i>
          </span>
        </div>
        <div className="cat-scroller" id="cat-scroller" role="tablist" aria-label="Menu categories">
          {dbCategories.length === 0
            ? // Still loading: show empty placeholder boxes (only once it's clearly
              // slow — not the lone Chef's Special star, and not a flash when cached).
              (showSkeleton
                ? Array.from({ length: 8 }).map((_, i) => (
                    <div key={`skc-${i}`} className="cat-card cat-skeleton" aria-hidden="true">
                      <div className="cat-icon sk-cat-icon"></div>
                      <div className="cat-name sk-cat-name"></div>
                    </div>
                  ))
                : null)
            : categories.map((cat) => (
                <button
                  key={cat.slug}
                  type="button"
                  role="tab"
                  aria-selected={cat.slug === currentCategory}
                  className={`cat-card ${cat.slug === currentCategory ? "active" : ""}`}
                  style={{ ["--cat-color" as string]: cat.color }}
                  onClick={() => selectCategory(cat.slug)}
                >
                  <div className="cat-icon" aria-hidden="true">
                    <i className={`fas ${cat.icon}`}></i>
                  </div>
                  <div className="cat-name">{cat.name}</div>
                </button>
              ))}
        </div>

        <div className="items-header" id="sticky-header">
          <div className="search-container">
            <img
              className="search-logo"
              src="https://littlefrenchhouse.in/restaurant/wp-content/uploads/2021/01/LFH-Logo_200x200-e1612862168838.png"
              alt=""
              aria-hidden="true"
            />
            <input
              type="search"
              id="search-input"
              className="search-input"
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchResults.length > 0 && (
              <div className="search-dropdown" role="listbox">
                {searchResults.map((r) => (
                  <Link
                    key={r.id}
                    href={`/item/${r.slug}`}
                    className="search-result"
                    onClick={() => setSearchQuery("")}
                  >
                    <img className="search-result-img" src={r.image} alt="" loading="lazy" decoding="async" />
                    <span className="search-result-name">{r.title}</span>
                    <span className="search-result-cat">
                      {localized(dbCategories.find((c) => c.slug === r.category)?.name, lang) || r.category}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="header-controls">
            <div className="controls-group">
              <div className="filter-row" role="group" aria-label="Filter and sort dishes">
                {SORTS.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    className={`filter-chip ${currentSort === s.slug ? "active" : ""}`}
                    aria-pressed={currentSort === s.slug}
                    onClick={() => toggleSort(s.slug)}
                  >
                    {s.label}
                  </button>
                ))}
                <span className="chip-divider" aria-hidden="true"></span>
                {DIETS.map((d) => (
                  <button
                    key={d.slug}
                    type="button"
                    className={`filter-chip ${currentDiet === d.slug ? "active" : ""}`}
                    aria-pressed={currentDiet === d.slug}
                    onClick={() => toggleDiet(d.slug)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="layout-switch" role="group" aria-label="Layout">
                <button
                  type="button"
                  className={`switch-opt ${layout === "list" ? "active" : ""}`}
                  aria-pressed={layout === "list"}
                  aria-label="List view"
                  onClick={() => setLayout("list")}
                >
                  <i className="fas fa-list" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  className={`switch-opt ${layout === "gallery" ? "active" : ""}`}
                  aria-pressed={layout === "gallery"}
                  aria-label="Gallery view"
                  onClick={() => setLayout("gallery")}
                >
                  <i className="fas fa-th-large" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          id="items-container"
          className={`items-container ${layout === "gallery" ? "gallery-mode" : ""}`}
        >
          {menuData.length === 0
            ? (showSkeleton
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={`sk-${i}`} className="item-card skeleton-card" aria-hidden="true">
                      <div className="sk-thumb"></div>
                      <div className="sk-lines">
                        <div className="sk-line w70"></div>
                        <div className="sk-line w40"></div>
                        <div className="sk-line w50"></div>
                      </div>
                    </div>
                  ))
                : null)
            : currentCategory === "favorites" && !q && filteredItems.length === 0
            ? (
                <div className="fav-empty" role="status">
                  {/* Little how-to: a mock dish card with the heart pinned at its
                      top-right, so guests can SEE where to tap to favorite. */}
                  <div className="fav-howto" aria-hidden="true">
                    <div className="fav-howto-card">
                      <i className="fas fa-mug-saucer fav-howto-pic"></i>
                      <span className="fav-howto-heart"><i className="fas fa-heart"></i></span>
                    </div>
                    <span className="fav-howto-cue">tap to save</span>
                  </div>
                  <h3 className="fav-empty-title">No favorites yet</h3>
                  <p className="fav-empty-sub">
                    Open any dish, then tap the{" "}
                    <i className="fas fa-heart" aria-hidden="true"></i> at the{" "}
                    <b>top-right</b> — it stays saved here for next time.
                  </p>
                </div>
              )
            : filteredItems.map((item, index) => (
                <FoodCard key={item.id} item={item} index={index} viewingCategory={currentCategory} />
              ))}
        </div>
      </main>
    </AppShell>
  );
}
