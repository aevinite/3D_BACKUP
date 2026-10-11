// GET /api/admin/restaurants/bill-preview?rid=<uuid>&mode=bill|parcel|kot
//
// Renders a restaurant's bill AS IT WILL PRINT, from that restaurant's own settings, so the
// two "Format of …" screens in Access & permissions can show a real page instead of asking
// the admin to imagine one (owner, 2026-08-02). Returns a whole HTML document, opened in its
// own window — which is also what makes the "print it" button on the preview real: it goes to
// the same printer a bill would.
//
// Read-only and admin-gated. It writes nothing and it invents no money: the numbers are a
// fixed sample, and only the restaurant's own header/tax/footer settings come from the row.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { billPreviewHtml, type BillMode } from "@/lib/billPreview";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// The preview opens in its own window, so a refusal is a small readable PAGE, not JSON the admin
// would have to read as code.
const say = (status: number, sentence: string) => new NextResponse(
  `<!doctype html><meta charset="utf-8"><title>Bill preview</title><body style="font:15px/1.5 system-ui,sans-serif;padding:32px;max-width:420px">${sentence}</body>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
);

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  // ── A PREVIEW IS OF ONE NAMED RESTAURANT, OR IT IS NOT DRAWN (sweep #10 T29, item 6) ─────────────
  // Two ways this used to draw a bill that was not the one asked for, both with a 200:
  //   · a missing or garbled `rid` silently became restaurant #1, so the window showed the FLAGSHIP's
  //     header, logo and tax lines under another restaurant's Access screen — the "restaurant #1's
  //     branding on another tenant" fault this project keeps a standing rule against;
  //   · both reads dropped their `.error`, so a database hiccup handed billPreviewHtml an empty row and
  //     the admin was shown a bill with no name, no address and no tax lines — read, reasonably, as
  //     "this restaurant's bill settings are blank".
  // The Access screen always sends the restaurant's own id, so the first is reachable only from a typed
  // address; the second on any blip. Both now answer a short page in words instead of a wrong bill.
  const ridParam = url.searchParams.get("rid");
  if (!isUuid(ridParam)) return say(400, "This preview link doesn't name a restaurant. Open it from that restaurant's Access screen.");
  const rid = ridParam;
  const asked = url.searchParams.get("mode");
  const mode: BillMode = asked === "parcel" ? "parcel" : asked === "kot" ? "kot" : "bill";

  // The restaurant row matters as much as the settings row: the panel's own identity resolver
  // reads the slug (which restaurant is the flagship, which sign-off it gets) and the uploaded
  // logo off it. Fetching less here is what used to head the preview with a different
  // restaurant than the paper.
  const [setQ, restQ] = await Promise.all([
    sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
    sb.from("restaurants").select("id, name, slug, logo_url, logo_text").eq("id", rid).maybeSingle(),
  ]);
  if (setQ.error || restQ.error) {
    console.error("[admin/bill-preview] could not read the restaurant:", (setQ.error || restQ.error)?.message);
    return say(503, "Couldn't load this restaurant's bill settings just now. Close this window and press Preview again.");
  }
  if (!restQ.data) return say(404, "That restaurant wasn't found — it may have been removed.");
  const row = { ...((setQ.data || {}) as Record<string, unknown>) };
  const html = billPreviewHtml(row, mode, restQ.data as Record<string, unknown>);

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
