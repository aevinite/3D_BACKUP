// The actual 3D viewer (spins the dish model, shows hotspots) lives in
// ViewerClient and runs in the browser. This file is the small server wrapper.
import ViewerClient from "./ViewerClient";
import { getRestaurantBySlug } from "@/lib/tenant";
import OfflineNoticeStatic from "@/components/OfflineNoticeStatic";

// White-label (audit fix 2026-07-08): give the 3D page its OWN tab title. Without a
// generateMetadata it inherited the platform default ("Aevidine — Restaurant OS"),
// leaking the SaaS name onto a restaurant's 3D view. The dish's restaurant travels in
// ?r=<slug> (set by the link that opens the viewer); if it's absent we show a neutral
// "3D View" — never the platform name.
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await searchParams;
  if (r) {
    const rest = await getRestaurantBySlug(r).catch(() => null);
    if (rest?.name) return { title: `3D View — ${rest.name}` };
  }
  return { title: "3D View" };
}

// This is the 3D viewer page, shown at addresses like "/view/croissant".
// The "[folder]" folder name means the last part of the address becomes
// `folder` — it tells us which dish's 3D model + config to load.
// "async" + "await params" because Next 16 delivers the address as a promise.
export default async function ViewerPage({
  params,  // the model folder name from the address, e.g. { folder: "croissant" }
  searchParams, // ?r=<restaurant slug>, set by whatever link opened this viewer
}: {
  params: Promise<{ folder: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  // Wait for the address pieces, then grab the folder name.
  const { folder } = await params;
  const { r } = await searchParams;
  // PIN THIS TAB'S RESTAURANT BEFORE HYDRATION — the same thing app/q/[code] does, for the same
  // reason (sweep #6 T2, 2026-08-18).
  //
  // /view/<folder> has no /r/<slug> in its path, so everything that answers "which restaurant is
  // this tab on?" from the address alone falls back to restaurant #1. Two separate readers do that:
  //   · lib/tenantStorage.ts → tenantSlug(), which scopes the cart, the favourites and the session;
  //   · lib/restaurant-context.tsx → RestaurantProvider, which every body-level guest widget reads
  //     (the cart, the session gate, and OrderConfirmModal's feature switches).
  // Both consult THIS sessionStorage key for a page with no slug in its path.
  //
  // WHY A SCRIPT AND NOT JUST THE CLIENT CODE. ViewerClient already stamps the key once ?r= resolves
  // to a live restaurant, which is what makes the cart land in the right place. But that stamp is
  // async — it waits on a restaurant lookup — and the provider reads the key ONCE, in an effect, on
  // first mount. On a cold /view link the provider therefore asked before the stamp arrived, read an
  // empty key, settled on restaurant #1 and never looked again. Writing it here, as the parser
  // reaches this tag, means the key is already correct before a single line of React runs.
  //
  // The two are complementary, not redundant: this script covers a cold load (a forwarded or
  // bookmarked 3D link), and ViewerClient's stamp covers a client-side navigation into /view, where
  // an injected script tag is never executed.
  //
  // WHAT GOES IN THE SCRIPT IS THE DATABASE'S OWN SLUG, NEVER THE ADDRESS BAR'S TEXT.
  //
  // ?r= is whatever a stranger put in a link, and JSON.stringify is NOT enough on its own inside a
  // <script> block: it does not escape "/", so a value containing "</script>" would close this tag
  // early and let the rest of the address run as markup. app/q/[code] gets away with the same shape
  // because it pins `hit.slug` — a value that came back from the database. So do the same here:
  // resolve first, pin the resolved `rest.slug`, and pin nothing at all if the slug is unknown.
  // getRestaurantBySlug is the cached read generateMetadata above already made, so this is free.
  //
  // Belt and braces on top: a slug is `[a-z0-9-]` by construction, so anything else is refused even
  // if a row were ever created with a stranger character in it.
  const pinned = r ? await getRestaurantBySlug(r).catch(() => null) : null;
  const safeSlug = pinned?.slug && /^[a-z0-9-]+$/.test(pinned.slug) ? pinned.slug : null;
  const pinTenant = safeSlug
    ? `try{sessionStorage.setItem("lfh_tab_tenant",${JSON.stringify(safeSlug)})}catch(e){}`
    : null;
  return (
    // <>...</> is an empty wrapper (a "fragment") — it groups things without
    // adding any extra box to the page.
    <>
      {pinTenant && <script dangerouslySetInnerHTML={{ __html: pinTenant }} />}
      {/* The offline warning that survives a reload with no signal — see components/
          OfflineNoticeStatic.tsx. Matters as much here as on the dish page: with no signal this
          screen freezes on "LOADING 3D MODEL" and said nothing. (Owner's item 11, 2026-09-01.) */}
      <OfflineNoticeStatic />
      {/* Hand the folder name to the browser-side viewer, which does the work.
          key={folder} forces a fresh instance when navigating 3D-view → 3D-view (e.g.
          tapping another dish's "ready" toast while a viewer is open) — without it the
          component persisted and kept the previous dish's model, hotspots, spinner and
          failure state. The GLB blob cache is a global singleton, so remounting does NOT
          re-download the model. (fix 2026-07-09) */}
      <ViewerClient key={folder} folder={folder} />
    </>
  );
}
