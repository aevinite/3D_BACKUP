// "use client" means this whole page runs in the visitor's browser (not on the
// server). We need that because the menu is interactive: searching, filtering,
// remembering scroll position, reacting to taps — all live, in the browser.
"use client";

// React's built-in tools: useState (remember a value), useEffect (run code at
// certain times, like after the page appears), useRef (a value that survives
// re-draws without causing one).
import { useEffect, useRef, useState } from "react";
import { warmDataCache } from "@/lib/warmData";
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
  CARD_COLUMNS,
  getCategories,
  localized,
  type MenuCardItem,
  type Category,
} from "@/lib/menu";
// Language helpers: t = translated text strings; lang = the current language.
import { useTranslation, useLanguage } from "@/lib/i18n";
// Prices for the search suggestions (T1 improvement 5). Same helpers the dish cards use, so a
// suggestion and the card it points at can never quote different money.
import { formatPrice, getCurrency, DEFAULT_CURRENCY, type CurrencyMeta } from "@/lib/format";
// Remembers the table number scanned from a QR code, for the cart/waiter.
import { setScannedTable } from "@/lib/table";
import { tget } from "@/lib/tenantStorage";
// Per-restaurant feature switches (search/favorites/3D/scroll-spy on-off).
import { useFeatures, refreshFeatures, getFeatures } from "@/lib/features";
// Live updates: refetch the menu the instant the owner edits a dish / toggles a
// feature, without yanking the guest around.
import { useRealtime } from "@/lib/useRealtime";
// The default restaurant id, to keep restaurant #1's chrome byte-for-byte identical.
import { DEFAULT_RESTAURANT_ID, DEFAULT_RESTAURANT_SLUG } from "@/lib/tenant";
// The phone's BACK button. A search is something the diner OPENED, so back must close it before
// the app ever offers to leave the site — see the note at the call below.
import { useBackClose } from "@/lib/backStack";

// The card list works with the CARD shape — the full dish row minus the five detail-only fields the
// grid never reads (long description, nutrition, ingredients, reviews, related slugs). The cached
// endpoint stopped sending them, so saying MenuItem here would be the type promising data that is
// deliberately not on the wire. See lib/menu.ts -> MenuCardItem. (T1 improvement 9.)
type FoodItem = MenuCardItem;

