// Full-screen "under maintenance" screen shown when Service Mode is on
// (toggled from the editor's General tab). Pure CSS continuous animations.

// The web address of the restaurant logo image shown on this screen.
const LOGO =
  "https://littlefrenchhouse.in/restaurant/wp-content/uploads/2021/01/LFH-Logo_200x200-e1612862168838.png";

// The whole-screen "we're temporarily closed / under maintenance" page.
// AppShell swaps the normal menu out for this when Service Mode is switched on.
export default function Maintenance() {
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
        {/* The restaurant logo */}
        <img className="maint-logo" src={LOGO} alt="Little French House" />
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
