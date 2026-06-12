// "use client" means this whole page runs in the visitor's browser (not on the
// server). We need that because the menu is interactive: searching, filtering,
// remembering scroll position, reacting to taps — all live, in the browser.
"use client";

// React's built-in tools: useState (remember a value), useEffect (run code at
// certain times, like after the page appears), useRef (a value that survives
// re-draws without causing one).
import { useEffect, useRef, useState } from "react";
// Link = Next's fast, no-full-reload navigation between pages.
import Link from "next/link";
// AppShell = the shared outer frame/chrome around the menu content.
import AppShell from "@/components/AppShell";
// FoodCard = one dish tile in the list/grid.
import FoodCard from "@/components/FoodCard";
// HeroTitle = the big animated greeting at the top.
import HeroTitle from "@/components/HeroTitle";
// The 3D-model download manager (so models are ready before you open them).
import { modelLoader } from "@/lib/modelLoader";
// Our data layer: fetch the dishes + categories from the database, plus a
// helper to pick the right-language label, and the data "shapes" (types).
import {
  getMenuItems,
  getCategories,
  localized,
  type MenuItem,
  type Category,
} from "@/lib/menu";
// Language helpers: t = translated text strings; lang = the current language.
import { useTranslation, useLanguage } from "@/lib/i18n";
// Remembers the table number scanned from a QR code, for the cart/waiter.
import { setScannedTable } from "@/lib/table";

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

// Small helper: turn a dish's rating (stored as text) into a number so we can
// sort by it. If it's missing/garbled, treat it as 0.
const ratingOf = (it: FoodItem) => parseFloat(it.rating) || 0;

