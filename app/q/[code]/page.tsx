// app/q/[code]/page.tsx — a table's permanent QR link (mig 210).
//
// The printed QR encodes /q/<private-code>; this server component resolves the code
// to (restaurant, table) and renders that restaurant's menu with the table pre-filled.
// The table number never appears in the address bar, so editing the URL can only
// produce the friendly invalid-code page below — never a different table's menu.
// The URL stays /q/<code> (no redirect that would re-expose ?table=N).
import { cache } from "react";
import type { Metadata } from "next";
import MenuView from "@/components/MenuView";
import { getRestaurantBySlug } from "@/lib/tenant";
import { getSettings } from "@/lib/menu";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// One indexed single-row read (unique code) + the same tenant resolution the
// normal /r/<slug>/menu page does.
//
// WRAPPED IN React `cache()` because BOTH generateMetadata and the page component call
// it for the same request, and these are supabaseAdmin calls, which Next does not dedupe
// the way it dedupes `fetch`. That made every scan of a printed table sticker cost two
// code lookups + two restaurant lookups instead of one each — on the hottest guest entry
// point there is (guest sweep 2026-08-04). `cache()` is per-request, so two different
// diners never share a result. The tenant route avoids this already because
// getRestaurantBySlug and getSettings are themselves cached.
const resolveCode = cache(async function resolveCode(codeRaw: string) {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6,16}$/.test(code)) return null;
  const row = (await supabaseAdmin
    .from("table_qr_codes")
    .select("restaurant_id, table_number")
    .eq("code", code)
    .maybeSingle()).data as { restaurant_id: string; table_number: number } | null;
  if (!row) return null;
  const rest = (await supabaseAdmin
    .from("restaurants")
    .select("slug")
    .eq("id", row.restaurant_id)
    .maybeSingle()).data as { slug: string } | null;
  if (!rest?.slug) return null;
  const r = await getRestaurantBySlug(rest.slug);
  if (!r || !r.active) return null;
  // MENU MASTER SWITCH — a restaurant whose Menu feature is off has no guest menu at all,
  // and the rule is explicit that "no QR link resolves" (see lib/menu.ts). This route used
  // to skip the check, so every printed sticker kept serving the full menu (and taking
  // orders) after the switch was turned off. Treated like a dead code: the friendly page
  // below, never a bare 404 — a diner at a table should be told to ask a member of staff.
  const settings = await getSettings(r.id);
  if (!settings.menuEnabled) return null;
  return { r, slug: rest.slug, table: row.table_number, settings };
});

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const hit = await resolveCode(code);
  if (!hit) return { title: "Menu" };
  const title = hit.r.name ? `${hit.r.name} — Menu` : "Menu";
  return { title, ...(hit.r.logoUrl ? { icons: { icon: hit.r.logoUrl } } : {}) };
}

export default async function TableQrPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const hit = await resolveCode(code);
  if (!hit) {
    // Friendly dead-code page (a regenerated/typo'd code) — not a bare 404.
    return (
      <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <div>
          <div style={{ fontSize: 44, marginBottom: 10 }} aria-hidden="true">🍽️</div>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>This QR code isn&rsquo;t active</h1>
          <p style={{ fontSize: 14, opacity: 0.75, margin: 0, maxWidth: 340 }}>
            It may have been replaced with a new one. Please ask a member of staff to scan the current code for your table.
          </p>
        </div>
      </main>
    );
  }
  return (
    <>
      {/* Pin this tab's tenant BEFORE hydration: /q/<code> has no /r/<slug> in the
          path, so tenant-scoped storage (scanned table, cart, session…) would fall
          back to restaurant #1's scope and mix restaurants on one phone. tenantSlug()
          reads this exact sessionStorage key for non-prefixed pages. */}
      <script dangerouslySetInnerHTML={{ __html: `try{sessionStorage.setItem("lfh_tab_tenant",${JSON.stringify(hit.slug)})}catch(e){}` }} />
      {/* Access → Menu → Format → Default light/dark, exactly as /r/<slug>/menu does it.
          The global boot script in app/layout.tsx stamps 'light' because it can't know WHICH
          restaurant is opening; this runs as the parser reaches it, before the menu paints,
          so a dark-default restaurant never flashes light for a guest who scanned the table
          QR. A guest who has chosen a mode keeps it — we only act when nothing is saved. */}
      {hit.settings.menuDefaultMode === "dark" && (
        <script
          dangerouslySetInnerHTML={{
            __html: "(function(){try{if(!localStorage.getItem('lfh_theme'))document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();",
          }}
        />
      )}
      <MenuView
      restaurantId={hit.r.id}
      restaurantSlug={hit.slug}
      restaurantName={hit.r.name ?? undefined}
      logoText={hit.r.logoText ?? undefined}
      heroTitle={hit.r.heroTitle ?? undefined}
      tagline={hit.r.tagline ?? undefined}
      accentColor={hit.r.accentColor ?? undefined}
      theme={hit.r.theme ?? undefined}
      logoUrl={hit.r.logoUrl ?? undefined}
      qrTable={String(hit.table)}
      /* Access → Menu → Format → Default layout. Was omitted here, so a restaurant that
         chose the list view still got the gallery for everyone who scanned a table QR. */
      defaultLayout={hit.settings.menuDefaultLayout === "list" ? "list" : "gallery"}
      />
    </>
  );
}
