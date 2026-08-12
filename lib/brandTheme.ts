// Pure helpers for per-restaurant theming. Validates hex colours and builds the
// CSS custom-property block for ONE mode (dark or light). No DOM, no React —
// shared by the guest render (AppShell) and unit-testable in isolation.

export type ModePalette = { bg?: string; card?: string; text?: string; accent?: string };
export type BrandTheme = { dark?: ModePalette; light?: ModePalette };

export function isHexColor(s: unknown): s is string {
  return typeof s === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
}

export function hexToRgbTriplet(hex: string): string | null {
  if (!isHexColor(hex)) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function cleanPalette(p: unknown): ModePalette {
  const out: ModePalette = {};
  if (p && typeof p === "object") {
    for (const k of ["bg", "card", "text", "accent"] as const) {
      const v = (p as Record<string, unknown>)[k];
      if (isHexColor(v)) out[k] = (v as string).trim();
    }
  }
  return out;
}

export function sanitizeBrandTheme(input: unknown): BrandTheme {
  const out: BrandTheme = {};
  const dark = cleanPalette((input as any)?.dark);
  const light = cleanPalette((input as any)?.light);
  if (Object.keys(dark).length) out.dark = dark;
  if (Object.keys(light).length) out.light = light;
  return out;
}

// Build the CSS var lines for ONE mode. Accent (and its derived gradient/glows)
// falls back to accentFallback when the mode itself sets no accent. Returns "" if
// there's nothing to emit (no palette keys AND no usable accent).
// `mode` is USED (it stopped being `_mode` on 2026-08-12): the readable "ink" version of the accent
// is derived differently in each skin, so this block cannot emit it without knowing which skin it is
// writing. See the --accent-ink note at the bottom of the function.
export function buildModeBlock(mode: "dark" | "light", palette: ModePalette, accentFallback?: string): string {
  const p = cleanPalette(palette);
  const accent = p.accent || (isHexColor(accentFallback) ? (accentFallback as string).trim() : undefined);
  const lines: string[] = [];
  if (p.bg) lines.push(`--bg: ${p.bg};`);
  if (p.card) lines.push(`--card: ${p.card};`);
  if (p.text) {
    lines.push(`--text: ${p.text};`);
    const rgb = hexToRgbTriplet(p.text);
    if (rgb) lines.push(`--muted: rgba(${rgb}, 0.72);`);
  }
  if (accent) {
    const rgb = hexToRgbTriplet(accent);
    const grad = `linear-gradient(135deg, ${accent} 0%, color-mix(in srgb, ${accent} 82%, #000) 100%)`;
    lines.push(`--accent: ${accent};`, `--gold: ${accent};`, `--accent-grad: ${grad};`, `--gold-grad: ${grad};`, `--brand-highlight: ${accent};`);
    if (rgb) lines.push(`--accent-dim: rgba(${rgb}, 0.6);`, `--accent-glow: rgba(${rgb}, 0.34);`, `--gold-glow: rgba(${rgb}, 0.42);`);
    // ONE RESTAURANT, ONE BRAND COLOUR — the ink tokens have to be re-derived HERE (guest sweep T1,
    // 2026-08-12; owner confirmed it is a real problem).
    //
    // globals.css declares `--accent-ink` ONCE, at `:root`, as a value derived from `--accent`
    // (`var(--accent)` in dark, `color-mix(… 55%, #000)` in light). A custom property that uses
    // var() is resolved on the element where it is DECLARED, so `--accent-ink` is fixed on the root
    // and then simply inherits. This block writes `--accent` on `#app.brand-themed`, a different
    // element further down — so `--accent` changed and `--accent-ink` did not.
    //
    // The result was two brand colours on one screen. Measured on Aangan Garden, dark, 360px:
    // `--accent` at :root (its accent_color) = rgb(232,119,46) orange, `--accent` inside #app (its
    // theme palette) = rgb(48,152,232) blue. So the header wordmark was blue, the hero wordmark
    // ORANGE (it paints from --accent-ink), the "+" buttons and the waiter bell blue, and the cart
    // and bill sheet — which are mounted OUTSIDE #app, at body level — orange again. The same word
    // "Garden" appeared in two colours 200px apart.
    //
    // Worse for a themed restaurant with NO accent_color: nothing emits a :root palette at all, so
    // --accent-ink kept the value in globals.css — restaurant #1's gold — and its hero and search
    // prices would have been French House gold on someone else's menu.
    //
    // These two lines MUST mirror app/globals.css (`:root` for dark, `[data-theme="light"]` for
    // light). If the ink formula changes there, change it here in the same commit.
    if (mode === "light") {
      lines.push(`--accent-ink: color-mix(in srgb, ${accent} 55%, #000);`, `--accent-ink-dim: color-mix(in srgb, ${accent} 62%, #000);`);
    } else {
      lines.push(`--accent-ink: ${accent};`);
      if (rgb) lines.push(`--accent-ink-dim: rgba(${rgb}, 0.6);`);
    }
  }
  return lines.join(" ");
}

// The variables the PAGE CANVAS itself is painted from — `html, body { background: var(--bg);
// color: var(--text) }` in app/globals.css.
//
// WHY THIS EXISTS (visual sweep, 2026-08-05): buildModeBlock's output is emitted scoped to
// `#app.brand-themed`, a <div> INSIDE <body>. So html/body never saw the override and kept the
// DEFAULT --bg — restaurant #1's brown #1a0f09. On Demo Bistro (pink accent, dark-green cards)
// the band under the brand bar, the margins beside the dish grid and everything below the last
// dish were all #1's brown, framing a cool green menu. Pixel samples down the page: (20,100)
// (20,450) (20,860) (1260,600) all rgb(26,15,9) while the tenant's own --bg was #0f1f1c. That
// breaks the "nothing on a non-#1 restaurant may show #1's branding" rule.
//
// The accent palette already had to be hoisted to :root for exactly this reason (see the comment
// in components/AppShell.tsx); this is the same fix for the canvas. Only the two canvas vars are
// hoisted — everything else stays scoped, so nothing outside the guest app can be re-coloured.
export function buildCanvasBlock(palette: ModePalette): string {
  const p = cleanPalette(palette);
  const lines: string[] = [];
  if (p.bg) lines.push(`--bg: ${p.bg};`);
  if (p.text) lines.push(`--text: ${p.text};`);
  return lines.join(" ");
}