// Sort options. Each re-orders the list rather than hiding dishes. ("Popular"
// was removed — owner's call; Chef's Special replaced it, but as a FILTER, not
// a sort, so it lives in the filter group below.)
const SORTS = [
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
// (The per-category ink helper that used to live here was removed on 2026-08-26 — see the note on
// the category chip below. With every chip on the restaurant's own theme colour there is exactly
// one ink to choose, and the stylesheet has always chosen it.)


// This is the menu page, shown at "/menu". It's the main browsing screen.
export default function MenuView({ restaurantId, restaurantSlug, restaurantName, logoText, heroTitle, tagline, accentColor, theme, logoUrl, qrTable, defaultLayout }: { restaurantId: string; restaurantSlug?: string; restaurantName?: string; logoText?: string; heroTitle?: string; tagline?: string; accentColor?: string; theme?: Record<string, unknown>; logoUrl?: string; qrTable?: string; /* Access → Menu → Format → Default layout: what a first-time guest sees. Resolved on
      the server so there is no flash of the wrong layout. */ defaultLayout?: "gallery" | "list" }) {
  // Restaurant #1 keeps its exact current chrome (localized hero, hardcoded
  // wordmark, theme accent); other restaurants get their own brand.
  const isDefault = restaurantId === DEFAULT_RESTAURANT_ID;
  // Dish links stay inside this restaurant when we're on /r/<slug>/menu; the default
  // menu passes no slug, so links stay global (/item/...) — unchanged for #1.
  const itemBase = restaurantSlug ? `/r/${restaurantSlug}` : "";
  // Browse-state (search / diet / sort / scroll / folded categories) is scoped
  // PER restaurant so it can't follow the guest to another restaurant in the same
  // tab (which made the next restaurant open pre-filtered or "no results" — audit
  // fix 2026-07-06). `layout` (list vs gallery) stays unscoped on purpose: it's a
  // device-wide display preference, harmless to carry across restaurants.
  const sk = (base: string) => `${base}:${restaurantSlug || DEFAULT_RESTAURANT_SLUG}`;
  const t = useTranslation();   // translated text for the current language
  const lang = useLanguage();   // which language is active right now
  const features = useFeatures(restaurantId); // this restaurant's switched-on features
  // Each useState below is a piece of memory this page keeps. The first value
  // is the current value; the "set..." function changes it (and redraws).
  const [menuData, setMenuData] = useState<FoodItem[]>([]);        // all dishes
  const [loaded, setLoaded] = useState(false); // true once a menu fetch has RESOLVED — lets us tell "still loading" from "loaded but empty" (bug G2, 2026-07-05)
  const [dbCategories, setDbCategories] = useState<Category[]>([]); // all categories
  const [currentCategory, setCurrentCategory] = useState("all");    // ALWAYS "all" now — categories only scroll, never narrow the view
  const [currentSort, setCurrentSort] = useState(""); // "" = recommended (menu order)
  const [currentDiet, setCurrentDiet] = useState(""); // "" | "veg" | "non-veg"
  const [chefOnly, setChefOnly] = useState(false); // Chef's Special filter (dishes tagged "chef-special")
  const [favOnly, setFavOnly] = useState(false);   // Favorites filter (the guest's hearted dishes)
  // The FIRST-visit view is a per-restaurant setting (Access → Menu → Format → Default
  // layout). The guest can still switch, and their choice is restored below — this is only
  // what they see before they choose anything.
  const [layout, setLayout] = useState(defaultLayout || "gallery");
  const [searchQuery, setSearchQuery] = useState(""); // what's typed in the search box
  const [favorites, setFavorites] = useState<string[]>([]); // dish ids the guest hearted
  const [closedCats, setClosedCats] = useState<string[]>([]); // "All" view: which dropdowns the guest manually FOLDED (default: none — everything starts open)
  const [spyCat, setSpyCat] = useState(""); // scroll-spy: which category's section is under the header right now (drives the auto-shifting chips)
  // When the guest TAPS a category we lock the scroll-spy briefly so its live
  // reading during the smooth-scroll (the bar shrinks mid-scroll, nudging the
  // section below the spy line) can't repaint a DIFFERENT chip than the one
  // tapped — the highlight now always matches the tap (audit fix bug #11).
  const spyLockUntil = useRef(0);
  const restoredRef = useRef(false); // skip persisting UI state until after the restore
  // Monotonic request counter so an OLDER refreshMenu() response can never overwrite
  // a NEWER one. realtime nudges can fire refreshMenu() while a previous fetch is
  // still in flight; without this an out-of-order reply would clobber fresh data.
  const menuReqRef = useRef(0);
  // Only show skeletons if loading is actually slow — avoids a flash on fast /
  // cached loads where the data is ready almost immediately.
  const [showSkeleton, setShowSkeleton] = useState(false);
  // The currency the search suggestions price in. Mirrors FoodCard: read once on mount, then
  // follow the `lfh:currency-changed` broadcast, so switching currency re-prices the dropdown
  // at the same moment it re-prices the cards behind it.
  const [searchCurrency, setSearchCurrency] = useState<CurrencyMeta | null>(null);
  useEffect(() => {
    setSearchCurrency(getCurrency());
    const onCur = () => setSearchCurrency(getCurrency());
    window.addEventListener("lfh:currency-changed", onCur);
    return () => window.removeEventListener("lfh:currency-changed", onCur);
  }, []);

  // QR deep-link: a table's sticker opens /menu?table=N. Capture it once (also
  // accept ?t=N) so the cart + chef can pre-fill the table — the guest never
  // types it. Reading window.location avoids needing a useSearchParams Suspense
  // boundary. Stays editable downstream in case a sticker was mis-scanned.
  // This effect runs once, right after the page first appears (the empty []
  // at the end means "only on first load").
  useEffect(() => {
    try {
      // A /q/<code> page already resolved the table SERVER-SIDE from the private
      // code (mig 210) — use that and skip the URL entirely (there's no ?table= to
      // read, and none for a guest to edit).
      const raw = qrTable || (() => {
        // Read the bits after "?" in the web address.
        const params = new URLSearchParams(window.location.search);
        // Accept either ?table=5 or ?t=5.
        return params.get("table") || params.get("t");
      })();
      // Keep only the digits (strip anything that isn't a number).
      const digits = (raw || "").replace(/\D/g, "");
      if (digits) {
        setScannedTable(digits);                                // remember it
        window.dispatchEvent(new Event("lfh:table-scanned"));   // tell the app
        // ── AND THE NUMBER LEAVES THE ADDRESS BAR (owner, 2026-08-30) ─────────────────────────
        // His words: *"instead of numbers for table, do you use some kind of code right? Because
        // people can't able to change the table number from top just by changing the URL."*
        //
        // The answer is the `/q/<code>` door (mig 210), and it is what every QR this app generates
        // has encoded since — `components/admin/RestaurantSettings.tsx` builds `/q/<code>` and
        // nothing builds `?table=N` any more. On that door the number never appears in the address
        // bar at all, which is exactly what he is describing.
        //
        // These two OLDER doors — `/menu?table=N` and `/r/<slug>/menu?table=N` — are kept alive only
        // so a laminated sticker printed before mig 210 keeps working. So the number is read ONCE
        // and then wiped out of the address, which leaves nothing on screen to edit and no
        // ?table= to share by accident. The stored value is what the app uses from here on.
        //
        // WHY NOT REDIRECT TO `/q/<code>` INSTEAD, which was the obvious idea: the code is a
        // PRIVATE random string (mig 210's own words). A route that turned "table 7" into "table 7's
        // code" would let anyone learn every table's private code by walking 1…30 — trading a
        // guessable number for a harvestable secret. Strictly worse.
        //
        // AND IT IS NOT A GATE, WHICH MATTERS MORE THAN THE TIDINESS. A diner can still name a table
        // by TYPING it (SessionGate's `ask_table` step) — the address bar was never the only way. What
        // actually protects a table that already has a party is the session: `lfh_join_session` makes
        // a second arrival a `guest` whose `approved` comes from `sessions.auto_approve`, which
        // migration 018 set to DEFAULT FALSE — so the head has to let them in — and
        // `lib/tableConnection.ts` refuses to add to the basket until they are approved. On top of
        // that `lfh_geo_ok` refuses anyone outside the restaurant's radius once its coordinates are
        // set. Removing the number from the URL removes a duplicate way in; those two are the guard.
        //
        // `replaceState`, never `pushState`: the back button must not walk the diner through a
        // history entry that puts the number back.
        try {
          if (!qrTable && window.location.search) {
            const url = new URL(window.location.href);
            if (url.searchParams.has("table") || url.searchParams.has("t")) {
              url.searchParams.delete("table");
              url.searchParams.delete("t");
              const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
              // Spread the existing state so Next's own router bookkeeping survives — the same rule
              // lib/backStack.ts records for its synthetic entries.
              history.replaceState({ ...(history.state as object) }, "", clean);
            }
          }
        } catch {}
      }
    } catch {}  // if anything goes wrong, just carry on without a table number
  }, [qrTable]);

  // Category bar — ONLY the real food categories (Chef's Special + Favorites
  // moved into the filter row as tag/heart filters; they're no longer tabs).
  const categories = dbCategories.map((c) => ({
    slug: c.slug,
    name: localized(c.name, lang),
    icon: c.icon || "fa-utensils",
  }));

  // Tapping a category NEVER narrows the menu — it always keeps the full grouped
  // "all" view and smooth-scrolls to that category's section. If a search was
  // active we clear it first (so the grouped menu is back), then scroll once the
  // section has painted.
  // `retry` counts the filter-clearing recovery below, so it can never loop forever. It is a
  // PARAMETER rather than a ref because the recovery re-calls this function from a setTimeout,
  // which keeps THIS render's closure — see the note at the recovery itself.
  const scrollToCategory = (slug: string, retry = 0) => {
    const wasSearching = !!q;
    if (wasSearching) setSearchQuery("");
    setCurrentCategory("all");
    // If the guest had folded this category, expand it — otherwise the tap scrolls
    // to a collapsed header showing no dishes and looks like it "did nothing".
    setClosedCats((cur) => cur.filter((s) => s !== slug));
    // Highlight the tapped chip right away and lock the spy so it can't override
    // it while the smooth-scroll + the shrink-correction below settle (bug #11).
    setSpyCat(slug);
    spyLockUntil.current = Date.now() + 1300;
    const doScroll = () => {
      const sc = document.getElementById("main-scroll");
      const sec = sc?.querySelector(`.cat-group[data-cat="${slug}"]`);
      // If a filter has emptied this category (its section isn't in the grouped
      // view), don't leave the guest with a dead tap — clear the filters so the
      // full grouped menu is back, then scroll to it on the next paint (bug #12).
      if (sc && !sec) {
        // COUNT THE RETRIES. The timeout below re-enters this function with THIS render's closure,
        // so `chefActive` / `favActive` / `dietActive` / `currentSort` still read their pre-clear
        // values however many times we come back — the guard can never turn itself off. Without a
        // count that is an unbounded 80ms loop of setState no-ops for as long as the guest stays on
        // the page, if the section never appears. The correction loop just below has always been
        // capped (`tries >= 8`); this one was not. (Guest sweep T1, 2026-08-12.)
        //
        // 3 is plenty: one clear plus a paint is all this recovery has ever needed. After that the
        // honest answer is to stop — the chip stays highlighted and the menu stays where it is,
        // which is a no-op, not a broken screen.
        if (retry < 3 && (chefActive || favActive || dietActive || currentSort)) {
          setChefOnly(false); setFavOnly(false); setCurrentDiet(""); setCurrentSort("");
          setTimeout(() => scrollToCategory(slug, retry + 1), 80);
        }
        return;
      }
      if (!sc || !sec) return;
      // Where the section should sit: just below the pinned bar, measured LIVE
      // each time (the bar height changes as it shrinks).
      const wantTop = () => {
        const bb = document.getElementById("menu-sticky")?.getBoundingClientRect().bottom ?? 220;
        return sc.scrollTop + (sec.getBoundingClientRect().top - (bb + 12));
      };
      sc.scrollTo({ top: wantTop(), behavior: "smooth" });
      // ROOT-CAUSE FIX (bug #11): the pinned header shrinks ~140px WHILE this
      // smooth-scroll runs, so a first tap from the top landed the section ~140px
      // too low and the spy highlighted the category above it (it only self-fixed
      // on a 2nd tap). After the shrink settles, re-measure and snap-correct until
      // the section is within a few px of the bar — so the FIRST tap lands right.
      let tries = 0;
      const correct = () => {
        if (tries >= 8) return;
        const want = wantTop();
        if (Math.abs(want - sc.scrollTop) > 4) {
          sc.scrollTo({ top: want, behavior: "auto" });
          tries++;
          setTimeout(correct, 70);
        }
      };
      setTimeout(correct, 360);
    };
    // If we just cleared a search, the grouped view needs a paint first.
    if (wasSearching) setTimeout(doScroll, 80);
    else requestAnimationFrame(doScroll);
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
      const raw = tget("lfh-favorites");
      const parsed = raw ? JSON.parse(raw) : [];
      setFavorites(Array.isArray(parsed) ? parsed : []);
    } catch { setFavorites([]); }
  };

  // Re-fetch dishes + categories and store them. Used on first mount AND by the
  // live updater below. The render keys dishes by id, so re-setting this state
  // doesn't jump the scroll — a sold-out dish just flips its badge in place.
  //
  // EGRESS WIN (the #1 scaling-cost lever): instead of every guest's browser
  // reading the SHARED menu straight from Supabase, we fetch ONE server endpoint
  // (/api/r/<slug>/menu-data) whose data is cached server-side per restaurant for
  // 120s (and busted instantly when the owner edits — see lib/menuDataServer.ts +
  // the editor route). So repeat guest views read from the cache, not the DB. If
  // that endpoint ever fails (or there's no slug), we fall back to the original
  // direct reads so the menu can never go blank.
  const refreshMenu = () => {
    const seq = ++menuReqRef.current; // tag this refresh; only the latest may apply
    const applyDirect = () => {
      getMenuItems(restaurantId, CARD_COLUMNS) // grid fallback needs only card fields (egress)
        .then((items) => { if (seq === menuReqRef.current) { setMenuData(items); setLoaded(true); } }) // drop stale replies
        .catch((err) => { console.error("Error loading menu data:", err); if (seq === menuReqRef.current) setLoaded(true); });
      // The menu is ALWAYS the full "all" view now — tapping a category just scrolls
      // to its section, it never narrows. So there's no per-category state to restore.
      getCategories(restaurantId)
        .then((cats) => { if (seq === menuReqRef.current) setDbCategories(cats); }) // drop stale replies
        .catch((err) => console.error("Error loading categories:", err));
    };
    if (!restaurantSlug) { applyDirect(); return; } // legacy callers w/o a slug
    // Cache-busting query so the BROWSER never holds a stale copy — the dedup we
    // want is the SERVER data cache inside the endpoint, not an HTTP cache.
    fetch(`/api/r/${restaurantSlug}/menu-data`, { cache: "no-store" })
      .then((res) => {
        // A 404 here means the restaurant was DEACTIVATED / deleted while this tab
        // was open. Do NOT fall back to a direct DB read (that bypasses the active
        // check and keeps serving the menu — audit fix 2026-07-06); reload so the
        // server's notFound() shows the proper "not available" page instead.
        if (res.status === 404) { if (seq === menuReqRef.current) window.location.reload(); throw new Error("menu-data 404 (deactivated)"); }
        if (!res.ok) throw new Error(`menu-data ${res.status}`);
        return res.json();
      })
      .then((bundle: { items?: FoodItem[]; categories?: Category[] }) => {
        if (seq !== menuReqRef.current) return; // drop stale replies
        if (Array.isArray(bundle.items)) setMenuData(bundle.items);
        if (Array.isArray(bundle.categories)) setDbCategories(bundle.categories);
        setLoaded(true); // fetch resolved — even 0 items now shows an empty state, not endless skeletons
        // HAND THIS READ TO THE OFFLINE LAYER. On a FIRST visit the service worker does not control
        // the page yet when the fetch above fires, so it never saw the reply — and an offline reload
        // showed a perfectly styled menu with no dishes on it (measured, 2026-08-07). We already
        // have the payload, so give it to the worker rather than making it fetch the menu again:
        // no extra request, no extra bytes. It refuses anything it has already stored.
        warmDataCache(`/api/r/${restaurantSlug}/menu-data`, bundle);
      })
      // Only a genuine network/5xx failure reaches here → safe to fall back to a
      // direct read so a blip can't blank the menu. (The 404 case rethrows above
      // but has already triggered the reload, so applyDirect won't re-serve it.)
      .catch((err) => {
        if (String(err?.message || "").includes("404")) return; // deactivated — reload already fired
        console.error("Error loading menu data (cached endpoint):", err); applyDirect();
      });
  };

  // Live: when the owner edits the menu (dish/price/sold-out/category) or flips a
  // feature in admin, refetch gently within ~1s. Guests subscribe to the 'menu'
  // topic only — never the staff order firehose.
  //
  // THIS IS ALSO THE FIRST LOAD. useRealtime ends its mount effect with
  // `topics.forEach(run)` — "initial load — fire IMMEDIATELY" — so this handler runs once
  // synchronously on mount, before any breadcrumb arrives. The effect below used to call
  // refreshMenu() as well, and neither knew about the other: EVERY guest menu load fetched
  // /api/r/<slug>/menu-data TWICE (measured on the deployed site, 2 page requests, 39.6 KB
  // each on restaurant #1) and refreshed the feature switches twice. `menuReqRef` dropped
  // the older reply so nothing ever looked wrong — it was pure waste, on the one read this
  // project calls "the #1 scaling-cost lever" (guest sweep T1, 2026-08-06).
  //
  // Ordering is what makes ONE call safe: this hook is declared ABOVE the effect below, and
  // React runs mount effects in declaration order, so the fetch still starts at exactly the
  // same moment it did before. If you ever move this call, move the fetch with it.
  useRealtime({ menu: () => { refreshMenu(); refreshFeatures(restaurantId); } }, restaurantId);

  // The main "load everything" effect — runs once when the page first appears.
  // It restores where you last were and starts listening for favorite changes.
  // The dishes/categories fetch belongs to the hook above — see the note there.
  useEffect(() => {
    // Restore the rest of the browse state so Back from a dish lands you exactly
    // where you left: view mode, sort, diet, search. (Category is handled above.)
    try {
      // Layout (list vs gallery) is a lasting PREFERENCE, so it lives in
      // localStorage and survives closing the browser (sessionStorage fallback
      // for anyone who set it under the old build).
      // I11 — THE FIRST PERSON SEES THE RESTAURANT'S CHOICE; AFTER THAT IT IS THEIRS (owner,
      // 2026-08-12: *"the first person who was new, what he will see — it's the restaurant dependent;
      // after the first person has came, then it will be person dependent"*, remembered per phone AND
      // per restaurant).
      //
      // This key used to be GLOBAL, so a diner who once chose the gallery at restaurant A overrode
      // restaurant B's "list" default for ever — B could never show a first-timer what it had
      // configured. It is now scoped with sk(), exactly like sort / diet / search / folded categories,
      // so: nothing saved for THIS restaurant → the restaurant's own Access → Menu → Default layout
      // (the `defaultLayout` prop this component starts from); once the guest taps list or gallery
      // here, their pick wins on this phone at this restaurant.
      //
      // The old global value is read as a LAST resort so a returning guest is not visibly reset the
      // first time they come back after this change; the moment they touch the switch it is saved
      // scoped and the global one stops mattering.
      const sl = localStorage.getItem(sk("lfh_menu_layout"))
        ?? sessionStorage.getItem(sk("lfh_menu_layout"))
        ?? localStorage.getItem("lfh_menu_layout")
        ?? sessionStorage.getItem("lfh_menu_layout");
      if (sl === "list" || sl === "gallery") setLayout(sl);
      const ss = sessionStorage.getItem(sk("lfh_menu_sort"));
      if (ss !== null) setCurrentSort(ss);
      const sd = sessionStorage.getItem(sk("lfh_menu_diet"));
      if (sd !== null) setCurrentDiet(sd);
      const sq = sessionStorage.getItem(sk("lfh_menu_search"));
      if (sq) setSearchQuery(sq);
      // Chef's Special / Favorites filters are remembered too. They were dropped on
      // Back before, so a filtered guest returned to the FULL list and the saved
      // scroll then landed on the wrong dish (audit fix 2026-07-08).
      if (sessionStorage.getItem(sk("lfh_menu_chef")) === "1") setChefOnly(true);
      if (sessionStorage.getItem(sk("lfh_menu_fav")) === "1") setFavOnly(true);
      // Which "All view" dropdowns the guest had manually folded — restored only
      // if saved less than 10 minutes ago. Any older and it's likely a NEW guest
      // at the table, so they get the default everything-open view instead.
      const cc = sessionStorage.getItem(sk("lfh_menu_closed_cats"));
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
      // Scoped per restaurant (see the restore above) and still a LASTING preference — localStorage,
      // so it survives closing the browser, unlike the session-scoped browse state beside it.
      localStorage.setItem(sk("lfh_menu_layout"), layout);
      sessionStorage.setItem(sk("lfh_menu_sort"), currentSort);
      sessionStorage.setItem(sk("lfh_menu_diet"), currentDiet);
      sessionStorage.setItem(sk("lfh_menu_search"), searchQuery);
      sessionStorage.setItem(sk("lfh_menu_chef"), chefOnly ? "1" : "0");
      sessionStorage.setItem(sk("lfh_menu_fav"), favOnly ? "1" : "0");
      // The manually-folded "All view" dropdowns, stamped with the time. The
      // restore above only trusts this for 10 minutes — after that it's ignored,
      // so a later guest starts with everything open again.
      sessionStorage.setItem(sk("lfh_menu_closed_cats"), JSON.stringify({ cats: closedCats, ts: Date.now() }));
    } catch {}
  }, [layout, currentSort, currentDiet, searchQuery, closedCats, chefOnly, favOnly]);

  // THE FILTER CHIPS' "there's more this way" CUE.
  // The row has always scrolled sideways, but on the owner's 360px phone the third chip
  // was sliced down the middle by the layout switch and the rest (Top Rated, Low Price,
  // Veg, Non-Veg) sat past a hard cut with no hint they existed — so the veg filter was
  // effectively unreachable on a phone (guest sweep 2026-08-04). This stamps
  // data-can-scroll="1" only while there IS more to the right, which is what draws the
  // fade in globals.css. Dropping it at the end keeps the last chip crisp.
  // Measured, not assumed: it reads the real box, so it stays correct for any language's
  // chip widths and any set of switched-on chips.
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(".filter-row");
    if (!row) return;
    const sync = () => {
      const more = row.scrollWidth - row.clientWidth - row.scrollLeft > 4;
      row.setAttribute("data-can-scroll", more ? "1" : "0");
    };
    sync();
    row.addEventListener("scroll", sync, { passive: true });
    // The chip set changes with the switches, and the widths change with the language,
    // so watch the box itself rather than guessing when to re-measure.
    let ro: ResizeObserver | undefined;
    try {
      ro = new ResizeObserver(sync);
      ro.observe(row);
      for (const c of Array.from(row.children)) ro.observe(c);
    } catch {}
    window.addEventListener("resize", sync);
    return () => {
      row.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
    // Re-attach when the row is rebuilt (a search hides it) or its chips change.
    // `searchQuery`, not the folded `q` — `q` is derived further down the component, so
    // naming it here would read a const before it is initialised and crash the render.
  }, [searchQuery, features.favorites, features.diet_filter, loaded, menuData.length]);

  // I3 — "THERE ARE MORE SUGGESTIONS THAN YOU CAN SEE" (T1 improvement 3, 2026-08-12).
  // Up to 8 suggestions are built, but the panel is max-height 340px — about five and a half rows on
  // a 360px phone. It scrolls, so nothing is unreachable; the problem is that the only hint was a
  // half-cut sixth row, and a diner hunting a price stops at what they can see. This stamps
  // data-can-scroll="1" while there IS more below, which is what draws the fade in globals.css —
  // the SAME cue, measured the same way, as the filter chip row above. Deliberately no counter text:
  // that would need a new word in six languages to say something a fade already says.
  useEffect(() => {
    const box = document.querySelector<HTMLElement>(".search-dropdown");
    if (!box) return;
    const sync = () => {
      const more = box.scrollHeight - box.clientHeight - box.scrollTop > 4;
      box.setAttribute("data-can-scroll", more ? "1" : "0");
    };
    sync();
    box.addEventListener("scroll", sync, { passive: true });
    let ro: ResizeObserver | undefined;
    try { ro = new ResizeObserver(sync); ro.observe(box); } catch {}
    return () => { box.removeEventListener("scroll", sync); ro?.disconnect(); };
    // `searchQuery`, NOT `searchResults` — the results list is derived further down this component,
    // so naming it here would read a const before it is initialised and crash the render. Same trap,
    // same answer, as the filter-row effect above. A new query is what rebuilds the rows anyway, and
    // the ResizeObserver catches the rest.
  }, [searchQuery]);

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
  // …and has that jump SETTLED? Saving the scroll position must not start until it has, or the
  // mount-time onScroll() below writes a 0 straight over the place we are about to return to.
  // (Guest sweep T1, sweep #7, 2026-08-22 — see both notes below.)
  const restoreSettled = useRef(false);
  // This effect attaches a "listen for scrolling" handler when the page loads.
  useEffect(() => {
    const el = document.getElementById("main-scroll");  // the scrolling area
    if (!el) return;  // nothing to do if it isn't on the page
    // On the menu, the brand loses its OWN blur and shares the single frost panel
    // (see .menu-headfrost / body.menu-frost in CSS) — that's what merges the
    // brand with the category bar seamlessly. Removed again on cleanup so other
    // pages keep the brand's normal frosted bar.
    document.body.classList.add("menu-frost");
    let raf = 0;
    // While the guest is scrolling, mark the body so the floating call-waiter bell steps
    // aside (see body.menu-scrolling in globals.css). On a phone the bell floats exactly
    // where each card pins its add button, so it was covering the control the guest was
    // scrolling towards. The flag clears ~450ms after the last scroll tick.
    //
    // THAT ALONE WAS NOT ENOUGH, and the sweep measured why (T16, 2026-08-05, on the deployed
    // site which already had the stepping-aside above): the class only applies WHILE scrolling,
    // and it moves the bell DOWN 26px — so at rest the bell returns to the corner, and even
    // mid-scroll a ~12px band still overlapped the button while the bell kept its own
    // pointer-events. A hit-test at the bell's centre returned the bell, not the button, on BOTH
    // restaurants at 360x780: tapping "+" on the right-hand dish rang for a waiter instead of
    // adding the dish. Desktop was clean — it is a narrow-viewport fault only.
    //
    // So the resting position is now decided by MEASUREMENT rather than by a fixed offset that
    // hopes to miss. After scrolling settles we ask the page what is actually under the bell's
    // centre; if it is something tappable, the bell is lifted just clear of it. Nothing under it
    // → no lift at all, so the owner's chosen floating-bell look is untouched (and desktop never
    // moves). Lifting UP is the safe direction: a card pins its controls to its own BOTTOM, so
    // the space directly above one is that card's picture, never another control.
    let scrollIdle: ReturnType<typeof setTimeout> | undefined;
    const BELL_MAX_LIFT = 260; // a sanity cap, so a surprising layout can never fling it away.
    // Deliberately BOX INTERSECTION, not elementFromPoint. The first attempt at this probed the
    // bell's centre point and always came back with the bell's own <i> icon — whose nearest
    // button/anchor ancestor is null, because the bell is a div — so it read "nothing underneath"
    // and never lifted. Rectangles have no such blind spot, and they also catch a PARTIAL overlap,
    // which a single centre probe misses entirely.
    //
    // WHAT COUNTS AS SOMETHING TO CLEAR, and why the size test had to go.
    // It used to be "anything tappable up to 96px", which let the bell treat a full-width control
    // as thin air. So the lift walked upward clearing the dish's "+" and its favourite button, ran
    // out of room at 256px of its 260px cap, and PARKED ON `.cat-group-head` — the button that
    // folds a category. Measured on the deployed site at 360×780, both restaurants: the bell's box
    // overlapped "Coffee (6)" by 48px, elementFromPoint in that overlap returned the bell, and an
    // ordinary tap there rang for a waiter while the category stayed open (guest sweep T1,
    // 2026-08-06). One tap-theft had been traded for another.
    //
    // The only thing the old size test was really trying to exclude is the WHOLE-CARD LINK — a
    // 160×261 <a> that covers the entire tile. A floating button overlapping part of a picture is
    // what floating buttons do; overlapping a CONTROL is what steals a tap. So exclude that link by
    // what it IS, and treat every other control as real, whatever its width.
    const isCardLink = (el: HTMLElement) => el.classList.contains("item-card-link");
    // Every control's box, read in ONE pass. The candidate lifts below are then pure arithmetic
    // against this array — no second layout read — so scanning many positions costs no more than
    // the single check did.
    // ONLY MEASURE WHAT IS NEAR THE BELL (T1 improvement 10, 2026-08-12).
    //
    // This used to read a rectangle for EVERY button and link in the document, and settleBell() runs
    // it on the 600ms tick. On Aangan's 199-dish menu that is 600+ layout reads twice a second while
    // anyone has the menu open — and the early-out ("already clear, leave it alone") happens AFTER the
    // full sweep, so the cheap case still paid for the expensive one. The cheapest phone at a busy
    // table is the one that stutters.
    //
    // The bell only ever moves within BELL_MAX_LIFT of its resting place, so a control outside that
    // band plus a little margin can never be relevant. `band` is that window, and the filter is a
    // pure number comparison per element — no extra layout work, because getBoundingClientRect() is
    // what we were already paying for. Everything else about the scan is unchanged, deliberately:
    // it is still RECTANGLES, not elementFromPoint, because a single centre probe has a blind spot
    // that once made this read "nothing underneath" and never lift at all.
    const BELL_BAND_PAD = 80;
    const controlBoxes = (band?: { top: number; bottom: number }): DOMRect[] => {
      const out: DOMRect[] = [];
      // Padded by the full lift range in BOTH directions, because the box we are handed may itself
      // already be lifted — so the resting place can be up to BELL_MAX_LIFT *below* it. Symmetric is
      // the only version that is correct whatever the current lift is; it is still a ~600px window
      // instead of the whole document.
      const top = band ? band.top - BELL_MAX_LIFT - BELL_BAND_PAD : -Infinity;
      const bottom = band ? band.bottom + BELL_MAX_LIFT + BELL_BAND_PAD : Infinity;
      document.querySelectorAll<HTMLElement>("button, [role='button'], a").forEach((el) => {
        if (el.closest(".chef-call")) return; // the bell and its icon are not obstructions
        if (isCardLink(el)) return;           // the tile itself is scenery, not a control
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        // Nowhere near the band the bell can occupy → it can never be in the way.
        if (r.bottom < top || r.top > bottom) return;
        out.push(r);
      });
      return out;
    };
    const hits = (boxes: DOMRect[], left: number, right: number, top: number, bottom: number) =>
      boxes.some((r) => r.left < right && left < r.right && r.top < bottom && top < r.bottom);
    // FIND A RESTING PLACE THAT COVERS NO CONTROL AT ALL — searching upward in small steps rather
    // than hopping "just past the highest thing in the way". The old hop is what overshot into a
    // category header: clearing one control lands you wherever that puts you, which may be worse.
    // A scan simply asks each candidate "is anything tappable here?" and takes the first clean one.
    const STEP = 8;
    const settleBell = () => {
      const bell = document.querySelector<HTMLElement>(".chef-call");
      if (!bell) return;
      const cur = bell.getBoundingClientRect();
      if (!cur.width) return;
      // Read the bell FIRST so the scan can be limited to the band it could move through.
      const boxes = controlBoxes({ top: cur.top, bottom: cur.bottom });
      const lift = parseFloat(bell.style.getPropertyValue("--bell-lift")) || 0;
      // STABILITY FIRST: if where it sits now is already clear, leave it completely alone. Without
      // this the lift is recomputed from zero on every scroll-stop and the bell visibly hops around
      // the screen as the guest browses — trading a covered button for a restless one.
      if (!hits(boxes, cur.left, cur.right, cur.top, cur.bottom)) return;
      // Rest position = where it would sit with no lift at all.
      const restTop = cur.top + lift, restBottom = cur.bottom + lift;
      for (let want = 0; want <= BELL_MAX_LIFT; want += STEP) {
        if (!hits(boxes, cur.left, cur.right, restTop - want, restBottom - want)) {
          if (want === 0) bell.style.removeProperty("--bell-lift");
          else bell.style.setProperty("--bell-lift", `${want}px`);
          return;
        }
      }
      // NOTHING within reach is clean (a very short screen, or a wall of controls). Go back to the
      // corner the owner designed rather than staying parked mid-screen on a heading: at rest the
      // bell is at least where a guest expects to find it, and the scroll step-aside below still
      // uncovers whatever is under it while they are moving.
      //
      // REJECTED (owner, 2026-08-17): the bell must NOT hide, fade, move away or become untappable
      // when there is nowhere clean — *"i want like previous bell of call waiter should be stuck at
      // his place we can scrool and click the thing make sure don't change that again"*.
      // docs/REJECTED-IDEAS.md → R29.
      //
      // Guest sweep T1 offered exactly that and it was refused. So nobody re-discovers the
      // measurements as new: with the search suggestions open, the panel is full-width (x 21..339)
      // and stacks unbroken from y 362 to 739, so all 33 candidate positions in the 260px band are
      // covered; the bell returns here to y 707..755 and overlaps a dish's "+" (y 734..776,
      // x 291..333) by 22px. With every category folded, full-width `.cat-group-head` buttons tile
      // ~53px apart and the same thing happens with 48px of overlap. Both restaurants, 360x780.
      // The owner has weighed that and wants the bell to stay put regardless: it is a fixed thing
      // in a fixed corner that a guest can always find, and scrolling moves the page under it.
      // Do NOT add a stand-down, a hide-while-searching, a pointer-events yield, a fade, a
      // horizontal step, or a bigger BELL_MAX_LIFT. Do not re-report the overlap as a fault.
      bell.style.removeProperty("--bell-lift");
    };
    const markScrolling = () => {
      document.body.classList.add("menu-scrolling");
      clearTimeout(scrollIdle);
      scrollIdle = setTimeout(() => {
        document.body.classList.remove("menu-scrolling");
        settleBell(); // the guest has stopped — this is the moment they reach out to tap
      }, 450);
    };
    // The very first paint counts too: a guest who never scrolls at all was the case the
    // measurement above actually caught. Re-checked on resize/rotate for the same reason.
    const bellRaf = requestAnimationFrame(settleBell);
    window.addEventListener("resize", settleBell);
    // SCROLL-SPY (Petpooja-style): work out which category section sits under
    // the sticky header right now. The chips highlight + follow automatically
    // (Coffee → Beverages → … as the guest scrolls the "All" view).
    const computeSpy = () => {
      const sections = el.querySelectorAll<HTMLElement>(".cat-group[data-cat]");
      if (!sections.length) return;
      // A category tap just set the highlight explicitly — don't let the spy
      // fight it while the smooth-scroll is still settling (bug #11).
      if (Date.now() < spyLockUntil.current) return;
      // The "line" is the bottom of the PINNED category+search block, measured
      // live — so it stays correct if it grows (longer translated labels, bigger
      // font, wrapped chips) instead of a hardcoded pixel guess.
      const hdr = document.getElementById("menu-sticky");
      const headerLine = (hdr ? hdr.getBoundingClientRect().bottom : 240) + 16;
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
      markScrolling(); // let the bell step aside off the cards' add buttons
      // Don't save on every single scroll tick — wait for the next animation
      // frame, so we save at most once per frame (gentler on performance).
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Remember how far down we are, in this browsing session.
        //
        // NOT UNTIL THE RESTORE HAS HAD ITS TURN (guest sweep T1, sweep #7, 2026-08-22).
        //
        // This effect ends with a bare `onScroll()` — "run once on mount so the shrink starts at the
        // right value if we restored a scrolled position". But that mount call happens while the
        // list is still EMPTY, so `el.scrollTop` is 0, and this line wrote that 0 over the position
        // we were about to jump back to. The restore effect below runs later (it waits for
        // `menuData`), read the 0, and its `if (y > 0)` guard then did nothing at all. So "Back
        // returns you to the same spot" — a feature this file carries four comments about — had
        // quietly stopped working: every Back from a dish put the diner at the very top of the menu
        // and left them to find their place again, on a 199-dish menu.
        //
        // Measured, not reasoned about: with the key pre-seeded to 1438, a fresh load produced
        // EXACTLY ONE write to it, value "0", 136ms in, and the page stayed at 0. Reproduced on a
        // PRODUCTION build too, so it was not a dev-only double-mount artefact.
        //
        // `restoreSettled` is the restore's own ref, set once its jump has landed (or once there was
        // nothing to jump to). Before that: save nothing — the list is empty and there is nothing
        // real to save. After it: save every scroll exactly as before. A menu with no dishes never
        // sets it and has nothing to scroll either. The shrink and frost maths below still run on
        // mount, which is what that mount call was actually for.
        if (restoreSettled.current) {
          // REMEMBER THE DISH, NOT JUST THE PIXEL (owner, 2026-08-26 — "can do the 10 and 11").
          //
          // A pixel offset is a fact about a page that has not finished growing. Every dish photo
          // is lazy with no reserved box, so the list gets TALLER after the diner leaves and the
          // number we saved stops meaning the same place — which is why coming back needed a
          // re-aiming loop and could still land short. The dish under the header is a fact about
          // the MENU, and it stays true however the page settles.
          //
          // Both are stored: the id is what we aim at, the pixel is the fallback for when that
          // dish is no longer on screen (a filter changed, the dish was taken off the menu, or the
          // guest came back to a different restaurant). A value written by an older build is a bare
          // number and is still read correctly — see the restore.
          try {
            const head = document.getElementById("menu-sticky")?.getBoundingClientRect().bottom ?? 0;
            // THE FIRST DISH THE DINER CAN ACTUALLY SEE — the one whose top is at or below the
            // header line, not the one half-hidden behind it. Anchoring on the half-hidden card put
            // it fully below the header on the way back, which moved the whole list up by one row
            // and returned the diner to the dish BEFORE the one they left at. Measured: left at
            // "Mint Melon Juice", came back to "Nutella Shake".
            const first = Array.from(el.querySelectorAll<HTMLElement>(".item-card-link"))
              .find((c) => c.getBoundingClientRect().top >= head - 4);
            const id = first?.getAttribute("href") || "";
            sessionStorage.setItem(sk("lfh_menu_scroll"), JSON.stringify({ y: Math.round(el.scrollTop), id }));
          } catch {}
        }
        // SCROLL-LINKED SHRINK. The brand bar (.nav) is LOCKED at the top. As the
        // category bar pins right under it and you keep scrolling, the cards
        // shrink SMOOTHLY from big+icons to small text-only — driven frame by
        // frame by the scroll position, so it feels like the scrolling itself is
        // compressing them (no snap, no "it shrank by itself", no flicker).
        // We measure off the NON-sticky ".section-header" (it sits ABOVE the bar,
        // so it never moves when the bar shrinks → no feedback loop / no big-small
        // oscillation). `past` = how many px we've scrolled beyond the moment the
        // bar meets the brand's bottom edge; we map 0..SHRINK_DIST onto 0..1.
        const nav = document.querySelector<HTMLElement>(".nav");
        const navBottom = nav ? nav.getBoundingClientRect().bottom : 64;
        const secHeader = el.querySelector<HTMLElement>(".section-header");
        const sticky = document.getElementById("menu-sticky");
        if (secHeader && sticky) {
          const past = navBottom - secHeader.getBoundingClientRect().bottom;
          const SHRINK_DIST = 70; // fully shrink over this many px of scrolling
          const p = Math.max(0, Math.min(1, past / SHRINK_DIST));
          sticky.style.setProperty("--shrink", p.toFixed(3));
        }
        // Size the SINGLE frost panel that sits behind the brand + category +
        // search: just the brand strip normally, growing to cover the pinned
        // category+search once the bar reaches the top. This one shared blur is
        // what removes the seam between the brand and the categories.
        const frost = document.querySelector<HTMLElement>(".menu-headfrost");
        if (frost && sticky) {
          const sRect = sticky.getBoundingClientRect();
          const pinned = sRect.top <= navBottom + 4;
          const h = pinned ? Math.max(navBottom, sRect.bottom) : navBottom;
          frost.style.setProperty("--headfrost-h", Math.round(h) + "px");
        }
        computeSpy();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Photos lazy-load and reshape the page WITHOUT firing a scroll event, which
    // would leave the spy pointing at the wrong section — so also re-check on a
    // gentle timer (the computation is a handful of rectangle reads, very cheap).
    // settleBell rides the SAME tick, and it has to. Running it once on mount was not enough, and
    // the live site proved it after the first deploy: on Vercel the dish photos arrive later than
    // in a warm local build, so the single mount-time check ran against a page whose cards had not
    // laid out yet, found nothing under the bell, and — because a guest who never scrolls never
    // triggers another check — left the bell sitting on the add button exactly as before. It passed
    // locally and failed live, which is the whole reason the live pass exists.
    // The check is a handful of rectangle reads and returns immediately once the bell is clear, so
    // it costs what the scroll-spy beside it costs, and it self-heals for lazy images, a category
    // fold, a filter change and a language switch alike.
    // …and skip the whole tick while the tab is hidden. Both halves are pure layout maths about a
    // screen nobody is looking at, and every other timer in the guest app already checks this
    // (AppShell's 60s settings poll, useRealtime's safety poll). The `settleBell` on wake is
    // covered by the resize/scroll handlers and by the next tick.
    const tick = setInterval(() => { if (document.hidden) return; computeSpy(); settleBell(); }, 600);
    // Run once on mount so the shrink starts at the right value if we restored a
    // scrolled position. Cleanup: stop listening + cancel the pending frame/timer.
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(bellRaf);
      window.removeEventListener("resize", settleBell);
      clearInterval(tick);
      clearTimeout(scrollIdle);
      document.body.classList.remove("menu-frost");
      document.body.classList.remove("menu-scrolling"); // never strand the bell hidden
      // …and never strand it lifted either: another page's bell must start at rest.
      document.querySelector<HTMLElement>(".chef-call")?.style.removeProperty("--bell-lift");
    };
  }, []);

  // When the spied category changes, slide the (now pinned) category bar
  // sideways so the active card stays in view — exactly how Petpooja's dine-in
  // bar follows the guest as they scroll.
  useEffect(() => {
    if (!spyCat) return;
    const bar = document.getElementById("cat-scroller");
    const chip = bar?.querySelector<HTMLElement>(".cat-card.active");
    if (bar && chip) {
      // centre the active card inside its bar (computed against the bar itself,
      // so this can never scroll the page vertically by accident)
      const left = chip.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
      bar.scrollTo({ left: left - bar.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
    }
  }, [spyCat]);


  // Restore that scroll position once the list has actually painted.
  // Re-runs when menuData arrives; only does the jump one time.
  useEffect(() => {
    // Skip if we already jumped, or if the dishes aren't loaded yet.
    if (scrollRestored.current || !menuData.length) return;
    scrollRestored.current = true;  // mark done so we never jump twice
    try {
      // Reads BOTH shapes: `{ y, id }` from this build, and a bare number from an older one still
      // sitting in a diner's tab. Neither can throw the restore off — a bad blob just means no
      // memory, which is where every first visit starts anyway.
      const raw = sessionStorage.getItem(sk("lfh_menu_scroll")) || "";
      let y = 0, wantId = "";
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") { y = parseInt(String(parsed.y), 10) || 0; wantId = String(parsed.id || ""); }
        else y = parseInt(String(parsed), 10) || 0;
      } catch { y = parseInt(raw, 10) || 0; }
      const el = document.getElementById("main-scroll");
      if (y > 0 && el) {
        // TWO FRAMES IS NOT ENOUGH — THE PAGE IS STILL GROWING (guest sweep T1, sweep #7).
        //
        // Two frames gets the CARDS into the DOM, but not the page to its full height: every dish
        // photo is `loading="lazy"` with no reserved box, so at that moment the list is a fraction
        // of its final length and the browser silently CLAMPS scrollTop to whatever the maximum is
        // right then. Measured: asking for 1438 landed the diner at 447 and nothing ever re-aimed
        // once the photos arrived.
        //
        // So re-aim, bounded — the same shape as the shrink-correction loop in the scroll effect
        // above. Watching `scrollHeight` is the honest stopping test: while it is still growing
        // there is more page coming, and once it settles and we still cannot reach the saved place,
        // that place genuinely no longer exists (a filter now shows fewer dishes) and retrying
        // would be pointless. Four cheap ways out: we get there · the guest scrolls themselves and
        // we get out of their way · the page stops growing three ticks running · a 2.5s deadline.
        //
        // INSTANT, never smooth: `#main-scroll` carries `scroll-behavior: smooth` (globals.css) for
        // the category tap, so a plain `el.scrollTop = y` ANIMATES — the diner would watch the menu
        // scroll past on the way back, and the re-aim could not tell that motion from their own.
        // WHERE ARE WE AIMING? The remembered DISH if it is still on this menu, and its position is
        // re-read every tick — so as the lazy photos above it arrive and push it down, the target
        // follows it instead of going stale. That is the thing a saved pixel can never do. No dish
        // (or it has gone) → the pixel, exactly as before.
        const targetTop = () => {
          if (wantId) {
            const card = el.querySelector<HTMLElement>(`.item-card-link[href="${CSS.escape(wantId)}"]`);
            if (card) {
              const head = document.getElementById("menu-sticky")?.getBoundingClientRect().bottom ?? 0;
              return Math.max(0, el.scrollTop + card.getBoundingClientRect().top - head - 12);
            }
          }
          return y;
        };
        // BEING ON TARGET IS NOT THE SAME AS BEING FINISHED. The first version of this stopped the
        // moment it reached the dish — and then the lazy photos ABOVE it loaded, pushed it down, and
        // nothing was watching any more. Measured: French House landed 234px short and Aangan 364px,
        // both exactly one row above the right dish. So it only stops once it is on the dish AND the
        // page has stopped growing for three ticks running.
        let lastSet = -1, lastHeight = -1, stalls = 0;
        const started = Date.now();
        const aim = () => {
          // The guest scrolled themselves — they have taken over, get out of the way.
          //
          // …BUT NOT IN THE FIRST HALF-SECOND. Next's router scrolls this container back to the top
          // as part of the hop, and that lands AFTER our first aim — so the position moved without
          // us moving it and this test read the ROUTER as the diner and gave up. Measured: the
          // restore stopped 202px short and never corrected, on every menu. Nobody scrolls a page
          // they have not seen yet, so the first 700ms belong to the browser, not to them.
          if (Date.now() - started > 700 && lastSet >= 0 && Math.abs(el.scrollTop - lastSet) > 2) {
            restoreSettled.current = true; return;
          }
          const h = el.scrollHeight;
          stalls = h === lastHeight ? stalls + 1 : 0;
          lastHeight = h;
          const want = targetTop();
          const onTarget = Math.abs(el.scrollTop - want) <= 4;
          // There, and the page has settled underneath us. Or we have simply run out of patience:
          // 4s covers a 199-dish menu filling in its photos, and the loop is a scrollTop read.
          if ((onTarget && stalls >= 3) || Date.now() - started > 4000) { restoreSettled.current = true; return; }
          if (!onTarget) {
            el.scrollTo({ top: want, behavior: "instant" as ScrollBehavior });
            lastSet = el.scrollTop;
          }
          setTimeout(aim, 100);
        };
        requestAnimationFrame(() => requestAnimationFrame(aim));
        return;
      }
    } catch {}
    // Nothing to restore (a first visit, or storage refused): saving may start immediately.
    restoreSettled.current = true;
  }, [menuData]);

  // Remember the active category so navigating away and Back returns you here.
  // Re-runs whenever the selected category changes.
  useEffect(() => {
    if (!currentCategory) return;
    try {
      sessionStorage.setItem(sk("lfh_menu_cat"), currentCategory);
    } catch {}
  }, [currentCategory]);

  // This effect pre-downloads the small 3D models so the viewer opens fast.
  // Re-runs when the dishes load or the category changes.
  //
  // IT MUST WAIT FOR THE REAL SWITCH, NOT THE OPTIMISTIC DEFAULT. `features` starts from
  // FEATURE_DEFAULTS (model3d: TRUE) and only becomes this restaurant's truth a beat later.
  // Reading it synchronously meant the queue was filled on the first pass and the downloads
  // had already STARTED by the time the switch resolved to off — measured on a restaurant with
  // 3D off: 2 small GLBs (~2 MB each) fetched on every menu load, forever, for a feature it
  // does not have. `getFeatures()` is the same cached, de-duplicated read useFeatures makes,
  // so awaiting it costs no extra request; ViewerClient already uses exactly this shape.
  // (Found by re-running the guest sweep, 2026-08-04 — the sibling of the reviews leak.)
  useEffect(() => {
    if (!menuData.length) return;  // wait until dishes have loaded
    let cancelled = false;
    getFeatures(restaurantId).then((feats) => {
      if (cancelled) return;
      // Switched off: stop everything. setQueue([],[],[],[]) only emptied the WAITING LINE,
      // so whichever GLB had already started still finished downloading — ~2 MB on every
      // fresh page load for a feature this restaurant does not have (guest sweep
      // 2026-08-04). stopAll() also calls off the download in flight.
      if (feats.model3d === false) { modelLoader.stopAll(); return; }
      queuePreloads();
    });
    return () => { cancelled = true; };

    function queuePreloads() {
    // Only dishes that have a working 3D model (both file sizes present).
    const fourD = menuData.filter(
      (i) => i.is4d && i.modelSmallUrl && i.modelOptimizedUrl
    );

    // Dishes in the current category (preload first) vs. everything else. The "All"
    // view shows every category, so treat it like no filter — preload them all.
    //
    // REJECTED (owner, 2026-08-16) — docs/REJECTED-IDEAS.md → R28. There is NO ceiling on this on
    // purpose: *"don't do the sixth one any time soon like in the code, also reject that it is
    // rejected by me."* Offered as guest sweep T1 improvement I2 (a restaurant that models 30 dishes
    // would have every diner's phone pull ~60 MB in the background for dishes nobody opens). His
    // answer is that a diner must never wait when they tap a dish. So do not add a cap, a first-N
    // window, an "only what's on screen" queue, a data-saver mode or a per-restaurant preload
    // setting — and do not re-report the unbounded preload as an egress or performance problem.
    // The measured facts, so nobody re-discovers them as new: 2 GLB requests on a French House menu
    // open (it has 2 such dishes, Aangan has none), and lib/modelLoader already evicts past 40 MB.
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
    }
  }, [menuData, currentCategory, features.model3d, restaurantId]);

  // Search matches the dish name OR its category (slug + translated name), so
  // typing "croissant" finds the croissant-category dishes even though their
  // display names don't contain the word.
  // fold(): lowercase AND strip accents so an un-accented search still matches
  // an accented name — "caffe" finds "Caffè Latte", "canapes" finds "Canapés".
  // This is essential on a French menu: most phone keyboards type no accents,
  // yet most dish names carry them. NFD splits "è" into "e" + a combining mark,
  // then we drop the marks (̀–ͯ). (Bug fix 2026-07-06.)
  const fold = (s: string) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // q = the search text, tidied up (trimmed, lowercased, accent-folded).
  const q = fold(searchQuery.trim());

  // BACK CLOSES THE SEARCH — IT DOES NOT OFFER TO LEAVE THE SITE (owner, 2026-08-26).
  //
  // *"when you click back button on serch it doesn't stop serch it ask to exit website make that
  // also back button backable"*. Measured before the fix: with "coffee" typed, one press of Back
  // left the search running — the box still said "coffee" and all six suggestions were still on
  // screen — and put the Stay-or-Leave dialog over the top of it. So the one gesture every phone
  // user reaches for to dismiss something offered to throw the diner off the restaurant's menu
  // instead, mid-order.
  //
  // The exit dialog itself is fine and stays exactly as it is (checked: Stay stays, Leave leaves).
  // The fault was that nothing told the back manager a search is an OPEN THING. Every other overlay
  // on the guest side already writes this one line — the language and currency pickers do — and the
  // manager keeps its own history entries in step, so back walks: close the search, then (nothing
  // left open) ask about leaving. Clearing the box is exactly what the ✕ inside it does, so a diner
  // gets the same result from the gesture they already know.
  useBackClose("menu-search", !!q, () => setSearchQuery(""));
  // Get a category's display name (in the current language), accent-folded.
  const catNameOf = (slug: string) =>
    fold(localized(dbCategories.find((c) => c.slug === slug)?.name, lang));
  // True if a dish matches the search — by name, category slug, category name,
  // or a hidden search alias. (|| means "or".) Every side is accent-folded so
  // the comparison is accent-insensitive both ways.
  const matchesSearch = (i: FoodItem) =>
    fold(i.title).includes(q) ||
    fold(i.category).includes(q) ||
    catNameOf(i.category).includes(q) ||
    fold(i.searchAlias || "").includes(q);

  // A stale saved "favourites on" / "veg on" must never keep filtering the grid
  // once the restaurant switches that feature OFF. Derive effective values that
  // fall back to "no filter" when the matching switch is off.
  const favActive = favOnly && features.favorites !== false;
  // A VEG-ONLY MENU HAS NOTHING TO DISTINGUISH (owner, 2026-08-12: *"there shouldn't be a non-veg
  // chip … because it's veg"*).
  //
  // The Access toggle (Access → Menu → Veg / non-veg → `diet_filter`) has existed all along and its
  // own help text says "Switch it off for a pure-veg restaurant so nothing needs marking" — but it
  // DEFAULTS ON, and nobody had turned it off. Measured on Aangan Garden, which is pure veg: 199
  // dishes, 199 green veg marks, and a "🍖 Non-Veg" chip whose only possible outcome is the
  // "no dishes match these filters" screen. A filter that can never match anything is a dead end a
  // diner has to work out for themselves.
  //
  // So the switch being ON now means "on WHERE IT MEANS SOMETHING": if every dish on the menu is on
  // the same side of the line, there is nothing to tell apart and the chips + the per-dish mark both
  // go. Derived from the menu itself rather than a new setting, so it is right for Aangan today and
  // for every veg (or every all-meat) restaurant created afterwards, with nothing to remember to
  // configure. An admin who genuinely wants them gone on a mixed menu still switches the toggle off.
  // Guarded by `!!menuData.length` so a menu that hasn't loaded yet never flickers the chips away.
  const dietMeaningful =
    menuData.length > 0 && !(menuData.every((i) => i.veg) || menuData.every((i) => !i.veg));
  const dietShown = features.diet_filter !== false && dietMeaningful;
  // …and a saved "veg" filter must stop narrowing the grid the moment the chips are gone, exactly as
  // it already does when the switch is off — otherwise a returning guest sees a partial menu with no
  // visible chip to turn off.
  const dietActive = dietShown ? currentDiet : "";
  // Same guard for Chef's Special, which was missing it. Its chip is hidden when the admin
  // switches `chip_chef-special` off, but the restored `lfh_menu_chef=1` kept narrowing the
  // grid — so a returning guest saw a partial menu with no visible chip to turn off
  // (guest sweep 2026-08-04). All three saved filters now fall back to "no filter".
  const chefActive = chefOnly && (features as Record<string, boolean>)["chip_chef-special"] !== false;

  // Decide which dishes to show. The menu is always the full grouped view; the
  // filter chips (which STACK) narrow it. .filter keeps only the dishes where
  // this function returns true.
  const visibleItems = menuData.filter((item) => {
    // While searching, match the query (name / category / alias).
    if (q && !matchesSearch(item)) return false;
    // Chef's Special filter: only dishes carrying the "chef-special" tag.
    if (chefActive && !item.tags.includes("chef-special")) return false;
    // Favorites filter: only the dishes this guest hearted.
    if (favActive && !favorites.includes(item.id)) return false;
    // Diet filter: hide non-veg when "veg" is on, and vice versa.
    if (dietActive === "veg" && !item.veg) return false;
    if (dietActive === "non-veg" && item.veg) return false;
    return true;  // passed every check — show this dish
  });

  // The search dropdown — top matches across all categories. Name-starts-with
  // first, then by rating. (Only built when there's something typed.)
  // It must honour the SAME active filters as the grid (Veg / Chef / Favourites),
  // otherwise the dropdown could list dishes the grid hides — two answers to one
  // query on screen at once (e.g. Veg on + "chicken").
  const searchResults = q
    ? menuData
        .filter((i) =>
          matchesSearch(i) &&
          !(chefActive && !i.tags.includes("chef-special")) &&
          !(favActive && !favorites.includes(i.id)) &&
          !(dietActive === "veg" && !i.veg) &&
          !(dietActive === "non-veg" && i.veg)
        )
        .sort((a, b) => {
          const aStarts = fold(a.title).startsWith(q) ? 0 : 1;
          const bStarts = fold(b.title).startsWith(q) ? 0 : 1;
          return aStarts - bStarts || ratingOf(b) - ratingOf(a);
        })
        .slice(0, 8)
    : [];

  // Apply the chosen sort (a stable copy so the menu order stays the default).
  // [...visibleItems] makes a copy first so we don't reorder the original list.
  const filteredItems = [...visibleItems].sort((a, b) => {
    // Compare two dishes (a and b) based on the selected sort option.
    switch (currentSort) {
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

  // The category BAR should only show chips for categories that actually have
  // dishes under the CURRENT filter (Veg / Chef's Special / Favorites…). Before,
  // the bar always showed every category, so tapping one a filter had emptied did
  // nothing — a dead tap (audit fix bug #12). When no filter is active this is
  // every category with dishes, i.e. unchanged.
  const nonEmptyCatSlugs = new Set(filteredItems.map((it) => it.category));
  const visibleCategories = categories.filter((c) => nonEmptyCatSlugs.has(c.slug));

  // "SLIDE →" IS ONLY TRUE WHEN THE ROW ACTUALLY HAS MORE (T14 tablet sweep, 2026-08-13).
  // The hint was rendered whenever there were categories at all, with no check on the thing it
  // describes. Measured at 1194x834: the row is 1100px wide, and on FOUR of five restaurants
  // every category already fits — Green Bowl, Sakura Sushi and Pizza Palace (4 each) and even
  // My Little French House (9) all came out scrollWidth == clientWidth — yet all four told the
  // guest to swipe. Only Aangan's 22 categories genuinely overflow (2054 / 1100). It reads right
  // on a phone, which is the width it was written for; on a tablet it is an instruction that
  // does nothing, and a hint that lies teaches people to ignore hints.
  // Measured, not guessed at from the count: how many chips fit depends on their names.
  const [catOverflows, setCatOverflows] = useState(false);
  useEffect(() => {
    const bar = document.getElementById("cat-scroller");
    if (!bar) { setCatOverflows(false); return; }
    const measure = () => setCatOverflows(bar.scrollWidth - bar.clientWidth > 4);
    measure();
    // Re-measure when the row or its contents resize: rotating a tablet, a filter changing which
    // categories are listed, and the web font landing all change the answer.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(bar);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", measure); };
  }, [dbCategories, visibleCategories.length, q]);

  // Everything below is the actual on-screen layout (JSX = HTML-like markup).
  // Curly braces { } drop a value or a bit of logic into the markup.
  return (
    // AppShell = the shared outer frame (header, footer, etc.).
    <AppShell restaurantId={restaurantId} logoText={isDefault ? undefined : (logoText || restaurantName || undefined)} brandName={restaurantName || logoText || undefined} brandSlug={restaurantSlug || ""} accentColor={isDefault ? undefined : (accentColor || undefined)} theme={isDefault ? undefined : theme} logoUrl={isDefault ? undefined : logoUrl}>
      {/* ONE fixed frosted backdrop behind the whole pinned header (brand +
          category + search). A single blur region = no seam between the brand
          and the categories. Its height is driven live by the scroll handler. */}
      <div className="menu-headfrost" aria-hidden="true" />
      {/* The scrolling content area. Its id is used to save/restore scroll. */}
      <main id="main-scroll">
        {/* The big animated greeting banner up top. */}
        <div className="hero">
          {/* #1 keeps its localized hero. Other restaurants use their CUSTOM hero when set,
              else a NEUTRAL generic line — never #1's French i18n default (no-LFH-leak rule).

              REJECTED (owner, 2026-08-17) — docs/REJECTED-IDEAS.md → R30. "Welcome" and "Our Menu"
              STAY ENGLISH for every restaurant and every language: *"i want english only for all"*.
              Guest sweep T1 offered a pair of neutral translated keys in lib/i18n.ts so a Hindi or
              Arabic guest would get this line in their own language; the answer was no. Do not add
              those keys, do not reach for t.greeting/t.heroTitle here (they are restaurant #1's own
              copy — "BONJOUR", "All-Day Café & Bakery" — and leaking them is the bug this line
              exists to prevent), and do not re-report the English fallback as a translation gap.
              Extends R15 and R23, which already ruled that the guest menu's remaining English is
              not to be brought back as work. */}
          <HeroTitle greeting={isDefault ? t.greeting : (tagline || "Welcome")} title={isDefault ? t.heroTitle : (heroTitle || "Our Menu")} />
        </div>

        {/* Categories heading + pinned bar hide entirely once we know the menu is
            empty (loaded with 0 dishes): a fresh restaurant showed a row of
            tappable category chips above "No dishes yet" that scrolled nowhere
            (audit fix 2026-07-06). While still loading we keep showing them. */}
        {!(loaded && menuData.length === 0) && (<>
        {/* "Categories" heading + "slide →" hint — also hidden when a filter has
            emptied EVERY category, so the label doesn't hover over an empty bar
            (regression fix). Still shown while categories are loading.
            The HINT itself only appears when the row really does have more off to the right
            (`catOverflows`, measured above) — on a tablet most menus fit and there is nothing
            to slide to. */}
        {!q && (dbCategories.length === 0 || visibleCategories.length > 0) && (
        <div className="section-header">
          <span className="section-title">{t.categories}</span>
          {catOverflows && (
          <span className="browse-hint" aria-hidden="true">
            {t.slide} <i className="fas fa-arrow-right"></i>
          </span>
          )}
        </div>
        )}
        {/* PINNED block — ONLY the category bar + the search box stay pinned at the
            top while dishes scroll (owner's layout). The filter/grid controls live
            BELOW this block and scroll away with the page. Order: categories, then
            search. This block wears the SAME frosted glass as the brand bar. */}
        <div className="menu-sticky" id="menu-sticky">
        {/* The horizontal row of category tabs — hidden (leaving just the search
            box) when a filter has emptied every category, so there's no empty bar
            (regression fix). Shown while loading (skeletons). */}
        {!q && (dbCategories.length === 0 || visibleCategories.length > 0) && (
        /* I13 — SAY WHAT THESE ACTUALLY DO (T1 improvement 13, 2026-08-12).
            This was role="tablist" with role="tab" + aria-selected children, which tells a screen
            reader the guest is choosing between tab PANELS — and there is no tabpanel anywhere, arrow
            keys do nothing, and tapping a chip does not switch views: it smooth-scrolls to that
            category's section and the highlight then FOLLOWS the scroll. A blind diner was being
            described a widget that doesn't exist.
            A plain group of buttons with aria-current="true" on the one you are currently inside is
            what this really is, and aria-current is the standard way to say "this is where you are"
            rather than "this is what you picked". The .active class (and so every bit of styling and
            the scroll-spy) is untouched. */
        <div className="cat-scroller" id="cat-scroller" role="group" aria-label="Jump to a menu category">
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
            : // .map turns each category into a tab button on screen (only ones
              // with dishes under the current filter — no dead taps, bug #12).
              visibleCategories.map((cat) => (
                <button
                  key={cat.slug}
                  type="button"
                  // A card lights up when its category view is open, OR — in the
                  // "All" view — when the guest has SCROLLED into its section
                  // (the scroll-spy), so the bar follows them Petpooja-style.
                  // The bar highlights the category you've SCROLLED into (the
                  // scroll-spy) — there's no "selected" category anymore.
                  aria-current={spyCat === cat.slug ? "true" : undefined}
                  className={`cat-card ${spyCat === cat.slug ? "active" : ""}`}
                  // ONE THEME COLOUR, NOT TWENTY-ONE (owner, 2026-08-26): *"do the theme colour one
                  // only it look professional like it was previous no random colours"*.
                  //
                  // The chip used to emit --cat-color / --cat-grad / --cat-on from a colour picked
                  // per category, so a menu could show a blue chip beside an orange one beside a
                  // pink one. Emitting nothing is what makes the stylesheet fall back to
                  // `var(--accent)` and `var(--accent-grad)` — the restaurant's own theme colour —
                  // which is EXACTLY how the bar looked before 2026-08-07, because until then those
                  // variables were set here and no rule ever read them. So this is a return to the
                  // look he is describing, not a new one.
                  //
                  // It settles a measured readability problem for free. Across the 21 distinct
                  // category colours in the database, 11 gave the chip's label the weaker of the two
                  // inks — white on #22c55e is 2.3:1 where 4.5:1 is the standard. The accent has one
                  // known ink, and the stylesheet has always had it right.
                  //
                  // The editor's per-category colour picker is removed in the same commit, so no
                  // control is left that quietly does nothing.
                  // Tapping a category just smooth-scrolls to its section — always
                  // the full grouped menu, never narrowing to one category.
                  onClick={() => scrollToCategory(cat.slug)}
                >
                  <div className="cat-icon" aria-hidden="true">
                    <i className={`fas ${cat.icon}`}></i>
                  </div>
                  <div className="cat-name">{cat.name}</div>
                </button>
              ))}
        </div>
        )}
        {/* SEARCH BOX — sits right under the categories, still INSIDE the pinned
            block, so categories + search stay glued to the top together. Hidden
            when the search feature is switched off. */}
        {features.search && (
        <div className="items-header search-row">
          <div className="search-container">
            {/* The little mark inside the search box: the French House logo on the
                flagship (#1) only; every OTHER restaurant gets a neutral, accent-tinted
                search glyph — never leak #1's logo onto another tenant's menu (white-label). */}
            {isDefault ? (
              // From our OWN public/, not littlefrenchhouse.in. Same file (identical sha256), but
              // no dependency on an outside WordPress site and it works offline like everything
              // else. See components/Maintenance.tsx for the full note. (T1 improvement 13.)
              <img
                className="search-logo"
                src="/lfh-logo.png"
                alt=""
                aria-hidden="true"
              />
            ) : logoUrl ? (
              // This restaurant uploaded its own logo → show it by the search bar.
              <img className="search-logo" src={logoUrl} alt="" aria-hidden="true" />
            ) : (
              <svg className="search-logo" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
            )}
            {/* The search box. value shows what's typed; onChange updates our
                searchQuery memory every keystroke. */}
            <input
              type="search"
              id="search-input"
              className="search-input"
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              value={searchQuery}
              maxLength={60}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {/* When there are matches, show the dropdown of quick results. */}
            {/* SAY WHAT THIS ACTUALLY IS — the same correction the category chips got above
                (guest sweep T1, 2026-08-17). It was `role="listbox"` whose children are plain
                links: a listbox promises a screen reader a set of `option`s to choose between, and
                there was not one `option` anywhere inside, so a blind diner was told "list box"
                and then handed nothing selectable. Arrow keys do nothing here either — the rows
                are links, and tapping one OPENS THAT DISH.

                …AND THE FIRST GO AT THAT TOOK THE LINKS AWAY (guest sweep T1, sweep #7,
                2026-08-22). It became `role="list"` with `role="listitem"` on each <Link>. But an
                explicit role REPLACES an element's own one, so every suggestion stopped being a
                link: read out of Chrome's own accessibility tree, the panel contained eight
                `listitem`s and NOT ONE `link`, while 58 other links on the page were listed
                normally. A blind diner skimming by links — the ordinary way to skim a page — could
                not reach the search results at all, and no row said it could be opened.

                A labelled GROUP of links is what this really is, and it is the pattern the
                category chip row above already uses (`role="group"` + a label). The `aria-label`
                still carries the count, so the number of matches is spoken rather than discovered
                by swiping, and each row is a link again. `list` would need `listitem` children,
                which means a wrapper element around each anchor — and `.search-result:last-child`
                draws the row divider, so wrapping would give every row a bottom border. Same
                information, no DOM change, no CSS risk. Class names, styling and the scroll cue
                are all untouched. */}
            {searchResults.length > 0 && (
              <div
                className="search-dropdown"
                role="group"
                aria-label={`${searchResults.length} matching ${searchResults.length === 1 ? "dish" : "dishes"}`}
              >
                {searchResults.map((r) => (
                  <Link
                    key={r.id}
                    href={`${itemBase}/item/${r.slug}`}
                    className="search-result"
                    onClick={() => setSearchQuery("")}
                  >
                    <img className="search-result-img" src={r.image} alt="" loading="lazy" decoding="async" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                    <span className="search-result-name">{r.title}</span>
                    {/* PRICE, then the category under it. A guest searching the menu is usually
                        price-hunting, and the suggestion row showed photo/name/category only — so
                        finding out what a dish cost meant opening it or clearing the search. The two
                        share one right-hand column so the row keeps its height and the name keeps
                        its space on a 360px phone. (T1 improvement 5, 2026-08-07.) */}
                    <span className="search-result-side">
                      <span className="search-result-price">{formatPrice(r.price, searchCurrency || DEFAULT_CURRENCY)}</span>
                      <span className="search-result-cat">
                        {localized(dbCategories.find((c) => c.slug === r.category)?.name, lang) || r.category}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
        </div>
        </>)}
        {/* /menu-sticky — ONLY the categories + search box stay pinned. */}

        {/* The filter/sort chips + the list/gallery toggle. These now live OUTSIDE
            the pinned block, so they scroll away with the dishes (owner's call:
            keep only categories + search glued to the top). Hidden while a search
            is active: search overrides the filters, and this stops the search
            suggestions dropdown from covering (and stealing taps from) the chips
            underneath it (audit fix bug #13). */}
        {!q && (
        <div className="items-header" id="sticky-header">
          {/* The row of sort chips, diet chips, and the list/gallery toggle. */}
          <div className="header-controls">
            <div className="controls-group">
              <div className="filter-row" role="group" aria-label="Filter and sort dishes">
                {/* LEFT group — attribute filters that SHOW ONLY matching dishes
                    and STACK together. Order: Chef's Special, Favorites, then
                    Veg / Non-Veg. */}
                {/* Chef's Special — dishes carrying the "chef-special" tag (set in
                    the editor's Tag tab). Toggle on/off. Hidden if the admin
                    switched this chip off. */}
                {(features as Record<string, boolean>)["chip_chef-special"] !== false && (
                  <button
                    type="button"
                    className={`filter-chip ${chefOnly ? "active" : ""}`}
                    aria-pressed={chefOnly}
                    onClick={() => setChefOnly((v) => !v)}
                  >
                    {t.filterChef}
                  </button>
                )}
                {/* Favorites — the dishes this guest hearted (local). Only when
                    the favorites feature is on. */}
                {features.favorites && (
                  <button
                    type="button"
                    className={`filter-chip ${favOnly ? "active" : ""}`}
                    aria-pressed={favOnly}
                    onClick={() => setFavOnly((v) => !v)}
                  >
                    {t.filterFav}
                  </button>
                )}
                {/* "Popular" group — Chef's Special + Favorites (above) round out with the two
                    SORTS (Top Rated, Low Price) so the FOUR sit together. Pick any one + any one
                    diet below; they stack independently. Each chip hides if its admin flag is off. */}
                {SORTS.filter((s) => (features as Record<string, boolean>)[`chip_${s.slug}`] !== false).map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    className={`filter-chip ${currentSort === s.slug ? "active" : ""}`}
                    aria-pressed={currentSort === s.slug}
                    onClick={() => toggleSort(s.slug)}
                  >
                    {s.slug === "top-rated" ? t.sortTopRated : s.slug === "price" ? t.sortLowPrice : s.label}
                  </button>
                ))}
                {/* SEPARATE diet group — Veg / Non-Veg, sitting next to the layout toggle. The whole
                    group is shown/hidden by one per-restaurant switch (diet_filter, admin-controlled);
                    OFF for pure-veg restaurants (e.g. Aangan). A dish is one or the other (single-select). */}
                {dietShown && (
                  <>
                    <span className="chip-divider" aria-hidden="true"></span>
                    {DIETS.map((d) => (
                      <button
                        key={d.slug}
                        type="button"
                        className={`filter-chip ${currentDiet === d.slug ? "active" : ""}`}
                        aria-pressed={currentDiet === d.slug}
                        onClick={() => toggleDiet(d.slug)}
                      >
                        {d.slug === "veg" ? t.filterVeg : d.slug === "non-veg" ? t.filterNonVeg : d.label}
                      </button>
                    ))}
                  </>
                )}
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
        </div>
        )}
        {/* /items-header — filter/grid controls (these scroll away, not pinned). */}

        {/* The dishes. Three shapes:
            A) still loading            -> grey placeholder cards
            B) the "All" view           -> one collapsible dropdown PER category
            C) a single category/search -> the normal flat grid (with the
                                           Favorites-empty tip when relevant) */}
        {menuData.length === 0 && loaded ? (
          // A0) loaded but genuinely EMPTY (a freshly-created restaurant with no dishes
          // yet): show a friendly empty state, NOT endless skeletons (bug G2, 2026-07-05).
          <div className="menu-empty-state" style={{ textAlign: "center", padding: "56px 24px", color: "var(--muted)" }}>
            <i className="fas fa-utensils" style={{ fontSize: 40, opacity: 0.5, color: "var(--accent)" }} aria-hidden="true" />
            <p style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t.noDishesYet}</p>
            <p style={{ marginTop: 6, fontSize: 13.5 }}>{t.noDishesYetSub}</p>
          </div>
        ) : menuData.length === 0 ? (
          // A) still loading → grey placeholder cards
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
          allGroups.length === 0 ? (
            // The active filter(s) matched nothing (e.g. Favorites with none
            // hearted, or Chef's Special before any dish is tagged) — show a
            // friendly hint instead of a blank screen.
            <div className="fav-empty" role="status">
              {favActive ? (
                <>
                  <div className="fav-howto" aria-hidden="true">
                    <div className="fav-howto-card">
                      <i className="fas fa-mug-saucer fav-howto-pic"></i>
                      <span className="fav-howto-heart"><i className="fas fa-heart"></i></span>
                    </div>
                    <span className="fav-howto-cue">{t.favTapToSave}</span>
                  </div>
                  <h3 className="fav-empty-title">{t.noFavourites}</h3>
                  {/* The sentence comes from the dictionary with a `{heart}` token where the ♥ goes,
                      so each language can put it where its own grammar wants it. This whole line
                      used to be hardcoded English under a translated headline (guest sweep T1). */}
                  <p className="fav-empty-sub">
                    {t.noFavouritesSub.split("{heart}").map((part, i) => (
                      <span key={i}>
                        {i > 0 && <i className="fas fa-heart" aria-hidden="true"></i>}
                        {part}
                      </span>
                    ))}
                  </p>
                </>
              ) : (
                /* TELL THEM WHAT TO DO, not just that there is nothing (guest sweep T1, 2026-08-12).
                   This branch used to be the headline ALONE, while the flat-grid branch ~40 lines
                   below renders the same headline WITH `t.noMatchSub` under it. So the sentence
                   "Try turning a filter off." already existed in all six languages and was simply
                   never shown on the grouped view — the commoner case, because the grouped view is
                   what a diner is looking at when they tap a filter chip.
                   Measured on Aangan (pure veg) with Non-Veg on, 360x780: one sentence, then an
                   empty screen — and the category bar and "Categories" heading are deliberately
                   hidden at that moment too, so there was nothing else on the page at all. */
                <>
                  <h3 className="fav-empty-title">{t.noMatch}</h3>
                  <p className="fav-empty-sub">{t.noMatchSub}</p>
                </>
              )}
            </div>
          ) : (
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
                        <FoodCard key={item.id} item={item} index={index} viewingCategory={g.slug} restaurantId={restaurantId} restaurantSlug={restaurantSlug} showDiet={dietShown} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          )
        ) : filteredItems.length === 0 ? (
          // C0) searching (or filtering) found NOTHING — show a friendly message
          // instead of a blank void. Without this the guest just sees empty space
          // below the search box and thinks the page broke (bug fix 2026-07-06).
          <div className="fav-empty" role="status">
            <h3 className="fav-empty-title">
              {/* split/join, NOT .replace(): String.replace treats `$&`, "$`" and `$'` in the
                  REPLACEMENT as instructions, and here the guest types the replacement. Measured
                  on the deployed site: typing `$&` printed `No dishes found for “{q}”` — the app's
                  own placeholder — and "$`" printed the whole message nested inside itself
                  (guest sweep T1, 2026-08-06). split/join copies the text verbatim. */}
              {q ? t.noSearchResults.split("{q}").join(searchQuery.trim()) : t.noMatch}
            </h3>
            <p className="fav-empty-sub">
              {q ? t.noSearchResultsSub : t.noMatchSub}
            </p>
          </div>
        ) : (
          // C) search results — a flat grid of every match across the menu.
          <div
            id="items-container"
            className={`items-container ${layout === "gallery" ? "gallery-mode" : ""}`}
          >
            {/* One FoodCard tile per dish in the filtered list. */}
            {filteredItems.map((item, index) => (
              <FoodCard key={item.id} item={item} index={index} viewingCategory={currentCategory} restaurantId={restaurantId} restaurantSlug={restaurantSlug} showDiet={dietShown} />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