// This is the menu page, shown at "/menu". It's the main browsing screen.
export default function MenuPage() {
  const t = useTranslation();   // translated text for the current language
  const lang = useLanguage();   // which language is active right now
  // Each useState below is a piece of memory this page keeps. The first value
  // is the current value; the "set..." function changes it (and redraws).
  const [menuData, setMenuData] = useState<FoodItem[]>([]);        // all dishes
  const [dbCategories, setDbCategories] = useState<Category[]>([]); // all categories
  const [currentCategory, setCurrentCategory] = useState("");       // which tab is selected
  const [currentSort, setCurrentSort] = useState(""); // "" = recommended (menu order)
  const [currentDiet, setCurrentDiet] = useState(""); // "" | "veg" | "non-veg"
  const [layout, setLayout] = useState("gallery"); // gallery is the default first-visit view
  const [searchQuery, setSearchQuery] = useState(""); // what's typed in the search box
  const [favorites, setFavorites] = useState<string[]>([]); // dish ids the guest hearted
  const [closedCats, setClosedCats] = useState<string[]>([]); // "All" view: which dropdowns the guest manually FOLDED (default: none — everything starts open)
  const [spyCat, setSpyCat] = useState(""); // scroll-spy: which category's section is under the header right now (drives the auto-shifting chips)
  const restoredRef = useRef(false); // skip persisting UI state until after the restore
  // Only show skeletons if loading is actually slow — avoids a flash on fast /
  // cached loads where the data is ready almost immediately.
  const [showSkeleton, setShowSkeleton] = useState(false);

  // QR deep-link: a table's sticker opens /menu?table=N. Capture it once (also
  // accept ?t=N) so the cart + chef can pre-fill the table — the guest never
  // types it. Reading window.location avoids needing a useSearchParams Suspense
  // boundary. Stays editable downstream in case a sticker was mis-scanned.
  // This effect runs once, right after the page first appears (the empty []
  // at the end means "only on first load").
  useEffect(() => {
    try {
      // Read the bits after "?" in the web address.
      const params = new URLSearchParams(window.location.search);
      // Accept either ?table=5 or ?t=5.
      const raw = params.get("table") || params.get("t");
      // Keep only the digits (strip anything that isn't a number).
      const digits = (raw || "").replace(/\D/g, "");
      if (digits) {
        setScannedTable(digits);                                // remember it
        window.dispatchEvent(new Event("lfh:table-scanned"));   // tell the app
      }
    } catch {}  // if anything goes wrong, just carry on without a table number
  }, []);

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
  // Called when a guest taps a category tab.
  const selectCategory = (slug: string) => {
    setSearchQuery("");
    // Tapping the ALREADY-selected real category flips to the "All" view — every
    // category shown as a collapsible dropdown. Tapping a different category just
    // opens that one. Favorites / Chef's Special don't toggle to All (not groupable).
    const isRealCat = dbCategories.some((c) => c.slug === slug);
    setCurrentCategory((cur) => (cur === slug && isRealCat ? "all" : slug));
  };
  // In the "All" view every dropdown starts OPEN (browse everything at a glance);
  // this records which ones the guest folded shut (a slug in the list = closed).
  const toggleCatGroup = (slug: string) =>
    setClosedCats((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));
  // Sort DOES toggle: clicking the active sort returns to the recommended order.
  // (Tapping the already-active sort sets it back to "" = the default order.)
  const toggleSort = (slug: string) =>
    setCurrentSort((cur) => (cur === slug ? "" : slug));
  // Diet filter toggles too (veg / non-veg are mutually exclusive).
  const toggleDiet = (slug: string) =>
    setCurrentDiet((cur) => (cur === slug ? "" : slug));

  // Read the hearted dishes from localStorage (written by the dish detail page).
  // localStorage is the browser's little notebook that survives page reloads.
  const loadFavorites = () => {
    try {
      const raw = localStorage.getItem("lfh-favorites");
      const parsed = raw ? JSON.parse(raw) : [];
      setFavorites(Array.isArray(parsed) ? parsed : []);
    } catch { setFavorites([]); }
  };

  // The main "load everything" effect — runs once when the page first appears.
  // It fetches the dishes and categories, restores where you last were, and
  // starts listening for favorite changes.
  useEffect(() => {
    // Fetch all dishes from the database, then store them.
    getMenuItems()
      .then((items) => setMenuData(items))
      .catch((err) => console.error("Error loading menu data:", err));
    // Fetch all categories from the database.
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
          saved === "all" || saved === "chef-special" || saved === "favorites" || cats.some((c) => c.slug === saved);
        // New visitors land on the "All" view (every category as a folded dropdown);
        // returning visitors resume wherever they left off.
        setCurrentCategory((cur) => cur || (valid ? saved : "all"));
      })
      .catch((err) => console.error("Error loading categories:", err));

    // Restore the rest of the browse state so Back from a dish lands you exactly
    // where you left: view mode, sort, diet, search. (Category is handled above.)
    try {
      // Layout (list vs gallery) is a lasting PREFERENCE, so it lives in
      // localStorage and survives closing the browser (sessionStorage fallback
      // for anyone who set it under the old build).
      const sl = localStorage.getItem("lfh_menu_layout") ?? sessionStorage.getItem("lfh_menu_layout");
      if (sl === "list" || sl === "gallery") setLayout(sl);
      const ss = sessionStorage.getItem("lfh_menu_sort");
      if (ss !== null) setCurrentSort(ss);
      const sd = sessionStorage.getItem("lfh_menu_diet");
      if (sd !== null) setCurrentDiet(sd);
      const sq = sessionStorage.getItem("lfh_menu_search");
      if (sq) setSearchQuery(sq);
      // Which "All view" dropdowns the guest had manually folded — restored only
      // if saved less than 10 minutes ago. Any older and it's likely a NEW guest
      // at the table, so they get the default everything-open view instead.
      const cc = sessionStorage.getItem("lfh_menu_closed_cats");
      if (cc) {
        const parsed = JSON.parse(cc); // shape: { cats: ["coffee", ...], ts: when-it-was-saved }
        const freshEnough = Date.now() - (parsed?.ts || 0) <= 10 * 60 * 1000; // 10 minutes
        if (freshEnough && Array.isArray(parsed?.cats)) {
          setClosedCats(parsed.cats.filter((s: unknown): s is string => typeof s === "string"));
        }
      }
    } catch {}

    loadFavorites();  // load the hearted dishes for the Favorites tab
    // Keep favorites fresh if the guest hearts a dish in another tab/route.
    const onFav = () => loadFavorites();
    window.addEventListener("lfh:favorites-updated", onFav);  // same-tab signal
    window.addEventListener("storage", onFav);                // other-tab signal
    // The returned function is "cleanup": React runs it when leaving the page,
    // so we stop listening and don't leak. Here we remove both listeners.
    return () => {
      window.removeEventListener("lfh:favorites-updated", onFav);
      window.removeEventListener("storage", onFav);
    };
  }, []);

  // Persist the browse state so it survives a navigate-away + Back. Skip the
  // first run: on mount these still hold the defaults while the restore (above)
  // is being applied, so writing now would clobber the saved values with defaults.
  // This effect re-runs whenever layout/sort/diet/search/open-dropdowns change
  // (see the list at the bottom), saving the new values so Back returns you to them.
  useEffect(() => {
    // On the very first run, just mark "restored" and skip saving (see above).
    if (!restoredRef.current) { restoredRef.current = true; return; }
    try {
      localStorage.setItem("lfh_menu_layout", layout); // lasting preference (survives browser close)
      sessionStorage.setItem("lfh_menu_sort", currentSort);
      sessionStorage.setItem("lfh_menu_diet", currentDiet);
      sessionStorage.setItem("lfh_menu_search", searchQuery);
      // The manually-folded "All view" dropdowns, stamped with the time. The
      // restore above only trusts this for 10 minutes — after that it's ignored,
      // so a later guest starts with everything open again.
      sessionStorage.setItem("lfh_menu_closed_cats", JSON.stringify({ cats: closedCats, ts: Date.now() }));
    } catch {}
  }, [layout, currentSort, currentDiet, searchQuery, closedCats]);

  // If the data hasn't arrived within a moment, reveal the skeleton.
  // (Wait 200ms first; if it's still loading, show the grey placeholder boxes.
  // cleanup cancels that timer if we leave early.)
  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(true), 200);
    return () => clearTimeout(t);
  }, []);

  // Remember how far down the list the guest scrolled, so Back returns them to
  // the same spot instead of the top. The scroll lives on <main id="main-scroll">.
  const scrollRestored = useRef(false);  // have we already jumped back? (do it once)
  // This effect attaches a "listen for scrolling" handler when the page loads.
  useEffect(() => {
    const el = document.getElementById("main-scroll");  // the scrolling area
    if (!el) return;  // nothing to do if it isn't on the page
    let raf = 0;
    // SCROLL-SPY (Petpooja-style): work out which category section sits under
    // the sticky header right now. The chips highlight + follow automatically
    // (Coffee → Beverages → … as the guest scrolls the "All" view).
    const computeSpy = () => {
      const sections = el.querySelectorAll<HTMLElement>(".cat-group[data-cat]");
      if (!sections.length) return;
      const headerLine = 240; // a line just below the PINNED search/filter header (it ends ~222px down)
      let active = sections[0].dataset.cat || "";
      sections.forEach((s) => {
        // The LAST section whose top has crossed the line is the one in view.
        if (s.getBoundingClientRect().top <= headerLine) active = s.dataset.cat || active;
      });
      // Edge case: the FINAL section can be too short to ever cross the header
      // line — when the guest hits the very bottom, give it the highlight anyway.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
        active = sections[sections.length - 1].dataset.cat || active;
      }
      setSpyCat(active); // React skips the re-render when the value didn't change
    };
    // Runs every time the guest scrolls.
    const onScroll = () => {
      // Don't save on every single scroll tick — wait for the next animation
      // frame, so we save at most once per frame (gentler on performance).
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Remember how far down we are, in this browsing session.
        try { sessionStorage.setItem("lfh_menu_scroll", String(el.scrollTop)); } catch {}
        computeSpy();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Photos lazy-load and reshape the page WITHOUT firing a scroll event, which
    // would leave the spy pointing at the wrong section — so also re-check on a
    // gentle timer (the computation is a handful of rectangle reads, very cheap).
    const tick = setInterval(computeSpy, 600);
    // Cleanup: stop listening and cancel any pending save when leaving.
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); clearInterval(tick); };
  }, []);

  // When the spied category changes, slide BOTH category bars sideways so the
  // active chip stays in view (the big cards up top + the slim sticky strip) —
  // exactly how Petpooja's dine-in bar follows the guest.
  useEffect(() => {
    if (!spyCat) return;
    const pairs: Array<[string, string]> = [["cat-scroller", ".cat-card.active"], ["spy-strip", ".spy-chip.active"]];
    for (const [barId, sel] of pairs) {
      const bar = document.getElementById(barId);
      const chip = bar?.querySelector<HTMLElement>(sel);
      if (bar && chip) {
        // centre the active chip inside its bar (computed against the bar itself,
        // so this can never scroll the page vertically by accident)
        const left = chip.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
        bar.scrollTo({ left: left - bar.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
      }
    }
  }, [spyCat]);

  // Restore that scroll position once the list has actually painted.
  // Re-runs when menuData arrives; only does the jump one time.
  useEffect(() => {
    // Skip if we already jumped, or if the dishes aren't loaded yet.
    if (scrollRestored.current || !menuData.length) return;
    scrollRestored.current = true;  // mark done so we never jump twice
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
  // Re-runs whenever the selected category changes.
  useEffect(() => {
    if (!currentCategory) return;
    try {
      sessionStorage.setItem("lfh_menu_cat", currentCategory);
    } catch {}
  }, [currentCategory]);

  // This effect pre-downloads the small 3D models so the viewer opens fast.
  // Re-runs when the dishes load or the category changes.
  useEffect(() => {
    if (!menuData.length) return;  // wait until dishes have loaded

    // Only dishes that have a working 3D model (both file sizes present).
    const fourD = menuData.filter(
      (i) => i.is4d && i.modelSmallUrl && i.modelOptimizedUrl
    );

    // Dishes in the current category (preload first) vs. everything else. The "All"
    // view shows every category, so treat it like no filter — preload them all.
    const isAllView = !currentCategory || currentCategory === "all";
    const inCat = isAllView
      ? fourD
      : fourD.filter((i) => i.category === currentCategory);
    const outCat = isAllView
      ? []
      : fourD.filter((i) => i.category !== currentCategory);

    // For a dish: if the heavy model is already loaded, no need to fetch the
    // small one; otherwise give back the small model's address to download.
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
  // q = the search text, tidied up (no spaces, all lowercase) for comparing.
  const q = searchQuery.trim().toLowerCase();
  // Get a category's display name (in the current language), lowercased.
  const catNameOf = (slug: string) =>
    localized(dbCategories.find((c) => c.slug === slug)?.name, lang).toLowerCase();
  // True if a dish matches the search — by name, category slug, category name,
  // or a hidden search alias. (|| means "or".)
  const matchesSearch = (i: FoodItem) =>
    i.title.toLowerCase().includes(q) ||
    i.category.toLowerCase().includes(q) ||
    catNameOf(i.category).includes(q) ||
    (i.searchAlias || "").toLowerCase().includes(q);

  // Decide which dishes to show, given the search/category/diet choices.
  // .filter keeps only the dishes where this function returns true.
  const visibleItems = menuData.filter((item) => {
    // While searching, the list becomes a global "all view" (every category),
    // ignoring the selected category. Clear the search to fall back to it.
    if (q) {
      if (!matchesSearch(item)) return false;
    } else if (currentCategory === "favorites") {
      if (!favorites.includes(item.id)) return false;
    } else if (currentCategory === "chef-special") {
      if (!item.tags.includes("chef-special")) return false;
    } else if (currentCategory && currentCategory !== "all" && item.category !== currentCategory) {
      // In the "All" view we keep every category's dishes (they're grouped into
      // dropdowns below); only a specific category narrows down to itself.
      return false;
    }
    // Diet filter: hide non-veg when "veg" is on, and vice versa.
    if (currentDiet === "veg" && !item.veg) return false;
    if (currentDiet === "non-veg" && item.veg) return false;
    return true;  // passed every check — show this dish
  });

  // The search dropdown — top matches across all categories. Name-starts-with
  // first, then by rating. (Only built when there's something typed.)
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
  // [...visibleItems] makes a copy first so we don't reorder the original list.
  const filteredItems = [...visibleItems].sort((a, b) => {
    // Compare two dishes (a and b) based on the selected sort option.
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

  // For the "All" view: split the (already diet-filtered, sorted) dishes into one
  // group per real category, in the categories' own order, dropping any that end up
  // empty. Each group becomes a collapsible dropdown in the list below.
  const allGroups =
    currentCategory === "all" && !q
      ? dbCategories
          .map((c) => ({
            slug: c.slug,
            name: localized(c.name, lang),
            items: filteredItems.filter((it) => it.category === c.slug),
          }))
          .filter((g) => g.items.length > 0)
      : [];

  // Everything below is the actual on-screen layout (JSX = HTML-like markup).
  // Curly braces { } drop a value or a bit of logic into the markup.
  return (
    // AppShell = the shared outer frame (header, footer, etc.).
    <AppShell>
      {/* The scrolling content area. Its id is used to save/restore scroll. */}
      <main id="main-scroll">
        {/* The big animated greeting banner up top. */}
        <div className="hero">
          <HeroTitle greeting={t.greeting} title={t.heroTitle} />
        </div>

        {/* "Categories" heading plus a small "slide →" hint. */}
        <div className="section-header">
          <span className="section-title">{t.categories}</span>
          <span className="browse-hint" aria-hidden="true">
            {t.slide} <i className="fas fa-arrow-right"></i>
          </span>
        </div>
        {/* The horizontal row of category tabs. */}
        <div className="cat-scroller" id="cat-scroller" role="tablist" aria-label="Menu categories">
          {/* If categories haven't loaded yet, maybe show placeholders;
              otherwise draw a tab button for each category. */}
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
            : // .map turns each category into a tab button on screen.
              categories.map((cat) => (
                <button
                  key={cat.slug}
                  type="button"
                  role="tab"
                  // A card lights up when its category view is open, OR — in the
                  // "All" view — when the guest has SCROLLED into its section
                  // (the scroll-spy), so the bar follows them Petpooja-style.
                  aria-selected={cat.slug === currentCategory || (currentCategory === "all" && spyCat === cat.slug)}
                  className={`cat-card ${cat.slug === currentCategory || (currentCategory === "all" && spyCat === cat.slug) ? "active" : ""}`}
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

        {/* The sticky bar: search box on top, then the filter/sort/layout
            controls. It stays pinned as you scroll the dishes. */}
        <div className="items-header" id="sticky-header">
          <div className="search-container">
            {/* The little logo tucked inside the search box. */}
            <img
              className="search-logo"
              src="https://littlefrenchhouse.in/restaurant/wp-content/uploads/2021/01/LFH-Logo_200x200-e1612862168838.png"
              alt=""
              aria-hidden="true"
            />
            {/* The search box. value shows what's typed; onChange updates our
                searchQuery memory every keystroke. */}
            <input
              type="search"
              id="search-input"
              className="search-input"
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {/* When there are matches, show the dropdown of quick results.
                (&& means "only render this when the left side is true".) */}
            {searchResults.length > 0 && (
              <div className="search-dropdown" role="listbox">
                {/* One tappable result row per matching dish. Tapping it
                    opens the dish and clears the search. */}
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
          {/* The row of sort chips, diet chips, and the list/gallery toggle. */}
          <div className="header-controls">
            <div className="controls-group">
              <div className="filter-row" role="group" aria-label="Filter and sort dishes">
                {/* One chip per sort option (Popular / Top Rated / Low Price). */}
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
                {/* A thin divider between the sort chips and the diet chips. */}
                <span className="chip-divider" aria-hidden="true"></span>
                {/* One chip per diet option (Veg / Non-Veg). */}
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
              {/* The two-way switch between list view and gallery view. */}
              <div className="layout-switch" role="group" aria-label="Layout">
                {/* List view button. */}
                <button
                  type="button"
                  className={`switch-opt ${layout === "list" ? "active" : ""}`}
                  aria-pressed={layout === "list"}
                  aria-label="List view"
                  onClick={() => setLayout("list")}
                >
                  <i className="fas fa-list" aria-hidden="true"></i>
                </button>
                {/* Gallery (grid) view button. */}
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

          {/* Slim Petpooja-style category strip — always visible while scrolling
              (it lives inside this sticky header). Shows only in the "All" view:
              the active chip follows the scroll (see the scroll-spy above), and
              tapping a chip smooth-scrolls straight to that category's section. */}
          {currentCategory === "all" && !q && allGroups.length > 0 && (
            <div className="spy-strip" id="spy-strip" role="tablist" aria-label="Jump to category">
              {allGroups.map((g) => (
                <button
                  key={g.slug}
                  type="button"
                  role="tab"
                  aria-selected={spyCat === g.slug}
                  className={`spy-chip ${spyCat === g.slug ? "active" : ""}`}
                  onClick={() => {
                    // Manual jump (scrollIntoView ignores scroll-margin in this
                    // nested layout): land the section just below the pinned header.
                    const sc = document.getElementById("main-scroll");
                    const sec = sc?.querySelector(`.cat-group[data-cat="${g.slug}"]`);
                    if (sc && sec) {
                      // 235 = the pinned header's bottom edge measured from the
                      // scroll container's top (158px header + the app bar) + air.
                      const top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 235;
                      sc.scrollTo({ top, behavior: "smooth" });
                    }
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* The dishes. Three shapes:
            A) still loading            -> grey placeholder cards
            B) the "All" view           -> one collapsible dropdown PER category
            C) a single category/search -> the normal flat grid (with the
                                           Favorites-empty tip when relevant) */}
        {menuData.length === 0 ? (
          // A) loading skeleton
          <div className={`items-container ${layout === "gallery" ? "gallery-mode" : ""}`}>
            {showSkeleton
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
              : null}
          </div>
        ) : currentCategory === "all" && !q ? (
          // B) "All" view: each category is its own collapsible dropdown. The header
          // shows the name + dish count + a chevron; tapping it folds that category.
          // Every dropdown starts OPEN so guests see the whole menu at a glance;
          // closedCats records the ones they folded shut (remembered for 10 min).
          <div className="cat-groups">
            {allGroups.map((g) => {
              const open = !closedCats.includes(g.slug);
              return (
                // data-cat lets the scroll-spy + the jump-to-category chips find
                // this section; scroll-margin (CSS) keeps it clear of the header.
                <section key={g.slug} data-cat={g.slug} className="cat-group">
                  <button
                    type="button"
                    className="cat-group-head"
                    aria-expanded={open}
                    onClick={() => toggleCatGroup(g.slug)}
                  >
                    <span className="cat-group-title">
                      {g.name} <span className="cat-group-count">({g.items.length})</span>
                    </span>
                    <i
                      className={`fas fa-chevron-${open ? "up" : "down"} cat-group-chev`}
                      aria-hidden="true"
                    ></i>
                  </button>
                  {open && (
                    <div className={`items-container ${layout === "gallery" ? "gallery-mode" : ""}`}>
                      {g.items.map((item, index) => (
                        <FoodCard key={item.id} item={item} index={index} viewingCategory={g.slug} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          // C) single category / search / favorites — the normal flat grid.
          <div
            id="items-container"
            className={`items-container ${layout === "gallery" ? "gallery-mode" : ""}`}
          >
            {currentCategory === "favorites" && !q && filteredItems.length === 0 ? (
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
            ) : (
              // Normal case: one FoodCard tile per dish in the filtered list.
              filteredItems.map((item, index) => (
                <FoodCard key={item.id} item={item} index={index} viewingCategory={currentCategory} />
              ))
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}
