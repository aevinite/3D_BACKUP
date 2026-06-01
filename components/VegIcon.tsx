export default function VegIcon({ isVeg, size = 20 }: { isVeg: boolean; size?: number }) {
  if (isVeg) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Vegetarian">
        <rect className="veg-box" x="6" y="6" width="52" height="52" rx="8" />
        <circle className="veg-dot" cx="32" cy="32" r="14" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Non-Vegetarian">
      <rect className="nv-box" x="6" y="6" width="52" height="52" rx="8" />
      <polygon className="nv-tri" points="32,14 52,50 12,50" />
    </svg>
  );
}
