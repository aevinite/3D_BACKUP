# Phase 2 — Admin Branding Editor (full theme palette, light+dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** From `/aevinite/restaurants`, the admin sets a restaurant's full theme palette (background / card / text / accent) via colour-picker AND hex input, with a live preview, for BOTH light and dark mode, plus hero title / tagline / logo text — recolouring the whole guest menu and never leaking #1's branding.

**Architecture:** Reuse existing `restaurants` columns: `accent_color` + the unused `theme jsonb` (shape `{dark:{bg,card,text,accent}, light:{bg,card,text,accent}}`) + `hero_title`/`tagline`/`logo_text`. No migration. A new admin route reads/writes them. The guest render emits a `[data-theme=...]`-scoped `<style>` block for themed restaurants (because inline styles can't switch by mode); existing accent-only restaurants keep their current inline `accentVars` path; restaurant #1's `isDefault` path is untouched.

**Tech Stack:** Next.js route handler + Supabase service role, React client components, CSS custom properties scoped by `[data-theme]`.

---

## File Structure

- **Modify** `lib/tenant.ts` — add `theme` to the `Restaurant` type + SELECT; give the per-process slug cache a short TTL so saved branding shows within ~15s.
- **Modify** `app/r/[restaurant]/menu/page.tsx` — pass `theme` to `MenuView`.
- **Create** `app/api/admin/restaurants/branding/route.ts` — GET current branding; POST validated branding update (admin-gated).
- **Create** `lib/brandTheme.ts` — pure helper: validate a hex, build the per-mode CSS variable block from a palette (shared by render). Keeps `AppShell` lean + unit-testable.
- **Test** `lib/brandTheme.test.mjs` — node test for hex validation + CSS generation.
- **Modify** `components/AppShell.tsx` — accept `theme`; when themed, render a mode-scoped `<style>` block (via `lib/brandTheme.ts`) and tag `#menu-page` with `brand-themed`; keep accent-only + #1 paths exactly as today.
- **Modify** `components/MenuView.tsx` — thread `theme` into `AppShell` (non-#1 only).
- **Modify** `app/aevinite/restaurants/page.tsx` — add a `BrandingCard` (mode switch, 4 colour controls with picker+hex, live preview, hero/tagline/logo-text inputs) into `RestaurantDetail`.

---

### Task 1: `lib/brandTheme.ts` — pure validate + CSS builder (TDD)

**Files:**
- Create: `lib/brandTheme.ts`
- Test: `lib/brandTheme.test.mjs`

**Interface:**
- `isHexColor(s): boolean` — true for `#rgb` / `#rrggbb`.
- `hexToRgbTriplet(hex): string | null` — "r, g, b" or null.
- `type ModePalette = { bg?: string; card?: string; text?: string; accent?: string }`
- `type BrandTheme = { dark?: ModePalette; light?: ModePalette }`
- `sanitizeBrandTheme(input): BrandTheme` — keep only valid hex values, drop the rest; returns `{}` if nothing valid.
- `buildModeBlock(mode, palette, accentFallback): string` — returns the CSS *body* (the `--var: …;` lines) for one mode, or `""` if the palette yields nothing. Accent falls back to `accentFallback` when the mode has no accent.

- [ ] **Step 1: Write the failing test** — create `lib/brandTheme.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isHexColor, hexToRgbTriplet, sanitizeBrandTheme, buildModeBlock } from "./brandTheme.ts";

test("isHexColor accepts #rgb and #rrggbb, rejects junk", () => {
  assert.equal(isHexColor("#fff"), true);
  assert.equal(isHexColor("#1a0f09"), true);
  assert.equal(isHexColor("red"), false);
  assert.equal(isHexColor("#12g"), false);
  assert.equal(isHexColor(""), false);
  assert.equal(isHexColor("javascript:alert(1)"), false);
});

test("hexToRgbTriplet expands shorthand", () => {
  assert.equal(hexToRgbTriplet("#fff"), "255, 255, 255");
  assert.equal(hexToRgbTriplet("#000000"), "0, 0, 0");
  assert.equal(hexToRgbTriplet("nope"), null);
});

test("sanitizeBrandTheme keeps only valid hex, drops junk", () => {
  const out = sanitizeBrandTheme({ dark: { bg: "#111", text: "notacolor", accent: "#e3c06f" }, light: { card: "#fff" }, junk: 1 });
  assert.deepEqual(out, { dark: { bg: "#111", accent: "#e3c06f" }, light: { card: "#fff" } });
});

test("buildModeBlock emits vars + derives accent + uses fallback", () => {
  const css = buildModeBlock("dark", { bg: "#101010", text: "#eee" }, "#e3c06f");
  assert.match(css, /--bg:\s*#101010/);
  assert.match(css, /--text:\s*#eee/);
  assert.match(css, /--accent:\s*#e3c06f/);   // fell back
  assert.match(css, /--accent-grad:/);
  assert.equal(buildModeBlock("dark", {}, undefined), "");  // nothing to emit
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test lib/brandTheme.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/brandTheme.ts`:**

```ts
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
export function buildModeBlock(_mode: "dark" | "light", palette: ModePalette, accentFallback?: string): string {
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
  }
  return lines.join(" ");
}
```

- [ ] **Step 4: Run the test, verify it passes** — `node --test lib/brandTheme.test.mjs` → 4 pass.
- [ ] **Step 5: Type-check** — `npx tsc --noEmit -p tsconfig.json; echo TSC=$?` → `TSC=0`.
- [ ] **Step 6: Commit**

```bash
git add lib/brandTheme.ts lib/brandTheme.test.mjs
git commit -m "feat(branding): pure theme helpers (hex validate + per-mode CSS builder)"
```

---

### Task 2: `lib/tenant.ts` — return `theme`, short-TTL cache; pass to MenuView

**Files:**
- Modify: `lib/tenant.ts`
- Modify: `app/r/[restaurant]/menu/page.tsx`

- [ ] **Step 1: Add `theme` to the interface.** In `lib/tenant.ts`, add to `interface Restaurant` after `accentColor`:

```ts
  theme: Record<string, unknown> | null;
```

- [ ] **Step 2: Select it + return it + TTL cache.** Replace the cache + `getRestaurantBySlug` body (lines 27-54) with:

```ts
// Per-process cache: slug -> {value, at}. Short TTL so an admin's branding/menu
// edit shows on the guest menu within ~15s without a process restart. (Restaurants
// change rarely; one tiny row read every 15s per active slug is negligible egress.)
const bySlug = new Map<string, { value: Restaurant | null; at: number }>();
const TTL_MS = 15000;

export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const hit = bySlug.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, slug, name, active, logo_text, hero_title, tagline, accent_color, theme")
    .eq("slug", slug)
    .maybeSingle();
  const r: Restaurant | null =
    !error && data
      ? {
          id: data.id, slug: data.slug, name: data.name, active: !!data.active,
          logoText: data.logo_text ?? null, heroTitle: data.hero_title ?? null,
          tagline: data.tagline ?? null, accentColor: data.accent_color ?? null,
          theme: (data.theme && typeof data.theme === "object") ? data.theme as Record<string, unknown> : null,
        }
      : null;
  bySlug.set(slug, { value: r, at: Date.now() });
  return r;
}
```

- [ ] **Step 3: Pass `theme` to MenuView.** In `app/r/[restaurant]/menu/page.tsx`, add after `accentColor={r.accentColor ?? undefined}`:

```tsx
      theme={r.theme ?? undefined}
```

- [ ] **Step 4: Type-check** — `npx tsc --noEmit -p tsconfig.json; echo TSC=$?` → `TSC=0`.
- [ ] **Step 5: Commit**

```bash
git add lib/tenant.ts "app/r/[restaurant]/menu/page.tsx"
git commit -m "feat(branding): tenant resolver returns theme + short-TTL cache"
```

---

### Task 3: Guest render — mode-scoped style block for themed restaurants

**Files:**
- Modify: `components/MenuView.tsx`
- Modify: `components/AppShell.tsx`

- [ ] **Step 1: Thread `theme` through MenuView.** In `components/MenuView.tsx`, add `theme` to the prop list + type:

Change the signature to include `theme?: Record<string, unknown>`:
```tsx
export default function MenuView({ restaurantId, restaurantSlug, restaurantName, logoText, heroTitle, tagline, accentColor, theme }: { restaurantId: string; restaurantSlug?: string; restaurantName?: string; logoText?: string; heroTitle?: string; tagline?: string; accentColor?: string; theme?: Record<string, unknown> }) {
```

And pass it to AppShell (non-#1 only). Change the `<AppShell …>` opening tag to add:
```tsx
      theme={isDefault ? undefined : theme}
```

- [ ] **Step 2: Render the style block in AppShell.** In `components/AppShell.tsx`:

(a) Add the import at the top:
```ts
import { sanitizeBrandTheme, buildModeBlock } from "@/lib/brandTheme";
```

(b) Change the component signature (line 64) to accept `theme`:
```ts
export default function AppShell({ children, logoText, accentColor, restaurantId, theme }: { children: React.ReactNode; logoText?: string; accentColor?: string; restaurantId?: string; theme?: Record<string, unknown> }) {
```

(c) Just before `return (` (after the `if (serviceMode)` line ~147), compute the themed CSS:
```ts
  // Per-restaurant FULL palette (Phase 2). When a restaurant has theme overrides, we
  // emit mode-scoped CSS (inline styles can't switch on the [data-theme] toggle). The
  // block targets #menu-page.brand-themed so it never affects #1 or other pages. Accent
  // falls back to accentColor per mode. Restaurants with only accentColor (no theme) keep
  // the inline accentVars path below — unchanged.
  const bt = theme ? sanitizeBrandTheme(theme) : {};
  const darkBody = bt.dark ? buildModeBlock("dark", bt.dark, accentColor) : "";
  const lightBody = bt.light ? buildModeBlock("light", bt.light, accentColor) : "";
  const themed = !!(darkBody || lightBody);
  const themedCss = themed
    ? `${darkBody ? `[data-theme="dark"] #menu-page.brand-themed{${darkBody}}` : ""}` +
      `${lightBody ? `[data-theme="light"] #menu-page.brand-themed{${lightBody}}` : ""}`
    : "";
```

(d) In the returned JSX: render the `<style>` when themed, add the `brand-themed` class, and DON'T also apply the inline `accentVars` for themed restaurants (the style block owns the vars; inline would beat the mode selector). Replace the `<IntroSplash …/>` line and the `#menu-page` `<div>` open:

Replace:
```tsx
      <IntroSplash wordmark={logoText} accentColor={accentColor} />
```
with:
```tsx
      {themed && <style dangerouslySetInnerHTML={{ __html: themedCss }} />}
      <IntroSplash wordmark={logoText} accentColor={accentColor} />
```

Replace:
```tsx
        <div id="menu-page" className="page active" style={accentColor ? accentVars(accentColor) : undefined}>
```
with:
```tsx
        <div id="menu-page" className={`page active${themed ? " brand-themed" : ""}`} style={!themed && accentColor ? accentVars(accentColor) : undefined}>
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit -p tsconfig.json; echo TSC=$?` → `TSC=0`.
- [ ] **Step 4: Commit**

```bash
git add components/MenuView.tsx components/AppShell.tsx
git commit -m "feat(branding): mode-scoped CSS for themed restaurants (accent-only + #1 paths unchanged)"
```

---

### Task 4: Admin branding API route

**Files:**
- Create: `app/api/admin/restaurants/branding/route.ts`

- [ ] **Step 1: Create the route:**

```ts
// /api/admin/restaurants/branding — read/write ONE restaurant's brand identity:
// accent_color + full theme palette (theme jsonb: {dark,light}{bg,card,text,accent})
// + hero_title / tagline / logo_text. Admin-gated, service role. Reuses existing
// columns (migration 087) — no migration. All colours validated as hex.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { isHexColor, sanitizeBrandTheme } from "@/lib/brandTheme";

export const dynamic = "force-dynamic";
const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!rid) return bad("Missing restaurant_id.");
  const { data, error } = await sb.from("restaurants")
    .select("accent_color, theme, hero_title, tagline, logo_text").eq("id", rid).maybeSingle();
  if (error) return bad(error.message, 500);
  return ok({
    accent_color: data?.accent_color ?? null,
    theme: (data?.theme && typeof data.theme === "object") ? data.theme : {},
    hero_title: data?.hero_title ?? null,
    tagline: data?.tagline ?? null,
    logo_text: data?.logo_text ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const rid = String(body?.restaurant_id || "");
  if (!rid) return bad("Missing restaurant_id.");
  const patch: Record<string, unknown> = {};
  if ("accent_color" in body) {
    const a = body.accent_color;
    if (a === null || a === "") patch.accent_color = null;
    else if (isHexColor(a)) patch.accent_color = String(a).trim();
    else return bad("accent_color must be a hex colour like #e3c06f.");
  }
  if ("theme" in body) patch.theme = sanitizeBrandTheme(body.theme);  // drops any non-hex
  if ("hero_title" in body) patch.hero_title = body.hero_title ? String(body.hero_title).slice(0, 120) : null;
  if ("tagline" in body) patch.tagline = body.tagline ? String(body.tagline).slice(0, 80) : null;
  if ("logo_text" in body) patch.logo_text = body.logo_text ? String(body.logo_text).slice(0, 60) : null;
  if (!Object.keys(patch).length) return bad("Nothing to update.");
  const { error } = await sb.from("restaurants").update(patch).eq("id", rid);
  if (error) return bad(error.message, 500);
  await logAction("admin", "restaurant_branding", { actor: "admin", restaurant_id: rid, detail: `updated branding (${Object.keys(patch).join(", ")})` });
  return ok({ ok: true });
}
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit -p tsconfig.json; echo TSC=$?` → `TSC=0`.
- [ ] **Step 3: Commit**

```bash
git add app/api/admin/restaurants/branding/route.ts
git commit -m "feat(branding): admin branding GET/POST route (hex-validated)"
```

---

### Task 5: Admin `BrandingCard` UI (palette + hex + preview + light/dark + text)

**Files:**
- Modify: `app/aevinite/restaurants/page.tsx`

- [ ] **Step 1: Add the `BrandingCard` component.** Insert this component definition just before `function OwnerCard(` (≈ line 368):

```tsx
// Per-restaurant brand identity: full theme palette (bg/card/text/accent) per
// light & dark mode, via colour-picker AND hex input, with a live preview, plus
// hero/tagline/logo-text. Writes /api/admin/restaurants/branding.
const PALETTE_FIELDS: { key: "bg" | "card" | "text" | "accent"; label: string }[] = [
  { key: "bg", label: "Background" }, { key: "card", label: "Card / surface" },
  { key: "text", label: "Text" }, { key: "accent", label: "Accent" },
];
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function BrandingCard({ restaurant }: { restaurant: Restaurant }) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [theme, setTheme] = useState<{ dark: Record<string, string>; light: Record<string, string> }>({ dark: {}, light: {} });
  const [hero, setHero] = useState(""); const [tagline, setTagline] = useState(""); const [logoText, setLogoText] = useState("");
  const [accent, setAccent] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch(`/api/admin/restaurants/branding?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
        if (!j.error) {
          const t = j.theme || {};
          setTheme({ dark: { ...(t.dark || {}) }, light: { ...(t.light || {}) } });
          setHero(j.hero_title || ""); setTagline(j.tagline || ""); setLogoText(j.logo_text || ""); setAccent(j.accent_color || "");
        }
      } catch {}
    })();
  }, [restaurant.id]);

  const cur = theme[mode];
  const setColor = (key: string, val: string) => setTheme((s) => ({ ...s, [mode]: { ...s[mode], [key]: val } }));
  const clearColor = (key: string) => setTheme((s) => { const m = { ...s[mode] }; delete m[key]; return { ...s, [mode]: m }; });

  // Preview defaults so an unset slot still renders something sensible in the swatch.
  const pv = {
    bg: cur.bg || (mode === "dark" ? "#1a0f09" : "#faf3e8"),
    card: cur.card || (mode === "dark" ? "#2c1b11" : "#ffffff"),
    text: cur.text || (mode === "dark" ? "#f3e9db" : "#3c2a1e"),
    accent: cur.accent || accent || (mode === "dark" ? "#e3c06f" : "#d4a574"),
  };
  const lowContrast = (() => {
    const lum = (hex: string) => { const h = hex.replace("#", ""); const f = h.length === 3 ? h.split("").map(c=>c+c).join("") : h; const n = parseInt(f, 16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; return (0.299*r+0.587*g+0.114*b)/255; };
    try { return Math.abs(lum(pv.text) - lum(pv.bg)) < 0.35; } catch { return false; }
  })();

  const save = async () => {
    // validate any filled hex
    for (const m of ["dark", "light"] as const)
      for (const k of Object.keys(theme[m]))
        if (theme[m][k] && !HEX_RE.test(theme[m][k])) { setMsg(`${m} ${k}: "${theme[m][k]}" isn't a hex colour (e.g. #1a0f09).`); return; }
    if (accent && !HEX_RE.test(accent)) { setMsg(`Accent "${accent}" isn't a hex colour.`); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/restaurants/branding", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, theme, accent_color: accent || null, hero_title: hero || null, tagline: tagline || null, logo_text: logoText || null }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg("Saved — open the guest menu to see it (within ~15s).");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const inputStyle: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 };

  return (
    <div className="adm-card" style={{ marginBottom: 14 }}>
      <h2>Branding &amp; theme</h2>
      <p className="hint">Set <b>{restaurant.name}</b>&apos;s colours, logo text and hero — for light and dark mode. Leave a colour blank to use the sensible default. Changes show on the guest menu within ~15s.</p>

      <div className="adm-togglegrid" style={{ marginBottom: 12 }}>
        <button className={`adm-toggle ${mode === "dark" ? "on" : "off"}`} onClick={() => setMode("dark")}><span>Dark mode</span><span className="pill">{mode === "dark" ? "EDITING" : ""}</span></button>
        <button className={`adm-toggle ${mode === "light" ? "on" : "off"}`} onClick={() => setMode("light")}><span>Light mode</span><span className="pill">{mode === "light" ? "EDITING" : ""}</span></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {PALETTE_FIELDS.map((f) => (
            <div key={f.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ width: 110, fontSize: 13 }}>{f.label}</label>
              <input type="color" value={(cur[f.key] && HEX_RE.test(cur[f.key])) ? cur[f.key] : pv[f.key]} disabled={busy}
                onChange={(e) => setColor(f.key, e.target.value)} style={{ width: 38, height: 30, border: "none", background: "none", cursor: "pointer" }} />
              <input value={cur[f.key] || ""} placeholder={pv[f.key]} disabled={busy} onChange={(e) => setColor(f.key, e.target.value.trim())} style={{ ...inputStyle, width: 110, fontFamily: "ui-monospace, monospace" }} />
              {cur[f.key] && <button className="adm-btn" disabled={busy} onClick={() => clearColor(f.key)} title="Reset to default" style={{ padding: "4px 8px" }}>↺</button>}
            </div>
          ))}
        </div>
        {/* Live preview swatch */}
        <div style={{ borderRadius: 12, overflow: "hidden", border: "var(--border)" }}>
          <div style={{ background: pv.bg, color: pv.text, padding: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.7 }}>WELCOME</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: pv.accent }}>{hero || "Our Menu"}</div>
            <div style={{ background: pv.card, borderRadius: 10, padding: 10, marginTop: 10 }}>
              <div style={{ fontWeight: 700 }}>Sample Dish</div>
              <div style={{ display: "inline-block", marginTop: 6, padding: "4px 10px", borderRadius: 999, background: pv.accent, color: pv.bg, fontSize: 12, fontWeight: 700 }}>Add</div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>{mode} preview</div>
          </div>
        </div>
      </div>
      {lowContrast && <p className="hint" style={{ color: "var(--adm-bad, #c0392b)", marginTop: 8 }}>⚠ Text and background look low-contrast — guests may struggle to read it.</p>}

      <div style={{ display: "grid", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "var(--border)" }}>
        <label style={{ fontSize: 12 }}>Logo text (header + opening screen)<input value={logoText} placeholder={restaurant.name} disabled={busy} onChange={(e) => setLogoText(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
        <label style={{ fontSize: 12 }}>Hero title<input value={hero} placeholder="Our Menu" disabled={busy} onChange={(e) => setHero(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
        <label style={{ fontSize: 12 }}>Greeting / tagline<input value={tagline} placeholder="Welcome" disabled={busy} onChange={(e) => setTagline(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <button className="adm-btn primary" disabled={busy} onClick={save}><i className="fas fa-check" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Saving…" : "Save branding"}</button>
        {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `RestaurantDetail`.** Right after `<OwnerCard … />` (line 337), add:

```tsx
      <BrandingCard restaurant={restaurant} />
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit -p tsconfig.json; echo TSC=$?` → `TSC=0`.
- [ ] **Step 4: Commit**

```bash
git add app/aevinite/restaurants/page.tsx
git commit -m "feat(branding): admin BrandingCard — palette+hex, light/dark, live preview, hero/logo text"
```

---

### Task 6: Live verification (desktop + ~390px, both modes)

- [ ] **Step 1** — Dev server up: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/aevinite/restaurants`.
- [ ] **Step 2** — In `/aevinite/restaurants`, open **Demo Bistro** → "Branding & theme". For DARK: set background, card, text, accent to a distinct palette (e.g. bg `#0f1f1c`, card `#16302b`, text `#eafff6`, accent `#ff4da6`); switch to LIGHT: bg `#f2fbf7`, text `#10231d`, accent `#ff4da6`. Confirm the live preview recolours as you type a hex and as you pick. Set Hero "Demo Bistro", Save → "Saved" message.
- [ ] **Step 3** — Open `/r/demo-bistro/menu?table=1`, wait ~15s or hard-reload. Confirm in **dark** mode the whole menu uses the teal bg / pink accent (pills, glows, gradient); toggle to **light** → the light palette applies. No console errors. Capture screenshots at desktop AND ~390px, both modes.
- [ ] **Step 4** — Confirm **no LFH leak** and #1 untouched: `/r/french-house/menu` still shows its gold + French hero in both modes; Pizza Palace (accent-only, no theme) still looks exactly as before (accent path unchanged).
- [ ] **Step 5** — Edge: clear a colour (↺) and Save → that slot reverts to default on the guest menu; type an invalid hex (`#zzz`) → Save is blocked with a clear message (no bad value written).

---

## Self-Review

**1. Spec coverage (Phase 2 of design doc):**
- Full palette bg/card/text/accent, derived everything → `buildModeBlock` (Task 1) + render (Task 3). ✓
- Picker AND hex input, live preview → `BrandingCard` (Task 5). ✓
- Light AND dark, themed separately, stored as `{dark,light}` in `theme` jsonb + accent_color → Tasks 1/2/4/5. ✓
- Render merges per-mode scoped to mode, keeps `isDefault` guard, accent-only path unchanged → Task 3. ✓
- API validates hex, length-caps text, busts cache (TTL) → Tasks 2/4. ✓
- Soft contrast warning (don't block) → Task 5 `lowContrast`. ✓
- Verify recolour everywhere, both modes, #1 untouched, desktop+390px → Task 6. ✓

**2. Placeholder scan:** none — every code step is complete.

**3. Type consistency:** `sanitizeBrandTheme`/`buildModeBlock`/`isHexColor` signatures match across `lib/brandTheme.ts` (Task 1), `AppShell` (Task 3), route (Task 4). `theme` typed `Record<string, unknown>` consistently in `tenant.ts` → `page.tsx` → `MenuView` → `AppShell`. Route response keys (`accent_color`, `theme`, `hero_title`, `tagline`, `logo_text`) match `BrandingCard`'s load + save payload.

**Specificity note:** themed restaurants get vars from the `[data-theme] #menu-page.brand-themed{…}` block; their inline `accentVars` is intentionally NOT applied (inline would beat the mode selector). Accent-only restaurants keep inline `accentVars`. #1 gets neither. This three-way split is the crux — verified in Task 6 Step 4.
