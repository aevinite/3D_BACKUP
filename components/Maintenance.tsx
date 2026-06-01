// Full-screen "under maintenance" screen shown when Service Mode is on
// (toggled from the editor's General tab). Pure CSS continuous animations.

const LOGO =
  "https://littlefrenchhouse.in/restaurant/wp-content/uploads/2021/01/LFH-Logo_200x200-e1612862168838.png";

export default function Maintenance() {
  return (
    <div className="maint" role="alert" aria-label="Under maintenance">
      <div className="maint-stage">
        <div className="maint-ring" />
        <div className="maint-steam">
          <span />
          <span />
          <span />
        </div>
        <img className="maint-logo" src={LOGO} alt="Little French House" />
      </div>
      <div className="maint-badge">🔧 Under Maintenance</div>
      <h1 className="maint-title">We&apos;ll be right back</h1>
      <p className="maint-sub">
        Our kitchen is getting a little tune-up. Please check back in a few minutes.
      </p>
      <div className="maint-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
