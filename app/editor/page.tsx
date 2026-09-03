// /editor — kept only for BACK-COMPAT. The panel is now /manager; anyone hitting
// the old URL is redirected there (which then runs the manager auth gate).
// ?rid= (admin per-tab "view as") is preserved through the redirect — dropping it
// would silently unpin an admin tab from its restaurant.
//
// ALL THREE OF THE CONSOLE'S PINS SURVIVE THE HOP (T8 sweep #8, 2026-09-03). This forwarded
// ?rid= only, while /api/admin/act-as/go — which lists "/editor" among the panel paths it will
// send an admin to — appends `&as=<person>` whenever the click named one. So the same admin
// action did two different things depending on which of the two addresses it was pointed at:
// via /manager the panel marked that person's missing permissions in cyan, via /editor the pin
// was dropped on the floor and the tab opened the plain admin view, with nothing saying so.
// Exactly the fault its /r/<slug>/manager twin had (see that file's note) — same shape, same fix.
//   rid   which restaurant this tab is looking at
//   as    WHICH PERSON to mark against (the profile's "Visit their panel", owner 2026-08-02)
//   view  "real" = render as the role really gets it, instead of the admin X-ray
// The two extra pins ride along ONLY behind a ?rid=, because that is the only case they mean
// anything: panelAdminRid returns null without a valid rid and panelIframeSrc then drops both
// (lib/panelGate), and every pin is re-checked server-side on each panel call. So this can
// widen nobody's reach — it only stops an admin-only pin being lost at the door.
import { redirect } from "next/navigation";

export default async function EditorRedirect(
  { searchParams }: { searchParams: Promise<{ rid?: string; as?: string; view?: string }> },
) {
  const { rid, as, view } = await searchParams;
  let q = rid ? `?rid=${encodeURIComponent(rid)}` : "";
  if (q && as) q += `&as=${encodeURIComponent(as)}`;
  if (q && view === "real") q += "&view=real";
  redirect("/manager" + q);
}
