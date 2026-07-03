// /editor — kept only for BACK-COMPAT. The panel is now /manager; anyone hitting
// the old URL is redirected there (which then runs the manager auth gate).
// ?rid= (admin per-tab "view as") is preserved through the redirect — dropping it
// would silently unpin an admin tab from its restaurant.
import { redirect } from "next/navigation";

export default async function EditorRedirect({ searchParams }: { searchParams: Promise<{ rid?: string }> }) {
  const { rid } = await searchParams;
  redirect("/manager" + (rid ? `?rid=${encodeURIComponent(rid)}` : ""));
}
