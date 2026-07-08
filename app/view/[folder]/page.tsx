// The actual 3D viewer (spins the dish model, shows hotspots) lives in
// ViewerClient and runs in the browser. This file is the small server wrapper.
import ViewerClient from "./ViewerClient";
import { getRestaurantBySlug } from "@/lib/tenant";

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
}: {
  params: Promise<{ folder: string }>;
}) {
  // Wait for the address pieces, then grab the folder name.
  const { folder } = await params;
  return (
    // <>...</> is an empty wrapper (a "fragment") — it groups things without
    // adding any extra box to the page.
    <>
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
