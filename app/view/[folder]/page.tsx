// The actual 3D viewer (spins the dish model, shows hotspots) lives in
// ViewerClient and runs in the browser. This file is the small server wrapper.
import ViewerClient from "./ViewerClient";

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
      {/* Hand the folder name to the browser-side viewer, which does the work. */}
      <ViewerClient folder={folder} />
    </>
  );
}
