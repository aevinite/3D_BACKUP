// Full-screen "under maintenance" screen shown when Service Mode is on
// (toggled from the editor's General tab). Pure CSS continuous animations.

// The flagship (#1) logo, shown ONLY for restaurant #1. Every other restaurant
// passes its OWN logo (or none), so the NAME and the MARK on this screen are always the
// tenant's (the white-label rule; audit fix 2026-07-06).
//
// AND SO ARE THE COLOURS, since 2026-08-17. They were NOT: every value on this screen was a
// hardcoded flagship one (#221309 background, #d4a574 / rgba(212,165,116,…) ring, steam, badge and
// dots), so a tenant whose menu is blue or green showed its own name and logo on French House's
// gold — measured on Aangan, whose accent is #e3c06f and whose maintenance ring still computed to
// #d4a574. Asked directly, the owner said yes to fixing it. The `.maint*` block in app/globals.css
// now derives everything from one `--maint-ink`, which follows the restaurant's own `--accent`.
//
// `maint-flagship` below is what keeps restaurant #1 byte-for-byte unchanged: it pins the exact
// hand-tuned values that were in the stylesheet before. #1's gold stays hand-tuned; everyone else
// follows their own palette.
//
// The DISPLAY FONT is deliberately still the product's ('Playfair Display', used in eight other
// places) — it is not #1's branding, and there is no per-restaurant font variable. Per-tenant
// typography would be its own piece of work.
//
// SERVED FROM OUR OWN public/, not from littlefrenchhouse.in. It used to be a hardcoded URL on
// that WordPress site — an outside host nobody here controls, on the ONE screen you least want a
// broken image, and cross-origin so the offline layer deliberately never caches it. `public/
// lfh-logo.png` is the identical file (same sha256, 35,633 bytes — checked, not assumed) and is
// what IntroSplash has always used. (T1 improvement 13, 2026-08-07.)
import { stripBrandMarkers } from "@/lib/brandText";
const DEFAULT_LOGO = "/lfh-logo.png";

// THE NAME'S HIGHLIGHT MARKERS ARE NOT PART OF THE NAME (owner, item 6, 2026-09-02).
//
// A restaurant's wordmark is stored with *asterisks* around the part that should wear the accent
// colour — "Demo *Bistro*", "Aangan *Garden*". Header, HeroTitle and IntroSplash all divide that
// text through lib/brandText before drawing it, so the markers never reach a screen. This file
// used the raw string, so on the maintenance screen the asterisks went straight into `alt` and
// into the text fallback: measured on /r/demo-bistro/menu, `alt="Demo *Bistro*"`, which a screen
// reader says out loud as "Demo star Bistro star" (guest sweep T1, sweep #8).
//
// STRIPPED rather than SPLIT, deliberately. Header colours the marked half with the accent, but
// this whole screen is already drawn in one ink derived from that same accent (--maint-ink), so
// highlighting a part of the name would mean inventing a second colour on a screen whose design
// is one colour. Stripping gives the right words in the right ink, which is what the name is for.
// (The import itself sits at the top of the file, where every other import lives.)

// The whole-screen "we're temporarily closed / under maintenance" page.
// AppShell swaps the normal menu out for this when Service Mode is switched on,
// passing THIS restaurant's branding so the screen shows its own name/logo.
export default function Maintenance({ logoText, logoUrl, isDefault = true }: { logoText?: string; logoUrl?: string; isDefault?: boolean }) {
  // #1 keeps its hardcoded logo; other restaurants use their uploaded logo, or
  // fall back to showing their name in text (never the French House mark).
  const showLogo = isDefault ? DEFAULT_LOGO : (logoUrl || null);
  const name = isDefault ? "Little French House" : stripBrandMarkers(logoText || "");
  return (
    // role="alert" makes screen readers announce this important message.
    // `maint-flagship` pins restaurant #1's hand-tuned gold; every other tenant's screen derives
    // from its own --accent (see the note at the top of this file).
    <div className={`maint${isDefault ? " maint-flagship" : ""}`} role="alert" aria-label="Under maintenance">
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
      {/* The reassuring sentence underneath.
          P5 (T15, 2026-08-14): this used to end "Please check back in a few minutes." Nothing turns
          this screen off on a timer — it stays until a person flips Menu maintenance back off — so a
          restaurant that left it on overnight told every diner, all night, to come back in a few
          minutes. The admin's own confirm text was already honest about that ("Guests can't browse or
          order until you turn it back on"); the guest's copy was not. Say the true thing: we're not
          taking orders right now, and ask them to check with the staff, who DO know when. Do not put
          a time back in unless the switch gains one. */}
      <p className="maint-sub">
        We&apos;re not taking orders right now. Please ask a member of staff — they can tell you when
        the menu is back.
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
