// "use client" = runs in the browser. The 3D viewer is fully interactive
// (spinning the model, hotspots, AR), so it has to run here.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation"; // reads the "?from=..." in the address
import PublicModelViewer from "@/components/PublicModelViewer"; // wraps the <model-viewer> 3D element
import InfinityLoader from "@/components/InfinityLoader";       // loading spinner
import { modelLoader } from "@/lib/modelLoader";     // 3D model download manager
import { modelWatchlist } from "@/lib/modelWatchlist"; // tracks who's waiting on a model (for toasts)
import { getMenuItem, getMenuItemByModelFolder, getSettings, type MenuItem, type ModelTag } from "@/lib/menu"; // fetch one dish's details
import { getRestaurantBySlug, DEFAULT_RESTAURANT_ID } from "@/lib/tenant"; // resolve the restaurant this viewer belongs to
import { accentPaletteCss, accentCanvasCss } from "@/lib/accent"; // restaurant colour + page canvas
import { allergenIcon, allergenLabel } from "@/lib/allergens"; // allergen icon + label
import { formatPrice, getCurrency, getLanguage, setLanguage, DEFAULT_CURRENCY, type CurrencyMeta } from "@/lib/format"; // money formatting
import { useBackClose } from "@/lib/backStack"; // phone back button closes overlays first
import { useFeatures, getFeatures } from "@/lib/features"; // per-restaurant feature switches (3D / currency / languages)
import { useTranslation } from "@/lib/i18n"; // this screen's own labels, in the guest's language
import { gateAddToCart } from "@/lib/tableConnection"; // "must be at a table to order" gate

// WHILE THE MODEL IS STILL COMING, SHOW THE DISH ANYWAY (sweep #6 T2, 2026-08-17).
//
// The loading panel is opaque and full-screen, so between opening this page and the model
// painting, a diner saw a spinner and nothing else — no dish name, no price, no Add button —
// even though all three were already fetched and sitting in memory. On restaurant wi-fi that
// is a long, blank wait for the one screen this product is sold on. Measured with the model
// file held open: the bottom bar sat at y=801 on a 780px-tall phone (off screen) for the whole
// 15 seconds until the "still preparing" card took over.
//
// So: once the dish's own details are known and the model has NOT arrived within this grace
// period, slide the bar in early. On a normal load the model paints first and `handleLoad`'s
// existing 1s delay still owns the choreography — this timer checks `modelSeenRef` and does
// nothing. It only ever fires on the slow path, which is exactly the path that needed it.
const SLOW_BAR_GRACE_MS = 2500;

// ── WHAT THIS SCREEN'S OWN RESET TAKES AWAY FROM ITS FAILURE CARD ──────────────────────────────
// (sweep #9 T2, 2026-09-14 — item 3.)
//
// `app/globals.css` carries `.viewer-wrapper *{margin:0;padding:0;box-sizing:border-box;…}` — a
// universal reset scoped to this screen's wrapper. It is (0,1,0) specificity, exactly like
// `.try-again-card`, and it is DECLARED LATER in the file, so it wins every tie. Everything inside
// `.viewer-wrapper` therefore loses its margin and its padding, including the whole slow-model
// card, which lives earlier in the same stylesheet and asks for 28px/24px of its own.
//
// MEASURED on the running screen, with every GLB held open so the real overlay arrives at 15s:
//     card      padding 0px   (the stylesheet asks for 28px 24px)
//     emoji     margin  0px   (asks for 12px)
//     title     margin  0px   (asks for 8px)
//     sub       margin  0px   (asks for 20px)
//     Go back   padding 0px   (asks for 12px 24px)  →  the pill renders 76 × 17 px
// Screenshot Read at 360×780: the two-line message runs into the card's rounded corners, and the
// "Go back" pill — the only way off that screen — is a squashed sliver clipped by the card's own
// bottom edge. 17px tall against a 44px tap-target guideline, on the screen a diner meets whenever
// a model is slow, which on restaurant wi-fi is often. After: 124 × 41 px, inside a padded card.
//
// So the five values the reset strips are put back inline, where nothing can out-specify them.
// Inline and not a stylesheet fix, for the same reason the two other workarounds in this file are
// inline: `app/globals.css` belongs to another part of this sweep. If that reset is ever narrowed
// at source these become redundant rather than wrong.
const CARD_PAD = { padding: "28px 24px" } as const;
const CARD_EMOJI = { marginBottom: 12 } as const;
const CARD_TITLE = { margin: "0 0 8px" } as const;
const CARD_SUB = { margin: "0 0 20px" } as const;
const CARD_BTN = { padding: "12px 24px" } as const;

// ── HOW BIG THE DISH IS WHEN IT LANDS IN THE ROOM (owner, 2026-09-20) ────────────────────────
// "whenever in iphone ar been open it too big make it like it actually appears as 40 percent of
// what it's appearing right now."
//
// AR is the one place a 3D model has a REAL-WORLD SIZE, and this one is wrong: measured with
// model-viewer's own getDimensions(), the croissant's bounding box is 1.00 m × 0.33 m × 1.00 m —
// a plate a metre across. On screen that is invisible (the camera is placed in the same units, so
// it fills the frame either way); in Quick Look it is a dinner plate the size of a coffee table.
// His screen recording settles the number: he pinched it down and Quick Look's own badge read
// 41%.
//
// Applied to the <model-viewer> `scale` property, NOT baked into the GLB, because the same four
// files are the reference app's and because a tenant's own uploaded model must get the same
// treatment without anyone re-exporting anything. Verified in the model-viewer 3.4.0 bundle that
// this reaches AR on both phones: `applyTransform()` writes it to `scene.model`, `prepareUSDZ()`
// exports exactly that object, and the USDZ exporter writes each mesh's `matrixWorld` — so the
// file Quick Look opens is already 40%. The same object is what the WebXR renderer presents.
const AR_MODEL_SCALE = 0.4;

// Describes the "config.json" file each dish folder has — the 3D model URLs,
// the title/subtitle/stats, and the hotspot "tags" pinned onto the model.
interface PublicConfig {
  modelUrl?: string;
  smallUrl?: string;
  optimizedUrl?: string;
  title?: string;
  subtitle?: string;
  stats?: {
    calories?: string;
    protein?: string;
    carbs?: string;
    price?: string;
  };
  // ⚰️ `tags` AND `frontView` USED TO LIVE HERE, AND THEY ARE GONE FROM THIS FILE ON PURPOSE
  // (mig 402, owner 2026-09-20). The hotspot cards — the labelled callouts pinned onto the model,
  // and the whole look of this screen — were read out of `/content/items/<folder>/config.json`,
  // a file keyed on a folder NAME that any owner can type and two restaurants can share. That is
  // exactly why this screen had to stop reading the file for every restaurant except #1 (commit
  // c86318c7), and it took the tags away from every other tenant with it: measured on the dev
  // stack, `aevidine`'s croissant and waffle showed a bare spinning model with no cards at all.
  //
  // They now live on the DISH ROW — `menu_items.model_tags` / `model_front_view`, reached through
  // `menuItem` below — which is the only key that is genuinely per-restaurant. Both keys are
  // deleted from the two config.json files, so there is ONE source and it cannot drift.
  // DO NOT re-add them here: a second source is how a tenant inherits somebody else's dish.
}

// Turn a saved "front view" string from config.json into numbers the viewer can
// use. The string looks like "519.36deg 71.39deg 1.937m" (theta phi radius).
// Returns null when nothing was saved (so callers fall back to default framing).
// parseFloat happily ignores the trailing "deg"/"m", e.g. parseFloat("519.36deg") → 519.36.
function parseFrontView(
  raw: string | undefined,
): { theta: number; phi: number; radius: number } | null {
  if (!raw) return null;
  const parts = String(raw).trim().split(/\s+/);
  const theta = parseFloat(parts[0]);
  const phi = parseFloat(parts[1]);
  const radius = parseFloat(parts[2]);
  // Need all three to be real numbers, otherwise treat as "not set".
  if (isNaN(theta) || isNaN(phi) || isNaN(radius)) return null;
  return { theta, phi, radius };
}

