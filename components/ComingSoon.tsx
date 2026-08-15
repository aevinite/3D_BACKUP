// Reusable on-brand "Coming soon" page for POS sections that are planned but not
// built yet. Keeps the nav complete (like PetPooja/Toast/Lightspeed) without dead
// links — every menu item lands somewhere intentional. Uses the .adm design tokens.
export default function ComingSoon({
  icon, title, blurb, points,
}: { icon: string; title: string; blurb: string; points?: string[] }) {
  return (
    <div className="adm-coming">
      <div className="adm-coming-ic"><i className={`fas ${icon}`} aria-hidden="true" /></div>
      <span className="adm-coming-badge"><span className="dot" /> Coming soon</span>
      <h1 className="adm-coming-h">{title}</h1>
      <p className="adm-coming-p">{blurb}</p>
      {points && points.length > 0 && (
        <ul className="adm-coming-list">
          {points.map((p) => (
            <li key={p}><i className="fas fa-circle-check" aria-hidden="true" /> {p}</li>
          ))}
        </ul>
      )}
      <div className="adm-coming-foot">Not built yet — it&apos;ll show up here when it is.</div>
    </div>
  );
}
