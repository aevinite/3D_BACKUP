"use client";
// Admin · Settings — platform-level INFO only. Guest-menu MAINTENANCE and log RETENTION are both
// per-restaurant, not platform-wide: maintenance is a control on each restaurant's own page, and
// log retention is set per restaurant by its manager (platform default 90 days, enforced by
// lfh_prune_logs mig 152). Neither belongs as a flagship-(#1)-only control here — that was
// confusing on a multi-tenant panel. The old "Log retention · platform-wide" control actually
// only changed restaurant #1's row (it wrote id='site', which prune never consults for other
// restaurants), so it was removed until a genuine platform-wide default is wired (audit 2026-07-09).
import Link from "next/link";

export default function AdminSettings() {
  return (
    <>
      <h1 className="adm-page-h">Settings</h1>
      <p className="adm-page-sub">Platform-level info — everything else is managed on each restaurant&rsquo;s own page.</p>

      <div className="adx-grid2col" style={{ marginBottom: 14 }}>
        <div className="adm-card">
          <h2>Platform</h2>
          <p className="hint">Aevidine · Restaurant OS — your control room for every restaurant on this backend.</p>
          <div className="adm-logwrap" style={{ marginTop: 6 }}>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Environment</span><span style={{ fontWeight: 700, color: "var(--adm-ok)" }}>Production</span></div>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>You&rsquo;re signed in as</span><span className="adm-muted">Platform admin</span></div>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Guest-menu maintenance</span><span className="adm-muted">per restaurant</span></div>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Log retention</span><span className="adm-muted">per restaurant · 90-day default</span></div>
          </div>
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>To put a restaurant&rsquo;s menu into a &ldquo;we&rsquo;ll be right back&rdquo; state, open it on the <b>Restaurants</b> page and use its <b>Maintenance</b> toggle (or <b>Suspend</b> to take it fully offline).</p>
        </div>

        <div className="adm-card">
          <h2>Log retention</h2>
          <p className="hint">How long the activity &amp; customer logs are kept is set <b>per restaurant</b> — each restaurant&rsquo;s manager controls it in their own panel. The platform default is <b>90 days</b>, and bills are never auto-deleted.</p>
          <p className="hint" style={{ marginTop: 8, marginBottom: 0, opacity: 0.8 }}>A single platform-wide override for every restaurant at once is a planned addition.</p>
        </div>
      </div>

      <div className="adm-card">
        <h2>Restaurants</h2>
        <p className="hint">Each restaurant&rsquo;s identity, branding, guest features, panels, maintenance and suspend/delete are managed on its own page.</p>
        <Link href="/aevinite/restaurants" className="adm-btn" style={{ display: "inline-flex", marginTop: 4 }}>Manage restaurants</Link>
      </div>
    </>
  );
}
