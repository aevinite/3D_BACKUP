"use client";
// Admin · Features (LEGACY REDIRECT) — this page used to toggle guest features on the
// single `settings.id='site'` row, which in the multi-tenant world silently edited ONLY
// restaurant #1 (bug H1, 2026-07-06). Guest features are now managed PER RESTAURANT in
// each restaurant's detail (Restaurants → pick one → Guest features), scoped by
// restaurant_id. This page is unlinked from the nav; anyone who reaches it by URL now
// gets pointed to the correct place instead of a control that edits the wrong tenant.
import Link from "next/link";

export default function AdminFeaturesMoved() {
  return (
    <>
      <h1 className="adm-page-h">Features moved</h1>
      <p className="adm-page-sub">Guest features are now set per restaurant, not globally.</p>
      <div className="adm-card">
        <h2>Manage a restaurant&rsquo;s features</h2>
        <p className="hint">
          Each restaurant has its own guest features and menu chips. Open a restaurant to turn its
          features on or off — the change shows only on that restaurant&rsquo;s menu.
        </p>
        <Link href="/aevinite/restaurants" className="adm-btn" style={{ display: "inline-flex", marginTop: 8 }}>
          Go to Restaurants
        </Link>
      </div>
    </>
  );
}
