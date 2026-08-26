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

// WHICH INK READS ON THE ACCENT ITSELF — black or white, whichever genuinely has more contrast.
//
// Not a brightness THRESHOLD. That is what the category chips used to do (a cut-off at 0.42
// relative luminance) and it picked the weaker ink on 11 of the 21 category colours in the
// database — white on #22c55e measured 2.3:1 where the standard is 4.5:1 and near-black would have
// been 8.3:1. Comparing the two candidates is the same amount of code and cannot be wrong: at
// worst the two are equal and either will do. (Owner, 2026-08-26 — the category bar now draws in
// the restaurant's own theme colour, so this one decision replaces twenty-one.)
//
// WCAG relative luminance, the same maths the rest of the app's contrast checks use.
export function inkOnAccent(accentColor: string): string {
  const h = accentColor.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const lum = (hex: string) => {
    const ch = (i: number) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  };
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const acc = lum(full);
  return contrast(acc, lum("ffffff")) >= contrast(acc, lum("1a0f0a")) ? "#ffffff" : "#1a0f0a";
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
    // The ink for text and icons sitting ON an accent fill — today the selected category chip.
    // One value per restaurant, decided from its own colour, so a pale brand and a dark brand are
    // both readable without anyone configuring anything.
    `--cat-on:${inkOnAccent(accentColor)}`,
  ];
  if (rgb) {
    lines.push(`--accent-dim:rgba(${rgb}, 0.6)`);
    lines.push(`--accent-glow:rgba(${rgb}, 0.34)`);
    lines.push(`--gold-glow:rgba(${rgb}, 0.42)`);
  }
  return lines.join(";") + ";";
}

// ── THE PAGE ITSELF, for a restaurant that has only picked an accent ────────────────────────
// accentPaletteCss above re-colours the accent FAMILY. Everything else a page is made of —
// `--bg`, `--card`, `--text`, `--muted`, `--border` — was still whatever globals.css :root says,
// and globals.css says restaurant #1: `--bg: #1a0f09  /* deep espresso-brown (logo brown family) */`
// in dark and `#faf3e8` / text `#3c2a1e` in light. Measured on the deployed site (guest sweep T1,
// 2026-08-06): Green Bowl (green) and Sakura Sushi (pink) both opened on French House's cream page
// with French House brown body text, because neither has a full `theme` object — only an accent.
// `buildCanvasBlock` in lib/brandTheme.ts already fixes this for tenants that DO set a theme; this
// is the same fix for the far commoner case of a tenant that never set one.
//
// A NEUTRAL BASE + A WHISPER OF THE BRAND, not a guess at a palette. The base is a true neutral
// (near-black / near-white), so contrast is predictable whatever colour the owner chose; the accent
// is mixed in at 6–12% purely so the page feels like it belongs to the brand. Measured contrast:
// #f2f3f5 on the dark base ≈ 16:1, #1f2328 on the light base ≈ 14:1 — both far past AA.
//
// WHY `html[data-theme=…]` AND NOT `:root`: `html, body { background: var(--bg) }` sits ABOVE #app
// in the tree, and globals.css declares the #1 values at `[data-theme="light"]` (specificity 0,1,0)
// which ties with `:root`. `html[data-theme="light"]` is 0,1,1, so it wins outright — the same
// specificity trap documented in CLAUDE.md's known gotchas. It stays BELOW a themed tenant's own
// `[data-theme] #app.brand-themed` block (0,2,1), so an owner who has set a real palette still wins.
export function accentCanvasCss(accentColor: string): string {
  if (!hexToRgbTriplet(accentColor)) return ""; // unparseable → change nothing, keep today's look
  const mix = (pct: number, base: string) => `color-mix(in srgb, ${accentColor} ${pct}%, ${base})`;
  const dark = [
    `--bg:${mix(8, "#0d0d10")}`,
    `--card:${mix(12, "#17171c")}`,
    `--text:#f2f3f5`,
    `--muted:rgba(235, 238, 245, 0.62)`,
    `--border:1px solid ${mix(30, "transparent")}`,
  ].join(";");
  const light = [
    `--bg:${mix(6, "#ffffff")}`,
    `--card:#ffffff`,
    `--text:#1f2328`,
    `--muted:${mix(55, "#4a4f57")}`,
    `--border:1px solid ${mix(26, "transparent")}`,
  ].join(";");
  return `html[data-theme="dark"]{${dark};}html[data-theme="light"]{${light};}`;
}

// The soft brand-coloured ATMOSPHERE wash for the menu PAGE background only (a
// top glow + faint tint over the whole menu, so each restaurant feels its own).
// Kept off :root on purpose — it's a page backdrop, not a widget colour.
export function accentBackground(accentColor: string): string | null {
  const rgb = hexToRgbTriplet(accentColor);
  if (!rgb) return null;
  return `radial-gradient(1200px 620px at 50% -240px, rgba(${rgb}, 0.16), transparent 68%), color-mix(in srgb, ${accentColor} 6%, var(--bg))`;
}