// The 3D viewer component. `folder` tells us which dish's model + config to load.
export default function ViewerClient({ folder }: { folder: string }) {
  const t = useTranslation(); // this screen's labels in the guest's chosen language
  // The pieces of memory this screen keeps:
  const [config, setConfig] = useState<PublicConfig | null>(null);  // the loaded config.json
  const [loading, setLoading] = useState(true);          // still loading the config?
  const [error, setError] = useState<string | null>(null); // an error message, if loading failed
  const [barVisible, setBarVisible] = useState(false);   // has the bottom info bar slid in?
  const [loaderVisible, setLoaderVisible] = useState(true); // is the spinner showing?
  const [activeUrl, setActiveUrl] = useState<string | null>(null); // which model file to actually show
  const [showTryAgain, setShowTryAgain] = useState(false); // show the "taking longer" overlay?
  const [menuItem, setMenuItem] = useState<MenuItem | null>(null); // the dish's menu details
  // For NON-#1 restaurants, the model to show comes from THAT restaurant's own DB
  // record (its uploaded GLB), not the shared static /content config — otherwise two
  // restaurants sharing a folder name would see the same model. #1 keeps using its
  // static config unchanged (this stays null for #1), so the gold-standard viewer is
  // untouched. (audit fix 2026-07-07)
  const [dbModel, setDbModel] = useState<{ small?: string; opt?: string } | null>(null);
  // Has the dish lookup SETTLED? Not "did it find something" — found, not found and failed all
  // count. The reveal must not START before this is true: it paints the hotspot cards in one by
  // one, and a card that arrives after its own animation has already run stays invisible for good
  // (they sit at opacity 0 until `startTagAnimation` lifts them). The tags used to arrive with the
  // config, which always beat the model; since mig 402 they arrive with the DISH, and nothing
  // orders those two reads.
  //
  // It gates the REVEAL, never the model's `load` listener — see requestReveal. Gating the whole
  // effect was the obvious version and it is wrong: the listener would then be attached one commit
  // late, miss a `load` that had already fired, and leave the spinner turning over a model the
  // guest can already see until the 4s safety net caught it. MEASURED on this stack: one Waffle
  // open in ten arrived with no cards at all.
  const [dishSettled, setDishSettled] = useState(false);
  // dishSettled as a ref, because the load handler is captured in a closure that must read the
  // CURRENT answer rather than the one that was true when it was created.
  const dishSettledRef = useRef(false);
  // "The model is ready and the reveal was asked for, but the dish had not landed yet." The
  // effect below plays it the moment the dish does.
  const revealPendingRef = useRef(false);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null); // currency for prices
  const [accentCss, setAccentCss] = useState<string>(""); // this restaurant's colour for the viewer chrome
  // Which restaurant this viewer belongs to, resolved from ?r= (defaults to #1
  // until resolved, so an unresolved link behaves exactly as before). Drives the
  // per-restaurant feature switches below.
  const [rid, setRid] = useState<string>(DEFAULT_RESTAURANT_ID);
  const features = useFeatures(rid); // 3D viewer / currency / language switches for THIS restaurant
  const [loadFailed, setLoadFailed] = useState(false); // did the 3D model give up loading for good?
  // WHY THIS SCREEN IS SHOWING, NOT JUST THAT IT IS (owner's item 5, 2026-09-14).
  //
  // Two different things land a diner here and they deserve different endings:
  //   "closed"  — the restaurant is REAL and we reached it; its Menu switch is off, or it is in
  //               Service mode. There is an honest place to send them: its own menu, which will
  //               tell them the same thing in the restaurant's own words.
  //   "unknown" — the `?r=` slug resolves to nothing. There is NO honest destination: every link
  //               we could build points at the same unknown restaurant, and an unknown restaurant's
  //               menu is another dead end. `app/item/[slug]/not-found.tsx`'s own rule is that a
  //               way out is only offered "once it knows the menu answers" — so this one offers
  //               none, and the sentence about asking a member of staff is the whole answer.
  //
  // Measured before this: the screen had ZERO tappable controls in BOTH cases, while its two
  // siblings on this same screen (3D switched off, config failed) each had a Back button. On a
  // link forwarded to a friend there is no history to go back to either, so a diner was stuck.
  //
  // null = this screen is not showing at all, which is the ordinary case.
  const [unavailable, setUnavailable] = useState<null | "closed" | "unknown">(null);
  const [showInfo, setShowInfo] = useState(false);       // is the details sheet open?
  // Phone back button closes the details sheet first, not the whole viewer page
  // (every overlay must register with the back manager — audit fix 2026-07-06).
  useBackClose("viewer-info", showInfo, () => setShowInfo(false));
  const [hintVisible, setHintVisible] = useState(false); // is the hint pill showing?
  // HOW TALL THE DISH BAR ACTUALLY IS (sweep #7 T2, 2026-08-22 — item 2).
  //
  // `.viewer-wrapper #dbl-hint` in app/globals.css pins the hint pill at a HARDCODED
  // `bottom: 176px`, but `#bar` is `bottom: 0` and its height is content-driven — dish name,
  // description, a four-stat row, a button row and the safe-area inset. Measured on the running
  // viewer: the bar is 208 px tall on a 360×780 phone and the pill was pinned 176 px up, so 32 px
  // of its 34 px sat INSIDE it, and `elementFromPoint` at the pill's own centre came back `#bar` (z-index 30 beats 25).
  // The bar's background is a gradient that fades to transparent at the top, so the pill was not
  // even cleanly hidden — its words were left crossing the dish title, which reads as a rendering
  // fault. Same on 375×667 (32 px of 34) and on a 1280×800 desktop (20 px of 34).
  //
  // The sentence being swallowed is the one the owner asked for on 2026-08-12 — "Drag to turn it
  // around", the only thing that teaches a diner the dish can be spun. It has therefore never
  // been readable on a phone.
  //
  // So the pill is placed from the bar's REAL height instead of a guess. Measured with a
  // ResizeObserver because the height genuinely moves: a long dish name wraps to two lines, and
  // rotating a phone re-flows the whole bar. 0 means "not measured yet" — the stylesheet's 176 px
  // stays in charge until then, so nothing flashes.
  const [barHeight, setBarHeight] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  // I5 (owner, 2026-08-12): NOTHING told a diner the dish can be turned. The 3D dish is what makes
  // this product different and it relied on people fiddling to find out. The FIRST time the pill pops
  // it now says "Drag to turn it around"; every pop after that is the existing triple-tap reminder.
  // Reusing the one pill means no second thing on screen and no new styling — and the first sentence
  // a diner reads is the one that teaches them the feature.
  const [hintSpin, setHintSpin] = useState(true);
  // Refs hold values across redraws without triggering one:
  const mvRef = useRef<ModelViewerElement>(null); // a handle to the actual <model-viewer> element
  const startedRef = useRef(false);   // has the reveal animation started yet?
  const requestRef = useRef<number>(0); // id of the running animation loop (so we can stop it)
  const modelSeenRef = useRef(false);  // has the model actually appeared on screen?
  // IS THIS SCREEN STILL ON SCREEN? (sweep #7 T2, 2026-08-22 — item 1.)
  //
  // `requestRef` remembers only the LATEST animation-frame handle, so cancelling it stops one
  // chain and one only. The connector-line loop below re-arms itself every frame, and it can be
  // STARTED after this component has already gone: `handleLoad` schedules the reveal 800 ms later
  // and that timer was never cleared, so a diner who glanced at the dish and tapped Back inside
  // that window left a loop running on the page they went back to. Measured on the dish page,
  // twenty seconds after leaving the 3D screen: SIX chains, 360 animation frames a second,
  // forever — each frame reading three elements per hotspot out of a document that no longer has
  // them. A phone that gets warm holding a menu.
  //
  // A ref, not state: it must be readable from a callback that outlives the render that made it.
  // Set false only by the unmount effect below — never by the model effect's cleanup, which also
  // runs on an ordinary small→optimized upgrade, where the loop must keep going.
  // It is set TRUE in the effect body as well as at declaration: React's development Strict Mode
  // mounts, unmounts and remounts every component once, so a flag that is only ever turned OFF by
  // a cleanup is left off for the rest of the real mount — which would silently disable the
  // connector lines instead of merely stopping them at the right time.
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  // WHICH CONNECTOR-LINE CHAIN IS THE LIVE ONE (sweep #9 T2, 2026-09-14 — item 1).
  //
  // `aliveRef` above stops every chain when the screen goes. It does NOT stop a second chain
  // starting while the screen is still here — and `runFullSequence` starts one every time it runs.
  // It runs on the first reveal, on entering AR, and on EVERY triple-tap, which is the gesture the
  // hint pill on this screen advertises ("Triple-tap to replay"). `requestRef` remembers only the
  // newest handle, so nothing ever cancelled the older chains: each replay left one more loop
  // reading three elements per hotspot, every frame, for as long as the diner stayed on the screen.
  //
  // MEASURED on a 360×780 phone, counting real layout reads per second on the working 3D screen:
  // 936 after one reveal, 4,356 after three more triple-taps — 4.65× the work, forever. Ten
  // replays is eleven loops. That is the phone getting warm and the model stuttering while it
  // spins, on the one screen this product is sold on. After the fix: 1,080 and 1,080.
  //
  // A generation counter, not a second `cancelAnimationFrame` alone: a chain that has already been
  // scheduled must recognise that it is no longer the current one and stop re-arming itself. The
  // cancel at the call site is the immediate half; this is the half that cannot be raced.
  const loopGenRef = useRef(0);
  const searchParams = useSearchParams();        // the address's "?..." part
  const fromSlug = searchParams.get("from") || ""; // which dish we came from
  // Which RESTAURANT this viewer belongs to (carried as ?r=<slug> from the dish
  // page). The /view route has no tenant in its path, so without this the dish
  // details + Back link + prices all defaulted to restaurant #1 — showing the
  // wrong restaurant's dish for any non-#1 tenant (audit fix 2026-07-06).
  const fromRestaurant = searchParams.get("r") || "";
  // DO WE KNOW YET WHOSE SCREEN THIS IS? (sweep #8 T2, 2026-09-02 — item 1.)
  //
  // `rid` above starts at restaurant #1 and only becomes the real one after an async lookup, so
  // for the first beat of a `?r=<tenant>` link this component genuinely believes it is #1. That was
  // harmless while every answer came from the tenant's own database row — and it is NOT harmless
  // for the one thing that is read off the flagship's own static files, the `/content/items/<folder>`
  // demo config. See the long note in the config effect below.
  //
  // No `?r=` at all means there is nothing to wait for: the address IS restaurant #1's own door, so
  // this starts true and that path is unchanged, spinner and all.
  const [ridReady, setRidReady] = useState(!fromRestaurant);
  const itemBase = fromRestaurant ? `/r/${fromRestaurant}` : "";
  // Which category the guest was browsing (carried from the dish page). Preserve
  // it on the Back link so the item page's prev/next arrows keep walking the SAME
  // list the guest came from, not the dish's own category (audit fix bug #17).
  const fromCat = searchParams.get("cat") || "";
  const catQs = fromCat ? `?cat=${encodeURIComponent(fromCat)}` : "";
  // Where the Back button goes: to that dish (in THIS restaurant) if we know it,
  // else that restaurant's menu.
  const backHref = fromSlug ? `${itemBase}/item/${fromSlug}${catQs}` : `${itemBase}/menu`;

  // The bar's name/stats/price come from the actual MENU item, not config.json
  // (config is only the hotspots/tags). Falls back to config if the item is missing.
  // Runs when we arrive (and if the source dish/restaurant changes).
  useEffect(() => {
    // CONCURRENCY GUARD: fromSlug can change (back/forward between dishes); ignore a
    // late reply from a previous fromSlug so it can't overwrite the current dish.
    let cancelled = false;
    // Resolve the restaurant (from ?r=) FIRST, then fetch the dish scoped to it,
    // so a non-#1 restaurant's viewer shows ITS dish + price, not #1's.
    (async () => {
      let rid = DEFAULT_RESTAURANT_ID;
      if (fromRestaurant) {
        // `.catch(() => null)` is not tidying: this call had no catch, so a dropped signal rejected
        // the whole IIFE, `unavailable` was never set and `ridReady` below would never be set
        // either. A restaurant we cannot look up is exactly the case the line under this one exists
        // for — say "not available" rather than fall through to somebody else's dish.
        const r = await getRestaurantBySlug(fromRestaurant).catch(() => null);
        // A ?r= that names a restaurant which is inactive, binned or simply unknown used to
        // leave rid at the #1 DEFAULT — so the viewer quietly showed FRENCH HOUSE's dish of
        // that slug (its name, description and price) under another restaurant's link. Say
        // "not available" instead of showing someone else's dish (guest sweep 2026-08-04).
        if (!r) { if (!cancelled) setUnavailable("unknown"); return; }
        {
          rid = r.id;
          if (!cancelled) { setRid(r.id); setRidReady(true); } // drive useFeatures(), and release the config effect
          // TELL THE TAB WHICH RESTAURANT IT IS IN (sweep #6 T2, 2026-08-17).
          //
          // /view has no /r/<slug> in its path, so lib/tenantStorage.ts's tenantSlug() falls back
          // to "the slug this tab last visited", kept in this sessionStorage key. Arriving here
          // from the menu sets it on the way through — but a 3D link opened COLD (forwarded to a
          // friend, bookmarked, re-opened in a new tab) has no such history, so tenantSlug()
          // answered "restaurant #1". Measured: `lfh_tab_tenant` is null on a cold /view. Every
          // tenant-scoped key then resolves to the wrong restaurant, so a dish added from this
          // screen landed in restaurant #1's basket and had vanished by the time the diner tapped
          // Back to their own menu.
          //
          // We know the answer here — ?r= just resolved to a real, live restaurant — so record it.
          // Only on a successful resolve: an unknown slug returns above and must not overwrite a
          // tab's genuine history. The key name is owned by lib/tenantStorage.ts (LAST_SLUG_KEY);
          // scripts/verify-3d-viewer.mjs fails if the two literals ever drift apart.
          try { sessionStorage.setItem("lfh_tab_tenant", r.slug); } catch {}
          // WHITE-LABEL COLOUR (audit fix bug #2): the /view route lives outside
          // the menu's AppShell, so its BACK / AR / Add-to-Order buttons defaulted
          // to French House gold for every restaurant. Emit this restaurant's
          // accent palette at :root here too. Only non-#1 restaurants carry an
          // accent_color, so #1 keeps its gold.
          if (r.id !== DEFAULT_RESTAURANT_ID && r.accentColor && !cancelled) {
            // Canvas first, accent family second — same pairing as the menu and the dish page, so the
            // 3D screen is not the one surface still wearing restaurant #1's brown.
            setAccentCss(`${accentCanvasCss(r.accentColor)}:root{${accentPaletteCss(r.accentColor)}}`);
          }
        }
      }
      // The 3D page lives outside the menu's AppShell, so it never saw the two things that
      // close a restaurant's guest menu: the Menu master switch and Service (maintenance)
      // mode. A dish stayed viewable in 3D while the menu itself said "we'll be right back"
      // (guest sweep 2026-08-04). getSettings is cached per restaurant, so this is ~free.
      try {
        const s = await getSettings(rid);
        if (!s.menuEnabled || s.serviceMode) { if (!cancelled) setUnavailable("closed"); return; }
      } catch { /* can't tell → carry on rather than hide a working dish */ }
      if (cancelled) return;
      try {
        // A 3D link normally carries `?from=<slug>` — the menu and the dish page both add it.
        // A BOOKMARKED or forwarded one does not, and neither does the "your model is ready"
        // ticket for a dish with no slug. That used to cost only the name in the bottom bar,
        // because the callout cards came from a file named after the folder. They come from the
        // dish now (mig 402), so no dish means no cards: find it by its folder instead, scoped
        // to this restaurant, on migration 402's index. One extra read, only on the cold link.
        const m = fromSlug
          ? await getMenuItem(fromSlug, rid)
          : await getMenuItemByModelFolder(folder, rid);
        if (cancelled) return;
        setMenuItem(m);
        // Non-#1 restaurant with its own uploaded model → use it as the source of
        // truth. #1 (or a dish with no DB model) leaves this null → static config.
        if (rid !== DEFAULT_RESTAURANT_ID && (m?.modelSmallUrl || m?.modelOptimizedUrl)) {
          setDbModel({ small: m.modelSmallUrl, opt: m.modelOptimizedUrl });
        } else {
          setDbModel(null);
        }
      } catch {}
      // SETTLED, whatever the answer was — see `dishSettled`. This runs on the success path, on a
      // dish that does not exist, and on a thrown read; the two `return`s above (unknown
      // restaurant / closed menu) deliberately leave it false, because those screens never reach
      // a model at all.
      if (!cancelled) setDishSettled(true);
    })();
    return () => { cancelled = true; };
  }, [fromSlug, fromRestaurant, folder]);

  // ── THE HOTSPOT TAGS, FROM THE DISH'S OWN ROW (mig 402) ──────────────────────────────────────
  // The labelled cards pinned onto the model. ONE source: `menu_items.model_tags`, scoped to this
  // restaurant by the query that fetched it — so two restaurants whose folders are both called
  // "Croissant" get their own cards, and neither can inherit the other's. Memoised because three
  // separate animation routines walk this list every frame; a fresh array each render would
  // retire and restart the connector-line loop.
  const tags = useMemo(() => menuItem?.modelTags ?? [], [menuItem?.modelTags]);
  // The saved opening pose, same journey and same reasoning (menu_items.model_front_view).
  const frontView = menuItem?.modelFrontView;
  // ── AND THE ANIMATIONS READ THEM THROUGH A REF, NOT THROUGH THE CLOSURE ──────────────────────
  // The three routines that walk this list (the connector-line loop, the staggered reveal, the
  // reset) are plain functions re-created every render, and they are called from timers and DOM
  // listeners that were handed a FUNCTION FROM AN EARLIER RENDER. The model's 800 ms reveal timer
  // is set up by an effect keyed on [loading, error, activeUrl, folder] — none of which move when
  // the dish arrives — so it happily fires a copy of `runFullSequence` that closed over an empty
  // tag list.
  //
  // MEASURED, and this is what the reset does when that happens: it clears every `.hs-card-wrap`
  // on the page by selector (opacity 0, scale 0.8) and then walks the EMPTY list to bring them
  // back, so all three cards exist, sit in the right place, and are invisible forever. Restaurant
  // #1's croissant, `[DBG] runFullSequence tags= 0` with the dish plainly loaded in the bar below.
  // Reading the ref at call time is what makes the answer current instead of remembered.
  // What the camera and the smoothing were before the AR handoff shrank the dish (AR_MODEL_SCALE).
  // Null whenever no handoff is in flight, so a double "not-presenting" cannot re-apply anything.
  const arRestoreRef = useRef<{ orbit: string; decay: number | undefined; minOrbit: string | null } | null>(null);
  const tagsRef = useRef<ModelTag[]>([]);
  // Same trap, smaller blast radius: the cinematic reads the saved pose when it STARTS, so a
  // stale copy lands the dish on the default framing instead of the one that was saved for it.
  const frontViewRef = useRef<string | undefined>(undefined);
  useEffect(() => { tagsRef.current = tags; frontViewRef.current = frontView; }, [tags, frontView]);

  // Pin the display when a restaurant has those pickers switched off (the menu's
  // Header does the same, but the /view route lives outside it). Currency OFF →
  // always show base INR; languages OFF → force English. The listener keeps an
  // open viewer's prices live if the guest changes currency elsewhere (mirrors
  // the dish page). Re-runs if either switch changes for this restaurant.
  useEffect(() => {
    const readCur = () =>
      setCurrency(features.currency === false ? DEFAULT_CURRENCY : getCurrency());
    readCur();
    if (features.languages === false && getLanguage().code !== "en") setLanguage("en");
    window.addEventListener("lfh:currency-changed", readCur);
    return () => window.removeEventListener("lfh:currency-changed", readCur);
  }, [features.currency, features.languages]);

  // Is this dish flagged sold-out? Read once so the button and the handler agree.
  // The menu card and the dish page BOTH refuse a sold-out dish; this screen was the
  // one add path that did not, so a guest could put an unavailable dish on their bill
  // from 3D and only be told at Place Order (guest sweep 2026-08-04).
  const soldOut = ((menuItem?.tags as string[] | undefined) || []).includes("sold-out");

  // Open the SAME confirm popup the dish-detail page uses (qty picker + total),
  // handled by the globally-mounted OrderConfirmModal.
  const addToOrder = () => {
    if (!menuItem) return;
    // Belt-and-braces, exactly like ItemClient's addToCart: the button below is
    // already disabled, and this stops a sold-out dish reaching the cart anyway.
    if (soldOut) {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: `${menuItem.title} isn't available right now`,
        subtitle: "please pick something else, or ask a member of staff",
        kicker: "3D view", variant: "error",
      } }));
      return;
    }
    // THE TABLE GATE — THIS WAS THE ONE ADD BUTTON WITHOUT IT (sweep #6 T2, 2026-08-17).
    //
    // The rule (owner, 2026-06-11) is that while dining sessions are ON, a dish can only join
    // the cart once the guest is an APPROVED member of an open table session. Every other Add
    // in the app already asks: the menu card (components/FoodCard.tsx), the dish page
    // (ItemClient.tsx) and the cart's own re-add (components/CartPanel.tsx). The 3D screen did
    // not — so a diner who opened a dish in 3D before joining their table had it accepted
    // silently, was never shown the join flow, and only met the rule at Place Order. That is
    // the same shape as the sold-out hole this file already fixed a few lines up, and the same
    // remedy: call the shared gate, which either adds now or holds the add and opens the join
    // flow, replaying it the moment the guest is connected.
    gateAddToCart(() => {
      window.dispatchEvent(
        new CustomEvent("lfh:open-order-confirm", {
          detail: {
            item: {
              id: menuItem.id,
              title: menuItem.title,
              price: menuItem.price,
              image: menuItem.image,
            },
            options: menuItem.options,
            allergens: menuItem.allergens,
          },
        })
      );
    });
  };

  // Format a price for the current currency (falls back to $ if not loaded yet).
  const showPrice = (p: string) => (currency ? formatPrice(p, currency) : `$${p}`);

  // The replay hint gently pops in shortly after the dish appears, lingers ~3s,
  // fades, then repeats every 7s — a soft reminder, never forced on screen.
  // Re-runs whenever the bottom bar becomes visible/hidden.
  useEffect(() => {
    // Only once the dish is shown AND the model is actually on screen. The bar can now arrive
    // ahead of the model on a slow connection (see SLOW_BAR_GRACE_MS), and "Drag to turn it
    // around" is nonsense while the canvas is still an empty loading panel — it would be the
    // app telling a diner to interact with something that is not there yet.
    if (!barVisible || loaderVisible) return;
    let hideTimer: ReturnType<typeof setTimeout>;
    // Show the hint, then hide it again after 3 seconds.
    const pop = () => {
      setHintVisible(true);
      hideTimer = setTimeout(() => {
        setHintVisible(false);
        // After the first pop has been READ (i.e. once it fades), fall back to the replay reminder.
        setHintSpin(false);
      }, 3000);
    };
    const first = setTimeout(pop, 1200);  // first pop ~1.2s in
    const loop = setInterval(pop, 7000);  // then repeat every 7s
    // Cleanup: stop all the timers when leaving / when the bar hides.
    return () => {
      clearTimeout(first);
      clearTimeout(hideTimer);
      clearInterval(loop);
    };
  }, [barVisible, loaderVisible]);

  // Keep `barHeight` honest — see the note where it is declared. The observer watches the bar
  // itself, so a name that wraps to a second line moves the pill with it. `translateY` does not
  // affect the measured height, so this is right even before the bar has slid in.
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => setBarHeight(Math.round(el.getBoundingClientRect().height));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [config, menuItem]);

  // Load this dish folder's config.json (the model URLs + hotspot tags).
  // Re-runs if the folder changes.
  useEffect(() => {
    // CONCURRENCY GUARD: folder can change while a config fetch is still in flight;
    // ignore a stale earlier response so it can't replace the new folder's config.
    // WAIT UNTIL WE KNOW WHOSE SCREEN THIS IS (sweep #8 T2, 2026-09-02 — item 1). Without this the
    // first pass of this effect runs while `rid` is still the provisional restaurant #1, which is
    // precisely the mistake the flagship-only test below exists to prevent. `ridReady` is true from
    // the start when there is no `?r=`, so restaurant #1's own door is unchanged.
    if (!ridReady) return;
    let cancelled = false;
    const normalizedFolder = (folder || "");
    // 3D SWITCH (per restaurant): if this restaurant has the 3D viewer turned off,
    // skip ALL model work — no config.json fetch and no GLB download. getFeatures is
    // cached so this costs nothing extra; an unresolved rid = #1 defaults = on, so
    // #1 behaves exactly as before.
    getFeatures(rid).then((feats) => {
      if (cancelled) return;
      if (feats.model3d === false) { setLoading(false); return; }
      // ── THE STATIC CONFIG BELONGS TO RESTAURANT #1, AND ONLY TO IT ─────────────────────────
      //
      // `public/content/items/` holds exactly two folders — `Croissant` and `Waffle` — and they
      // are restaurant #1's own legacy demo dishes, checked into this repo. Nothing writes to that
      // directory; `scripts/set-glb-cache.mjs` calls it "legacy demo content holding two dishes".
      // EVERY other restaurant serves its model, name, description and stats from its own database
      // row, which is why the 404 a beat below already falls back to an empty config for them.
      //
      // The hole was the folder NAME. This route is `/view/<folder>`, and the folder is whatever an
      // owner typed into the editor — so a second restaurant that calls its croissant folder
      // "Croissant" scored a hit on #1's file and inherited the lot. MEASURED on this stack:
      // `/view/Croissant?r=aangan-garden-restaurant` served, under Aangan's own orange, restaurant
      // #1's model (`croissant_small.glb` + `croissant-optimized.glb`, ~11 MB), #1's dish name
      // "Croissant Sandwich" in the bottom bar, and #1's three hotspot cards — "Croissant / Sauce /
      // Salad" with #1's wording — pinned onto the dish. `/view/Waffle?r=pizza-palace` did the same.
      // The existing `dbModel` rule rescues the MODEL once the tenant's own row lands; it never
      // covered the hotspots, the title, the subtitle or the stats, and it cannot cover the ~2 MB
      // that is already downloading by then.
      //
      // So the static file is read only when this really is restaurant #1. For every other tenant
      // this is the empty config they already got — the ONLY case it changes is the name collision,
      // and it saves them one 404 round trip per 3D open on the way.
      if (rid !== DEFAULT_RESTAURANT_ID) { setConfig({}); setLoading(false); return; }
      fetch(`/content/items/${normalizedFolder}/config.json`)
        .then((res) => {
          // No static config.json for this folder (only #1's flagship dishes ship one; every
          // OTHER restaurant serves its model + name/stats from the DB) → fall back to an EMPTY
          // config so the dish's own model still renders, instead of the "Failed to load" screen.
          // A real server error (5xx) is still treated as a failure. (white-label fix 2026-07-09)
          if (res.status === 404) return null;
          if (!res.ok) throw new Error("Failed to load config");
          return res.json();  // turn the response into a usable object
        })
        .then((data) => {
          if (cancelled) return; // a newer folder superseded this fetch
          // Empty config = no hotspots/framing; the model comes from the DB (dbModel) and the
          // name/stats from the menu item. A dish with no model at all still degrades to the
          // 32s "3D unavailable" overlay (the patience timers run once loading/error clear).
          setConfig(data || {}); // store the config (or an empty one when none is published)
          setLoading(false);   // done loading
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);  // remember the error to show it
          setLoading(false);
        });
    });
    return () => { cancelled = true; };
  }, [folder, rid, ridReady]);

  // Once the config is loaded, decide which model file to actually display:
  // prefer the high-quality "optimized" one, but show the small one first if
  // that's what's ready, and upgrade when the better one finishes loading.
  useEffect(() => {
    if (!config) return;  // wait for the config
    if (features.model3d === false) return; // 3D off for this restaurant: never download GLBs
    // Model files: a non-#1 restaurant's OWN uploaded model wins; otherwise the
    // static config's. The config still supplies the hotspots/framing either way.
    const small = dbModel?.small || config.smallUrl;   // the fast ~2MB model
    const opt = dbModel?.opt || config.optimizedUrl;   // the high-quality ~9MB model
    // Old-style config with a single URL? Just use it and stop.
    if (!small && !opt) {
      if (config.modelUrl) setActiveUrl(config.modelUrl);
      return;
    }

    // Ask the loader to download these (small first), as a priority.
    const urls: string[] = [];
    if (small) urls.push(small);
    if (opt) urls.push(opt);
    modelLoader.prioritize(urls);

    // If neither model is ready yet, add this dish to the "watchlist" so a
    // toast can notify the guest when it finishes loading.
    const somethingReady =
      (opt && modelLoader.isLoaded(opt)) ||
      (small && modelLoader.isLoaded(small));
    if (!somethingReady) {
      modelWatchlist.watch({
        folder,
        // THE TICKET MUST NAME THE DISH THE DINER TAPPED (sweep #6 T2, 2026-08-17).
        //
        // `config.title` is the STATIC /content config's name, which belongs to restaurant #1's
        // flagship folder — not to the dish on screen. Measured: opening "Avocado & Cream Cheese"
        // in 3D and walking away produced the ticket **"Croissant Sandwich in 3D — ready to view"**,
        // because both dishes share the "Croissant" model folder. Worse for everyone else: no other
        // restaurant ships a static config at all, so `config.title` is undefined and the fallback
        // handed the diner the raw folder slug as a dish name.
        //
        // The live menu name first, exactly like the bottom bar's title and the viewer's alt text
        // two screens down — so all three say the same thing about the same dish.
        title: menuItem?.title || config.title || folder,
        slug: fromSlug || undefined,
        cat: fromCat || undefined, // so the ready-ticket's viewer keeps the guest's list (bug #17)
        smallUrl: small,
        optimizedUrl: opt,
      });
    }

    // Pick the best model that's ready right now (optimized beats small).
    const pick = () => {
      if (opt && modelLoader.isLoaded(opt)) {
        return modelLoader.getCachedUrl(opt) ?? opt;
      }
      if (small && modelLoader.isLoaded(small)) {
        return modelLoader.getCachedUrl(small) ?? small;
      }
      return null;  // nothing ready yet
    };

    // Set the chosen model as the active one (only if it actually changed).
    const apply = () => {
      const best = pick();
      if (best) setActiveUrl((prev) => (prev === best ? prev : best));
      // FAILED-FOR-GOOD detection (audit fix bug #10): if the loader has given up
      // on every model file for this dish (and none loaded), flip the "failed"
      // flag so the overlay shows a real "3D unavailable" message instead of a
      // "still preparing, we'll let you know" promise that will never come true.
      const candidates = [small, opt, config.modelUrl].filter(Boolean) as string[];
      const anyLoaded = candidates.some((u) => modelLoader.isLoaded(u));
      const allFailed = candidates.length > 0 && candidates.every((u) => modelLoader.hasFailed(u));
      if (!anyLoaded && allFailed) setLoadFailed(true);
    };

    apply();  // try once now
    // ...and re-try every time the loader reports progress, so we upgrade from
    // small to optimized automatically. subscribe returns an "unsubscribe"
    // function, which we return so React stops listening when we leave.
    const unsub = modelLoader.subscribe(apply);
    return unsub;
    // `menuItem?.title` (the string, not the object) is a dep so the watchlist entry above is
    // re-written with the live dish name the moment it resolves. Re-running is cheap and safe:
    // prioritize() skips anything already loaded or in flight, watch() overwrites by folder, and
    // apply() only calls setActiveUrl when the value actually changed.
  }, [config, folder, fromSlug, fromCat, dbModel, features.model3d, menuItem?.title]);

  // The slow-path rescue described at SLOW_BAR_GRACE_MS: as soon as we know the dish, give the
  // model a moment, then show the bar regardless. Idempotent with handleLoad's own reveal.
  useEffect(() => {
    if (!menuItem || barVisible) return;
    const t = setTimeout(() => { if (!modelSeenRef.current) setBarVisible(true); }, SLOW_BAR_GRACE_MS);
    return () => clearTimeout(t);
  }, [menuItem, barVisible]);

  // Wire up what happens once the 3D model element is on the page: when it
  // finishes loading, hide the spinner, slide in the bar, and play the reveal.
  useEffect(() => {
    if (loading || error || !mvRef.current || !activeUrl) return;  // not ready yet

    const mv = mvRef.current;  // the <model-viewer> element
    // EVERY TIMER THIS EFFECT STARTS IS CLEARED WHEN IT ENDS (sweep #7 T2, 2026-08-22 — item 1).
    // The two below were fire-and-forget, so leaving the screen inside their window ran them
    // against a component that no longer existed — and the 800 ms one starts the immortal
    // connector-line loop. See the note on aliveRef.
    const timers: ReturnType<typeof setTimeout>[] = [];

    // ── SCHEDULING THE REVEAL IS NOT THE SAME AS HAVING PLAYED IT ────────────────────────────
    // `startedRef` used to be set the moment the 800 ms timer was ARMED, and that timer is
    // cleared when this effect is torn down — which happens on the ordinary, expected event of
    // the model upgrading from the ~2 MB preview to the ~9 MB version (`activeUrl` changes). If
    // the better file lands inside that 800 ms window, the timer is cancelled and the flag says
    // the reveal already happened, so nothing ever plays it: the callout cards stay at opacity 0
    // for the whole visit. MEASURED on restaurant #1's waffle, on a SECOND visit — with both GLBs
    // already in the model cache the two loads are milliseconds apart, so the better the guest's
    // connection and the more they browse, the likelier they lose the cards entirely.
    //
    // So the flag now means PLAYED, set inside the timer, and arming is idempotent. A torn-down
    // schedule is simply re-armed by the next load, which is what the upgrade fires anyway.
    const armReveal = (delay: number) => {
      if (startedRef.current) return;
      timers.push(setTimeout(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        requestReveal();
      }, delay));
    };

    // The model finished loading and is now visible.
    const handleLoad = () => {
      modelSeenRef.current = true;             // remember it appeared
      modelWatchlist.unwatchByFolder(folder);  // no need to notify anymore
      setShowTryAgain(false);                  // hide any "taking longer" overlay
      setLoaderVisible(false);                 // hide the spinner
      timers.push(setTimeout(() => {
        setBarVisible(true);                   // slide in the bottom info bar after 1s
      }, 1000));
      // keep the "triple-tap to replay" hint visible as a persistent cue
      // Play the reveal animation once, shortly after the model appears.
      armReveal(800);
    };

    // ── AR: NO TAGS IN THE ROOM, AND THE DISH GOES BACK TO ITS SCREEN SIZE ON THE WAY OUT ────
    // REJECTED (owner, 2026-09-20 — R57): "in the android also in ar i don't want tags i just want
    // tags in 3d." An AR session is the ONE place the cards are hidden; everywhere else they stay,
    // with no switch (docs/REJECTED-IDEAS.md R57, .claude/rules/3d-viewer.md).
    // On Android the AR session is WebXR, which keeps the PAGE's own DOM on top of the camera
    // feed — so the three callout cards and their leader lines were floating over his room.
    // (On an iPhone the session is Quick Look, a separate screen, so they were never there.)
    //
    // ⚰️ WHAT STOOD HERE: `session-started` REPLAYED the whole reveal, deliberately, so the cards
    // animated themselves in over the camera feed. That is the thing he is asking to be rid of;
    // it is deleted rather than left switched off. The cards are hidden by one class for the
    // length of the session — never unmounted, because the tags may not be removed (R44) and a
    // card that is taken out of the DOM cannot come back with the reveal that owns it.
    const handleARStatus = (e: any) => {
      const status = e.detail?.status;
      if (status === "session-started") {
        document.body.classList.add("ar-presenting");
      } else if (status === "not-presenting" || status === "failed") {
        document.body.classList.remove("ar-presenting");
        endArSizing();
      }
    };

    // A model file that downloads but can't be parsed (corrupt/partial GLB) makes
    // <model-viewer> fire "error", NOT "load" — without this the spinner would spin
    // forever. Treat it as a definitive failure so the guest gets a real message.
    const handleError = () => { if (!modelSeenRef.current) setLoadFailed(true); };

    // Start listening for those events on the model element.
    mv.addEventListener("load", handleLoad);
    mv.addEventListener("error", handleError);
    mv.addEventListener("ar-status", handleARStatus);

    // The model was ALREADY loaded when this effect (re)ran — either it finished between the
    // commit that mounted it and this one, or this is the re-run after an upgrade that has
    // nothing left to load. Either way no further `load` event is coming, so arm here too.
    if ((mv as any).loaded) armReveal(800);

    // Safety net: if "load" never fires within 4s, play the reveal anyway.
    const startTimeout = setTimeout(() => armReveal(0), 4000);

    // Cleanup: stop listening and cancel timers/animation when leaving.
    return () => {
      mv.removeEventListener("load", handleLoad);
      mv.removeEventListener("error", handleError);
      mv.removeEventListener("ar-status", handleARStatus);
      // Leaving the screen mid-AR must not strand the class or the 40% size on a component the
      // next dish will mount into.
      document.body.classList.remove("ar-presenting");
      endArSizing();
      clearTimeout(startTimeout);
      timers.forEach(clearTimeout);
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
    // runFullSequence is a stable closure; re-running on its identity would
    // restart the cinematic on every render. Re-run only on these state deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, activeUrl, folder]);

  // A patience timer: if the model still hasn't shown after 15 seconds, show
  // the friendly "still preparing" overlay instead of leaving them guessing.
  useEffect(() => {
    if (loading || error) return;
    // Only fall back to the "taking longer" overlay if the model genuinely
    // hasn't arrived after a generous window. The small GLB (~2 MB) can still
    // be downloading on a cold/slow first visit (the menu only preheats the
    // small model now, not the heavy optimized one), and the InfinityLoader
    // stays on screen meanwhile — so 6 s was too eager and looked like a failure.
    const t = setTimeout(() => {
      if (!modelSeenRef.current) {
        setShowTryAgain(true);
      }
    }, 15000);
    // Escalation: if the model STILL hasn't shown much later, stop promising "still
    // preparing" (which would hang forever when the model-viewer script is blocked or
    // the file never arrives) and switch to a definitive "unavailable" + retry. If a
    // slow model does eventually load, handleLoad hides this overlay, so it self-heals.
    const t2 = setTimeout(() => {
      if (!modelSeenRef.current) setLoadFailed(true);
    }, 32000);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [loading, error]);

  // Redraws the thin connector line from a hotspot dot to its floating label
  // card, so the line stays attached as the model spins. (One line per tag.)
  const _updateLine = (ing: any) => {
    const line = document.getElementById(`hs-line-${ing.id}`) as SVGLineElement | null;
    const anchorBtn = document.getElementById(`hs-${ing.id}`);   // the dot on the model
    const cardWrap = document.getElementById(`hs-card-${ing.id}`); // the label card
    if (!line || !anchorBtn || !cardWrap) return;
    // Keep the card ON-SCREEN. A hotspot anchored near the model's left/right edge
    // (common on a narrow phone) would otherwise push its card off the viewport and
    // clip it. We nudge the card inward with a left margin so it's never cut off;
    // the connector line below re-reads the card's real position and stays attached.
    const edge = 8;
    const wr = cardWrap.getBoundingClientRect();
    const curM = parseFloat(cardWrap.style.marginLeft || "0");
    let targetM = curM;
    if (wr.right > window.innerWidth - edge) targetM = curM - (wr.right - (window.innerWidth - edge));
    else if (wr.left < edge) targetM = curM + (edge - wr.left);
    if (Math.abs(targetM - curM) > 0.5) cardWrap.style.marginLeft = targetM.toFixed(1) + "px";
    // Work out the card's position relative to the dot and point the line there.
    const aRect = anchorBtn.getBoundingClientRect();
    const cRect = cardWrap.getBoundingClientRect();
    const cx = cRect.left + cRect.width / 2;
    const cy = cRect.top + cRect.height;
    line.setAttribute("x2", (cx - aRect.left).toFixed(1));
    line.setAttribute("y2", (cy - aRect.top).toFixed(1));
  };

  // A continuous loop that keeps every connector line updated, frame by frame.
  const _loop = (gen: number) => {
    // The screen has gone — stop, and do not schedule another frame. Without this the chain is
    // immortal: nothing else holds its handle once the component that started it has unmounted.
    if (!aliveRef.current) return;
    // A newer reveal has taken over — this chain is retired. See loopGenRef.
    if (gen !== loopGenRef.current) return;
    tagsRef.current.forEach(ing => _updateLine(ing));
    requestRef.current = requestAnimationFrame(() => _loop(gen));  // schedule the next frame
  };

  // The opening "cinematic": spins the model a full turn while scaling it up
  // from small to full size over ~2.6s, then calls onComplete when done.
  const animateModelCinematic = (onComplete: () => void) => {
    const model = mvRef.current;
    if (!model) {
      onComplete();  // no model element — just finish immediately
      return;
    }
    const duration = 2600;  // milliseconds
    const startTime = performance.now();
    // An easing curve so the motion starts fast and settles gently.
    function ease(t: number) {
      return 1 - Math.pow(1 - t, 3);
    }

    // Did the editor capture a "front view" for this dish? If so, the reveal
    // spin should ORBIT THE CAMERA and land exactly on that saved pose, so the
    // menu stops where the editor said it should. If not, we keep the original
    // behaviour (spin the MODEL itself, camera stays at the default framing) so
    // existing dishes look exactly as before.
    const fv = parseFrontView(frontViewRef.current);

    if (fv) {
      // --- frontView path: animate the camera one full lap, ending on the pose.
      const endTheta = fv.theta;          // where the camera should finish (deg)
      const startTheta = endTheta - 360;  // start a full turntable lap behind it
      // Build a camera-orbit string at a given horizontal angle (theta), holding
      // the saved vertical angle (phi) and distance (radius) fixed.
      const orbitStr = (th: number) =>
        `${th.toFixed(2)}deg ${fv.phi.toFixed(2)}deg ${fv.radius.toFixed(3)}m`;
      // Turn OFF model-viewer's own camera smoothing so our easing fully owns the
      // motion; remember the old value to restore it when we're done.
      const prevDecay = (model as any).interpolationDecay;
      (model as any).interpolationDecay = 0;
      (model as any).orientation = "0deg 0deg 0deg";  // keep the model upright/still
      function animate(time: number) {
        const p = Math.min((time - startTime) / duration, 1);  // progress 0→1
        const e = ease(p);                                      // eased progress
        (model as any).cameraOrbit = orbitStr(startTheta + (endTheta - startTheta) * e);
        const scale = (0.3 + e * 0.7).toFixed(4);               // grow 0.3→1
        (model as any).scale = `${scale} ${scale} ${scale}`;
        if (p < 1) {
          requestAnimationFrame(animate);
        } else {
          (model as any).cameraOrbit = orbitStr(endTheta);  // land exactly on the front view
          (model as any).scale = "1 1 1";
          (model as any).interpolationDecay = prevDecay || 50;  // restore smoothing
          onComplete();
        }
      }
      requestAnimationFrame(animate);
      return;
    }

    // --- default path (no frontView saved): original model-orientation spin.
    function animate(time: number) {
      const p = Math.min((time - startTime) / duration, 1);  // progress 0→1
      const e = ease(p);                                      // eased progress
      (model as any).orientation = `0deg 0deg ${(e * 360).toFixed(2)}deg`;  // spin
      const scale = (0.3 + e * 0.7).toFixed(4);               // grow 0.3→1
      (model as any).scale = `${scale} ${scale} ${scale}`;
      if (p < 1) {
        requestAnimationFrame(animate);  // not done — next frame
      } else {
        // Done: snap to the final upright, full-size pose and finish.
        (model as any).orientation = "0deg 0deg 0deg";
        (model as any).scale = "1 1 1";
        onComplete();
      }
    }
    requestAnimationFrame(animate);  // kick off the first frame
  };

  // After the model settles, reveal the hotspot lines and label cards one by
  // one (staggered), each line "drawing" itself then its card fading/scaling in.
  const startTagAnimation = () => {
    tagsRef.current.forEach((ing, index) => {
      const delay = index * 260;  // stagger each tag so they appear in turn (was 400ms — see below)
      const line = document.getElementById(`hs-line-${ing.id}`) as SVGLineElement | null;
      const card = document.querySelector(`#hs-card-${ing.id} .hs-card`);
      const cardWrap = document.getElementById(`hs-card-${ing.id}`);
      if (!card || !cardWrap) return;

      if (line) {
        setTimeout(() => {
          let len = 300;
          try {
            len = line.getTotalLength();
          } catch {}
          if (!len || len < 1) len = 300;
          line.style.transition = "none";
          line.style.opacity = "0";
          line.style.strokeDasharray = `${len}`;
          line.style.strokeDashoffset = `${len}`;
          line.classList.remove("line-visible");
          void line.getBoundingClientRect();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              line.style.opacity = "1";
              line.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)";
              line.style.strokeDashoffset = "0";
              setTimeout(() => {
                line.style.transition = "";
                line.classList.add("line-visible");
              }, 1300);
            })
          );
        }, delay);
      }
      // THE BUBBLE AND ITS WORDS ARRIVE TOGETHER (T11 desktop sweep, 2026-08-05).
      // `content-animate` used to fire 400ms AFTER `card-animate`, so every callout was drawn
      // as an EMPTY speech bubble for four-tenths of a second before its text appeared — caught
      // in a screenshot at 6.0s, alongside a leader line running from the food into empty space
      // because its own card hadn't landed yet. It read as a rendering fault, not a loading
      // state (there is no loading cue for the callouts). Adding both classes in the same tick
      // costs nothing: .hs-bullets li keeps its own 0.35s fade and its 0.08s second-line
      // stagger, so the content still reveals in sequence — it just never shows an empty box.
      // The title/icon follow closely instead of 800ms later, and the per-tag stagger came down
      // from 400ms to 260ms, so the whole set settles ~40% sooner.
      setTimeout(() => {
        cardWrap!.style.opacity = "1";
        cardWrap!.style.transform = "translate(-50%,-50%) scale(1)";
        card!.classList.add("card-animate");
        card!.classList.add("content-animate");
      }, delay + 900);
      setTimeout(() => cardWrap!.classList.add("title-animate"), delay + 1150);
    });
  };

  // Play the reveal — or book it for the moment the dish lands. Everything that starts the
  // cinematic goes through here (the model's `load`, the 4s safety net); the triple-tap replay
  // does not, because by the time a guest can tap, the dish has long since arrived.
  const requestReveal = () => {
    if (!dishSettledRef.current) { revealPendingRef.current = true; return; }
    runFullSequence();
  };

  // The dish has landed. If the model was ready first, the reveal was waiting for exactly this.
  // `tags` is already the new list in this render — setMenuItem and setDishSettled are set one
  // after the other in the same async block, so React commits them together.
  useEffect(() => {
    dishSettledRef.current = dishSettled;
    if (!dishSettled || !revealPendingRef.current) return;
    revealPendingRef.current = false;
    runFullSequence();
    // runFullSequence is re-created every render (it closes over `tags`); depending on its
    // identity would replay the cinematic on every single render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dishSettled]);

  // The whole reveal, start to finish: first RESET every line and card back to
  // hidden, then run the cinematic spin, then play the staggered tag animation
  // and start the line-tracking loop. Called on first load and on triple-tap.
  const runFullSequence = () => {
    // Reset all the connector lines to invisible.
    tagsRef.current.forEach(ing => {
      const line = document.getElementById(`hs-line-${ing.id}`) as SVGLineElement | null;
      if (!line) return;
      line.classList.remove("line-visible");
      line.style.transition = "none";
      line.style.opacity = "0";
      if (line.style.strokeDasharray) {
        line.style.strokeDashoffset = line.style.strokeDasharray;
      }
    });
    // Reset all the label cards to their hidden starting state.
    document.querySelectorAll(".hs-card").forEach((el) =>
      (el as HTMLElement).classList.remove("card-animate", "content-animate")
    );
    document.querySelectorAll(".hs-card-wrap").forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.classList.remove("title-animate");
      htmlEl.style.transition = "none";
      htmlEl.style.opacity = "0";
      htmlEl.style.transform = "translate(-50%,-50%) scale(0.8)";
    });
    void document.body.offsetWidth;  // force the browser to apply the reset before animating
    // Now play the cinematic spin; when it's done, reveal the tags + start the loop.
    animateModelCinematic(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          startTagAnimation();
          // ONE LIVE CHAIN, ALWAYS — see loopGenRef. Retire whatever was running before starting
          // this reveal's own loop, so a replay replaces the tracking loop instead of adding one.
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
          _loop(++loopGenRef.current);
        })
      )
    );
  };

  // The AR (augmented reality) button: place the dish in the real room via the
  // phone camera. Only works on a secure (HTTPS) page, so warn if it can't.
  // Put the dish back to the size the SCREEN wants, and the camera back where the guest left it.
  // Runs when the AR session ends, when it fails, and when the screen is left mid-session.
  const endArSizing = () => {
    const mv = mvRef.current;
    const saved = arRestoreRef.current;
    document.body.classList.remove("ar-presenting");
    if (!mv) return;
    (mv as any).scale = "1 1 1";
    if (!saved) return;
    arRestoreRef.current = null;
    try {
      if (saved.minOrbit == null) mv.removeAttribute("min-camera-orbit");
      else mv.setAttribute("min-camera-orbit", saved.minOrbit);
      mv.cameraOrbit = saved.orbit;
      mv.interpolationDecay = saved.decay ?? 50;
    } catch {}
  };

  const handleLaunchAR = async () => {
    if (mvRef.current?.canActivateAR && mvRef.current.activateAR) {
      const mv = mvRef.current;
      // THE CARDS GO FIRST, BEFORE ANYTHING MOVES. model-viewer hangs its hotspots off the SCENE,
      // not off the model — so `scale` does not move them, and the camera coming 2.5× closer to
      // keep the dish the same size flings them 2.5× apart instead: screenshotted, "Saffron
      // infused" was cut off the top of the screen and its leader line ran to nothing. They are
      // hidden for the whole handoff, not just for the session, which is also what the guest
      // expects from the moment he taps AR VIEW. endArSizing's callers take the class off again.
      document.body.classList.add("ar-presenting");
      // ── SHRINK THE DISH TO ITS REAL SIZE ON THE WAY INTO AR (see AR_MODEL_SCALE) ───────────
      // The camera comes in by the SAME factor at the same moment, so nothing changes on the
      // screen the guest is still looking at: Quick Look takes a second or two to build its file,
      // and the page is visible for all of it. A model that visibly shrank while he waited would
      // be a new fault, not a fix.
      const o = mv.getCameraOrbit?.();
      const closeUp = o ? `${o.theta}rad ${o.phi}rad ${o.radius * AR_MODEL_SCALE}m` : null;
      if (o && closeUp) {
        arRestoreRef.current = {
          orbit: `${o.theta}rad ${o.phi}rad ${o.radius}m`,
          decay: mv.interpolationDecay,
          minOrbit: mv.getAttribute("min-camera-orbit"),
        };
        mv.interpolationDecay = 0;                                  // no glide — the two must move together
        // AND LET THE CAMERA COME THAT CLOSE. `min-camera-orbit`'s radius is "auto", a floor
        // model-viewer works out from the model's bounding sphere — and it does NOT recompute it
        // when the scale changes (its update path calls applyTransform/updateBoundingBox, never
        // updateFraming). So the floor stays the FULL-SIZE dish's, and the camera stops short of
        // where it was told to go: measured 1.12 m against the 0.82 m asked for, which is a 26%
        // shrink on screen. Lifted for the handoff, put back in endArSizing. Measured after:
        // 0.87 m, a 6% difference nobody can see.
        mv.setAttribute("min-camera-orbit", "auto 20deg 0.05m");
        mv.cameraOrbit = closeUp;
      }
      (mv as any).scale = `${AR_MODEL_SCALE} ${AR_MODEL_SCALE} ${AR_MODEL_SCALE}`;
      // model-viewer is a Lit element: setting `scale` only SCHEDULES applyTransform(). Quick
      // Look's file is built inside activateAR(), so going straight there exports the old size.
      try { await mv.updateComplete; } catch {}
      // WRITE THE CAMERA A SECOND TIME, AFTER the model has actually shrunk. model-viewer CLAMPS
      // how close the camera may come to the model's bounding sphere, and it clamps at the moment
      // you write it — so the first write above was measured against the full-size dish and
      // stopped short (1.12 m where 0.82 m was asked for, measured). One more write, now that the
      // sphere is 40% of what it was, lands where it was meant to and the dish on screen does not
      // change size while Quick Look builds its file.
      if (closeUp) { try { mv.cameraOrbit = closeUp; } catch {} }
      mv.activateAR!();
    } else {
      // Guest-facing message (no internal dev instructions). AR needs a supported
      // phone/tablet; on desktop or unsupported devices it just isn't available.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "AR isn't available on this device", subtitle: "open the menu on your phone to place the dish in your room", kicker: "3D view" } }));
    }
  };

  // Triple-tap / triple-click the model to replay the reveal animation.
  // (AR replays it automatically on entry via the ar-status handler above.)
  useEffect(() => {
    if (loading || error) return;
    const target = mvRef.current;  // the model element to listen on
    if (!target) return;
    let clicks = 0;  // how many taps so far
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTap = () => {
      clicks += 1;
      if (clicks >= 3) {
        // Three taps within the window — replay the reveal.
        clicks = 0;
        if (timer) { clearTimeout(timer); timer = null; }
        runFullSequence();
      } else {
        // Otherwise wait up to 0.6s for more taps, then reset the counter.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { clicks = 0; }, 600);
      }
    };
    target.addEventListener("click", onTap);
    return () => {
      target.removeEventListener("click", onTap);
      if (timer) clearTimeout(timer);
    };
    // runFullSequence is a stable closure (see note above); intentionally omitted.
    // `dishSettled` IS a dep, and it has to be. This effect captures the `runFullSequence` of the
    // render it last ran in, and that function's RESET half clears every `.hs-card-wrap` on the
    // page by selector — while the half that brings them back walks the tag list. Capture it
    // before the tags land and a triple-tap would blank all three cards and never restore them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, activeUrl, dishSettled]);

  // This restaurant isn't serving guests right now (Menu switch off / maintenance), or the
  // ?r= slug doesn't resolve. Say so plainly — never fall through to another tenant's dish.
  // ── THE THREE DEAD ENDS WEAR THE SAME CARD THE SLOW-MODEL SCREEN ALREADY WEARS ────────────────
  // (sweep #9 T2, 2026-09-14 — item 2.)
  //
  // All three of these screens were laid out with Tailwind utility classes — `flex`,
  // `items-center`, `justify-center`, `min-h-screen`, `p-4`, `text-white`, `text-[#6ddc8a]`. THOSE
  // CLASSES MATCH NO RULE IN THIS PRODUCT: `app/globals.css` is the app's only stylesheet and it
  // never imports Tailwind, so no utility is ever generated. MEASURED on the running app, on this
  // route: a fresh `<div class="flex p-4 text-white">` computes `display:block`, `padding:0px`,
  // `color:rgb(60,42,30)`. So every one of those class names was inert, and these screens rendered
  // as unstyled text glued to the top-left corner in the page's inherited brown — 1.39:1 against
  // the viewer's own near-black canvas, where 4.5:1 is the floor. The "← Back" link, the only way
  // off two of these screens, was the same invisible brown with no weight and no underline.
  //
  // The remedy is the pattern this screen already owns. `#try-again-overlay` + `.try-again-*` in
  // app/globals.css are the slow-model card — centred, padded, themed for BOTH skins, with a real
  // accent pill for its way out — and the patience overlay further down already uses them. So
  // these three say the same thing in the same card, and the inert class names are gone rather
  // than left beside the working way. After: 13.75:1 dark and 13.62:1 light on the heading.
  //
  // The headings stay `<h2>`: sweep #8's item 10 made them headings on purpose, so a screen-reader
  // user has something to jump to. `.try-again-title`/`.try-again-sub` are written for a `div`, so
  // the margins an h2 and a p bring with them are set explicitly — and CARD_* puts back what the
  // wrapper's own reset strips off the card. See CARD_PAD at the top of this file.
  if (unavailable) {
    return (
      <div className="viewer-wrapper">
        <div id="try-again-overlay">
          <div className="try-again-card" style={CARD_PAD}>
            <div className="try-again-emoji" style={CARD_EMOJI}>🍽️</div>
            <h2 className="try-again-title" style={CARD_TITLE}>This menu isn&apos;t available right now</h2>
            <p className="try-again-sub" style={unavailable === "closed" ? CARD_SUB : { margin: 0 }}>Please ask a member of staff — they can bring you the menu for your table.</p>
            {/* Only when we actually reached the restaurant — see the note on `unavailable`. An
                unknown slug gets no button, because every destination we could build is the same
                unknown restaurant. */}
            {unavailable === "closed" && (
              <Link href={backHref} className="try-again-btn" style={CARD_BTN}>
                <i className="fas fa-arrow-left" aria-hidden="true"></i> {t.back}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3D viewer switched OFF for this restaurant → a simple, honest message with a
  // Back link. No spinner, no model work (features starts ON by default, so this
  // only shows once the switch resolves to off — #1 and unresolved links are on).
  if (features.model3d === false) {
    return (
      <div className="viewer-wrapper">
        <div id="try-again-overlay">
          <div className="try-again-card" style={CARD_PAD}>
            <div className="try-again-emoji" style={CARD_EMOJI}>🍽️</div>
            <h2 className="try-again-title" style={CARD_TITLE}>3D preview isn&apos;t available</h2>
            <p className="try-again-sub" style={CARD_SUB}>You can still see this dish&apos;s photo and details on the menu.</p>
            <Link href={backHref} className="try-again-btn" style={CARD_BTN}>
              <i className="fas fa-arrow-left" aria-hidden="true"></i> {t.back}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // While the config is loading, show just the spinner.
  if (loading) {
    return (
      <div className="viewer-wrapper">
        <div id="load">
          <InfinityLoader label={t.loading3d} size={110} />
        </div>
      </div>
    );
  }

  // If loading the config failed, show an error message with a Back link.
  // The raw error text (e.g. "Failed to load config") used to be printed to the guest; it
  // means nothing to a diner and is ours to read in the logs, not theirs on screen (guest
  // sweep 2026-08-04). `error` is still what gates this branch, just no longer displayed.
  if (error) {
    return (
      <div className="viewer-wrapper">
        <div id="try-again-overlay">
          <div className="try-again-card" style={CARD_PAD}>
            <div className="try-again-emoji" style={CARD_EMOJI}>😔</div>
            <h2 className="try-again-title" style={CARD_TITLE}>3D view unavailable</h2>
            <p className="try-again-sub" style={CARD_SUB}>We couldn&apos;t load this dish in 3D right now. You can still see its photo and details on the menu.</p>
            <Link href={backHref} className="try-again-btn" style={CARD_BTN}>
              <i className="fas fa-arrow-left" aria-hidden="true"></i> {t.back}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // The main viewer screen.
  return (
    <div className="viewer-wrapper">
      {/* This restaurant's colour for the viewer chrome (Back/AR/Add buttons). */}
      {accentCss && <style dangerouslySetInnerHTML={{ __html: accentCss }} />}
      {/* The spinner stays up until the model appears (and not while showing
          the "taking longer" / failed overlay).

          THE LOADING PANEL SITS UNDER THE CHROME, NOT OVER IT (sweep #6 T2, 2026-08-17).
          `.viewer-wrapper #load` is `position:fixed; inset:0` with an OPAQUE background and
          `z-index:100`, while `#topbar` and `#bar` are both `z-index:30`. So for as long as the
          model was downloading, the panel covered the whole screen including the BACK button —
          measured: a real tap on BACK hit `#load` and timed out, and the address never changed.
          A diner on weak restaurant wi-fi tapped Back, twice, three times, and the app did
          nothing; only the phone's own back gesture got them out. That is exactly the "a tap must
          never vanish in silence" rule.
          20 is above the model canvas (which has no z-index of its own) and below the two chrome
          bars at 30, so the panel still hides the empty canvas while Back, AR and the dish bar
          stay reachable. Inline, because the stylesheet is not this terminal's to edit; if that
          rule is ever corrected at source, this line becomes redundant rather than wrong. */}
      {loaderVisible && !showTryAgain && !loadFailed && (
        <div id="load" style={{ zIndex: 20 }}>
          <InfinityLoader label={t.loading3d} size={110} />
        </div>
      )}

      {/* The overlay shown when the model is slow OR has failed for good. When it
          genuinely failed we say so honestly (audit fix bug #10) instead of
          promising a load that will never come. */}
      {(showTryAgain || loadFailed) && !modelSeenRef.current && (
        <div id="try-again-overlay">
          {/* The five inline values are the ones `.viewer-wrapper *` strips off this card — see
              CARD_PAD at the top of this file for the measurement and the screenshot. */}
          <div className="try-again-card" style={CARD_PAD}>
            <div className="try-again-emoji" style={CARD_EMOJI}>{loadFailed ? "😔" : "⏳"}</div>
            <div className="try-again-title" style={CARD_TITLE}>
              {loadFailed ? "3D view unavailable" : "Still preparing your 3D view"}
            </div>
            <div className="try-again-sub" style={CARD_SUB}>
              {loadFailed
                ? "We couldn't load this dish in 3D right now. You can still see its photo and details on the menu."
                : "The model is taking longer than usual. We'll let you know as soon as it's ready."}
            </div>
            <Link href={backHref} className="try-again-btn" style={CARD_BTN}>
              <i className="fas fa-arrow-left"></i> Go back
            </Link>
          </div>
        </div>
      )}

      {/* A small badge used during AR placement. */}
      <div className="placing-badge" id="placing-badge"></div>

      {/* The top bar: Back on the left, the AR button on the right. */}
      <div id="topbar">
        <Link href={backHref} className="tbtn back-btn">
          <i className="fas fa-arrow-left"></i> {t.back}
        </Link>
        <div className="top-btns">
          <button className="tbtn ar-btn" onClick={handleLaunchAR}>
            <i className="fas fa-cube"></i> {t.arView}
          </button>
        </div>
      </div>

      {/* The "triple-tap to replay" hint; the "show" class fades it in/out.
          `bottom` is set from the bar's measured height, not the stylesheet's hardcoded 176px —
          see the note on barHeight. 12px of air between the two. Inline, because the stylesheet
          is not this terminal's to edit; if that rule ever learns the bar's height at source,
          this becomes redundant rather than wrong. */}
      <div
        id="dbl-hint"
        className={hintVisible ? "show" : ""}
        style={barHeight ? { bottom: barHeight + 12 } : undefined}
      >
        {hintSpin ? <>🔄 {t.dragToSpin}</> : <>👆 {t.tripleTapReplay}</>}
      </div>

      {/* The actual 3D model element — only once we have a config AND a chosen
          model file. We pass the chosen file in as modelUrl. */}
      {config && activeUrl && (
        <PublicModelViewer
          // The model URL is chosen above; the callout cards and the opening pose come from the
          // DISH, not from the static config (mig 402) — see the note on PublicConfig.
          config={{ ...config, modelUrl: activeUrl, tags, frontView }}
          /* I4 (2026-08-12): every dish used to announce itself to a screen reader as the same
             "3D food model", so a blind diner could not tell the croissant from the waffle. Prefer
             the LIVE menu name, fall back to the config's, then to the folder — the same order the
             bottom bar uses for its title. */
          dishName={menuItem?.title || config.title || folder}
          mvRef={mvRef}
          onScriptError={() => { if (!modelSeenRef.current) setLoadFailed(true); }}
        />
      )}

      {/* The bottom info bar (name, stats, price, Add to Order). It slides up
          once "on" is added. Values prefer the live menu item, falling back
          to the config. */}
      <div id="bar" ref={barRef} className={barVisible ? "on" : ""}>
        {/* A HEADING, NOT A DIV (sweep #8 T2 round 3, 2026-09-02 — item 10). Measured: on the
            WORKING 3D screen there was no <h1> or <h2> at all — the three that exist are on the
            three dead-end screens above. So a screen-reader user had no heading to jump to on the
            one screen this product is sold on, and the dish's own name was just text in a box.
            `.dname` carries every visual property except the margin a heading brings with it, so
            that one is zeroed inline and the screen looks identical. */}
        <h2 className="dname" id="dish-title" style={{ marginTop: 0 }}>
          {menuItem?.title || config?.title || ""}
        </h2>
        <div className="dsub" id="dish-sub">
          {menuItem?.description || config?.subtitle || ""}
        </div>
        <div className="srow">
          <div>
            <div className="sv" id="stat-cal">{menuItem?.nutrition?.calories || config?.stats?.calories || "—"}</div>
            <div className="sl">{t.cal}</div>
          </div>
          <div>
            <div className="sv" id="stat-pro">{menuItem?.nutrition?.protein || config?.stats?.protein || "—"}</div>
            <div className="sl">{t.protein}</div>
          </div>
          <div>
            <div className="sv" id="stat-carb">{menuItem?.nutrition?.carbs || config?.stats?.carbs || "—"}</div>
            <div className="sl">{t.carbs}</div>
          </div>
          <div>
            <div className="sv" id="stat-price">{menuItem ? showPrice(menuItem.price) : config?.stats?.price || "—"}</div>
            <div className="sl">{t.price}</div>
          </div>
        </div>
        {/* Add-to-order button (disabled until the menu item loads, and while the dish
            is sold out — matching the menu card's "Not available" pill and the dish
            page's disabled button) and the "i" button that opens the details sheet. */}
        <div className="brow">
          <button className="badd" onClick={addToOrder} disabled={!menuItem || soldOut}>
            {soldOut ? `🚫 ${t.notAvailable}` : `🛒 ${t.addToOrder}`}
          </button>
          <button className="binfo" onClick={() => setShowInfo(true)} aria-label="Dish details">ℹ</button>
        </div>
      </div>

      {/* The slide-up details sheet: description, ingredients, allergens.
          Shown only when the "i" was tapped and we have the menu item. */}
      {showInfo && menuItem && (
        // Tapping the dark backdrop closes the sheet.
        <div className="vinfo-overlay" onClick={() => setShowInfo(false)}>
          {/* stopPropagation here means tapping INSIDE the sheet doesn't close it. */}
          <div className="vinfo-sheet" onClick={(e) => e.stopPropagation()}>
            <button className="vinfo-close" aria-label="Close" onClick={() => setShowInfo(false)}>
              <i className="fas fa-times"></i>
            </button>
            <div className="vinfo-title">{menuItem.title}</div>
            {/* The rating follows the SAME two conditions as the menu card and the dish
                page: the restaurant must have ratings switched on, AND the dish must have
                real reviews. This sheet used to print it unconditionally, so a
                ratings-off restaurant still showed stars, and a dish with no reviews
                showed a bare "★ · ₹550" (an empty rating reads as a broken widget).
                Guest sweep 2026-08-04. */}
            <div className="vinfo-meta">
              {features.ratings && (menuItem.reviewCount ?? 0) > 0 ? `${menuItem.rating} ★ · ` : ""}
              {showPrice(menuItem.price)}
            </div>
            {menuItem.longDescription && <p className="vinfo-desc">{menuItem.longDescription}</p>}
            {(menuItem.ingredients?.length ?? 0) > 0 && (
              <>
                <div className="vinfo-label">{t.ingredients}</div>
                <div className="vinfo-chips">
                  {(menuItem.ingredients ?? []).map((ing, i) => (
                    <span key={i} className="vinfo-chip">{ing.emoji} {ing.name}</span>
                  ))}
                </div>
              </>
            )}
            {/* Allergens follow the restaurant's allergy switch, exactly as the dish page
                (ItemClient) and the cart already do. This sheet ignored it, so a restaurant
                that had switched the allergy feature OFF still published allergen claims
                through the 3D route — the one guest surface nobody thinks to check
                (guest sweep 2026-08-04). */}
            {features.allergies && menuItem.allergens.length > 0 && (
              <>
                <div className="vinfo-label">{t.contains}</div>
                <div className="vinfo-chips">
                  {menuItem.allergens.map((a) => (
                    <span key={a} className="vinfo-chip warn">{allergenIcon(a)} {allergenLabel(a)}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
