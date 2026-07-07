// lib/accent.ts
// ONE brand colour → the FULL accent palette, as a CSS declaration string we can
// drop into a document-level <style> block. Emitting these variables at :root
// (instead of only on #menu-page) is what makes a restaurant's colour reach
// EVERY widget — the floating waiter button, the cart, the pop-ups, the toasts
// and the 3D viewer — not just the menu body. (Audit fix 2026-07-07: bugs #1/#2,
// the "French House gold leaks onto other restaurants" white-label bug.)
//
// Only non-#1 restaurants ever pass an accent colour (see AppShell / MenuView),
// so restaurant #1 keeps its hand-tuned gold from globals.css :root untouched.

// Turn a brand hex ("#c0392b") into "r, g, b" so we can build rgba() glows at any
// opacity. Accepts #rgb or #rrggbb; returns null for anything we can't parse.
export function hexToRgbTriplet(hex: string): string | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// The colour VARIABLES only (no page background) — safe to set on :root so the
// whole document, including body-level widgets, follows the restaurant colour.
export function accentPaletteCss(accentColor: string): string {
  const rgb = hexToRgbTriplet(accentColor);
  const grad = `linear-gradient(135deg, ${accentColor} 0%, color-mix(in srgb, ${accentColor} 82%, #000) 100%)`;
  const lines = [
    `--accent:${accentColor}`,
    `--gold:${accentColor}`,
    `--accent-grad:${grad}`,
    `--gold-grad:${grad}`,
    `--brand-highlight:${accentColor}`,
  ];
  if (rgb) {
    lines.push(`--accent-dim:rgba(${rgb}, 0.6)`);
    lines.push(`--accent-glow:rgba(${rgb}, 0.34)`);
    lines.push(`--gold-glow:rgba(${rgb}, 0.42)`);
  }
  return lines.join(";") + ";";
}

// The soft brand-coloured ATMOSPHERE wash for the menu PAGE background only (a
// top glow + faint tint over the whole menu, so each restaurant feels its own).
// Kept off :root on purpose — it's a page backdrop, not a widget colour.
export function accentBackground(accentColor: string): string | null {
  const rgb = hexToRgbTriplet(accentColor);
  if (!rgb) return null;
  return `radial-gradient(1200px 620px at 50% -240px, rgba(${rgb}, 0.16), transparent 68%), color-mix(in srgb, ${accentColor} 6%, var(--bg))`;
}
