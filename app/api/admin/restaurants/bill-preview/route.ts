// GET /api/admin/restaurants/bill-preview?rid=<uuid>&mode=bill|parcel
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
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { billPreviewHtml, type BillMode } from "@/lib/billPreview";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const ridParam = url.searchParams.get("rid");
  const rid = isUuid(ridParam) ? ridParam : DEFAULT_RESTAURANT_ID;
  const mode: BillMode = url.searchParams.get("mode") === "parcel" ? "parcel" : "bill";

  // settings.restaurant_name is the name the BILL is printed under, which a restaurant may
  // never have filled in. Falling back to its real name beats showing a stranger's preview
  // headed "Your Restaurant" and leaving them unsure whose settings they are looking at.
  const [{ data }, { data: rest }] = await Promise.all([
    sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
    sb.from("restaurants").select("name").eq("id", rid).maybeSingle(),
  ]);
  const row = { ...((data || {}) as Record<string, unknown>) };
  if (!String(row.restaurant_name ?? "").trim() && rest?.name) row.restaurant_name = rest.name;
  const html = billPreviewHtml(row, mode);

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
