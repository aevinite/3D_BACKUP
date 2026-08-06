// Full-screen "under maintenance" screen shown when Service Mode is on
// (toggled from the editor's General tab). Pure CSS continuous animations.

// The flagship (#1) logo, shown ONLY for restaurant #1. Every other restaurant
// passes its OWN logo (or none) so this screen can never leak French House
// branding onto another tenant (the white-label rule; audit fix 2026-07-06).
//
// SERVED FROM OUR OWN public/, not from littlefrenchhouse.in. It used to be a hardcoded URL on
// that WordPress site — an outside host nobody here controls, on the ONE screen you least want a
// broken image, and cross-origin so the offline layer deliberately never caches it. `public/
// lfh-logo.png` is the identical file (same sha256, 35,633 bytes — checked, not assumed) and is
// what IntroSplash has always used. (T1 improvement 13, 2026-08-07.)
const DEFAULT_LOGO = "/lfh-logo.png";

// The whole-screen "we're temporarily closed / under maintenance" page.
// AppShell swaps the normal menu out for this when Service Mode is switched on,
// passing THIS restaurant's branding so the screen shows its own name/logo.
export default function Maintenance({ logoText, logoUrl, isDefault = true }: { logoText?: string; logoUrl?: string; isDefault?: boolean }) {
  // #1 keeps its hardcoded logo; other restaurants use their uploaded logo, or
  // fall back to showing their name in text (never the French House mark).
  const showLogo = isDefault ? DEFAULT_LOGO : (logoUrl || null);
  const name = isDefault ? "Little French House" : (logoText || "");
  return (
    // role="alert" makes screen readers announce this important message.
    <div className="maint" role="alert" aria-label="Under maintenance">
      {/* The animated centrepiece: a glowing ring, rising "steam", and the logo */}
      <div className="maint-stage">
        {/* The pulsing ring behind the logo (animated purely with CSS) */}
        <div className="maint-ring" />
        {/* Three little wisps that drift upward like steam off a hot dish */}
        <div className="maint-steam">
          <span />
          <span />
          <span />
        </div>
        {/* The restaurant logo (or, when a tenant has no logo, its name in text) */}
        {showLogo ? (
          <img className="maint-logo" src={showLogo} alt={name} />
        ) : (
          <div className="maint-logo maint-logo-text" aria-label={name}>{name}</div>
        )}
      </div>
      {/* The small pill-shaped label */}
      <div className="maint-badge">🔧 Under Maintenance</div>
      {/* The big friendly headline */}
      <h1 className="maint-title">We&apos;ll be right back</h1>
      {/* The reassuring sentence underneath */}
      <p className="maint-sub">
        Our kitchen is getting a little tune-up. Please check back in a few minutes.
      </p>
      {/* Three bouncing dots, the classic "still working..." animation */}
      <div className="maint-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
