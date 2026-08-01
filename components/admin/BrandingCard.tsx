"use client";
/* components/admin/BrandingCard.tsx — one restaurant's LOOK: the light/dark palette
 * (background, card, text, accent) with a live preview, the logo image, and the three
 * pieces of wording the guest menu shows (header wordmark, hero title, greeting).
 *
 * It lived inside app/aevinite/restaurants/page.tsx until 2026-08-01, when the owner moved
 * every setting off the restaurant-detail page onto Access & permissions ("everything will
 * be here on access control tab, not there"). It is a component of its own now so exactly
 * ONE editor owns these values wherever it is mounted — Access renders it inside
 * Main features → Menu → Format & theme → Colours, logo & wording.
 *
 * Writes /api/admin/restaurants/branding (+ /logo for the image); unchanged by the move. */
import { useEffect, useState } from "react";
import { splitBrandSegments, stripBrandMarkers } from "@/lib/brandText";
import { useToast } from "@/components/admin/toast";

type Restaurant = { id: string; slug: string; name: string };

// Render brand text in the live preview: *marked* parts use the accent colour,
// the rest the mode's text colour — exactly how the guest menu renders it.
function previewParts(text: string, textColor: string, accentColor: string) {
  return splitBrandSegments(text).map((seg, i) => (
    <span key={i} style={{ color: seg.hi ? accentColor : textColor }}>{seg.text}</span>
  ));
}
const stripMarkers = (s: string) => stripBrandMarkers(s);

// Per-restaurant brand identity: full theme palette (bg/card/text/accent) per
// light & dark mode, via colour-picker AND hex input, with a live preview, plus
// hero/tagline/logo-text. Writes /api/admin/restaurants/branding.
const PALETTE_FIELDS: { key: "bg" | "card" | "text" | "accent"; label: string }[] = [
  { key: "bg", label: "Background" }, { key: "card", label: "Card / surface" },
  { key: "text", label: "Text" }, { key: "accent", label: "Accent" },
];
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// <input type="color"> only accepts 6-digit hex; expand #abc → #aabbcc so a valid 3-digit
// value doesn't make the swatch snap to black (audit 2026-07-07).
const toColorInput = (v: string) => /^#[0-9a-fA-F]{3}$/.test(v) ? "#" + v.slice(1).split("").map((c) => c + c).join("") : v;

export default function BrandingCard({ restaurant }: { restaurant: Restaurant }) {
  const toast = useToast();
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [theme, setTheme] = useState<{ dark: Record<string, string>; light: Record<string, string> }>({ dark: {}, light: {} });
  const [hero, setHero] = useState(""); const [tagline, setTagline] = useState(""); const [logoText, setLogoText] = useState("");
  const [accent, setAccent] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false); const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  // Guard: only allow Save once the current branding actually LOADED. A failed load
  // left every field blank; saving then wrote those blanks over the real values,
  // wiping the restaurant's whole look (audit 2026-07-08). No successful load = no save.
  const [brandLoaded, setBrandLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // Announces a failure via the shared toast instead of swallowing it — a failed load left
      // the branding fields blank with no explanation (audit 2026-07-07).
      try {
        const r = await fetch(`/api/admin/restaurants/branding?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok && !j.error) {
          const t = j.theme || {};
          setTheme({ dark: { ...(t.dark || {}) }, light: { ...(t.light || {}) } });
          setHero(j.hero_title || ""); setTagline(j.tagline || ""); setLogoText(j.logo_text || ""); setAccent(j.accent_color || ""); setLogoUrl(j.logo_url || null);
          setBrandLoaded(true); // load succeeded → Save is now safe (can't blank a populated restaurant)
        } else {
          toast("Couldn't load branding — " + (j.error || "try reopening."), "err");
        }
      } catch { toast("Couldn't load branding — network error.", "err"); }
    })();
  }, [restaurant.id, toast]);

  // Logo IMAGE upload (separate from the text fields — it streams a file to Storage).
  const uploadLogo = async (file: File) => {
    setLogoBusy(true); setLogoMsg(null);
    try {
      const fd = new FormData(); fd.append("restaurant_id", restaurant.id); fd.append("file", file);
      const r = await fetch("/api/admin/restaurants/logo", { method: "POST", body: fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Upload failed.");
      setLogoUrl(d.logo_url); setLogoMsg("Logo updated — shows on the menu within ~15s.");
    } catch (e) { setLogoMsg(e instanceof Error ? e.message : String(e)); } finally { setLogoBusy(false); }
  };
  const removeLogo = async () => {
    setLogoBusy(true); setLogoMsg(null);
    try {
      const r = await fetch(`/api/admin/restaurants/logo?restaurant_id=${encodeURIComponent(restaurant.id)}`, { method: "DELETE" });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't remove.");
      setLogoUrl(null); setLogoMsg("Logo removed — the menu falls back to the name.");
    } catch (e) { setLogoMsg(e instanceof Error ? e.message : String(e)); } finally { setLogoBusy(false); }
  };

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
    if (!brandLoaded) { setMsg("Branding hasn't loaded yet — reopen this restaurant before saving (so a glitch can't blank it)."); return; }
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

      {/* adm-grid2 collapses to ONE column on phones — the old inline 1fr 1fr never did,
          which crammed ~260px of fixed-width colour controls into a ~155px column at 390px. */}
      <div className="adm-grid2" style={{ gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {PALETTE_FIELDS.map((f) => (
            <div key={f.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ width: 110, flex: "0 0 auto", fontSize: 13 }}>{f.label}</label>
              <input type="color" value={toColorInput((cur[f.key] && HEX_RE.test(cur[f.key])) ? cur[f.key] : pv[f.key])} disabled={busy}
                onChange={(e) => setColor(f.key, e.target.value)} style={{ width: 38, flex: "0 0 auto", height: 30, border: "none", background: "none", cursor: "pointer" }} />
              <input value={cur[f.key] || ""} placeholder={pv[f.key]} disabled={busy} onChange={(e) => setColor(f.key, e.target.value.trim())} style={{ ...inputStyle, width: 110, minWidth: 0, flex: "0 1 110px", fontFamily: "ui-monospace, monospace" }} />
              {cur[f.key] && <button className="adm-btn" disabled={busy} onClick={() => clearColor(f.key)} title="Reset to default" style={{ padding: "4px 8px" }}>↺</button>}
            </div>
          ))}
        </div>
        {/* Live preview swatch — renders the wordmark + hero with *highlight* markers:
            marked parts use the accent, the rest the mode's text colour. */}
        <div style={{ borderRadius: 12, overflow: "hidden", border: "var(--border)" }}>
          <div style={{ background: pv.bg, color: pv.text, padding: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{previewParts(logoText || restaurant.name, pv.text, pv.accent)}</div>
            <div style={{ fontSize: 11, letterSpacing: 2, color: pv.accent }}>{stripMarkers(tagline) || "WELCOME"}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{previewParts(hero || "Our Menu", pv.text, pv.accent)}</div>
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
        <p className="hint" style={{ margin: 0 }}>Tip: wrap a word in <code>*stars*</code> to colour it with your <b>accent</b> — the rest stays white (dark) / black (light). e.g. <code>Little *French* House</code>.</p>
        {/* Logo IMAGE — shown on the opening splash AND beside the search bar. */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 56, height: 56, borderRadius: 10, border: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", overflow: "hidden" }}>
            {logoUrl ? <img src={logoUrl} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <i className="fas fa-image adm-muted" aria-hidden="true" />}
          </div>
          <label className="adm-btn" style={{ cursor: logoBusy ? "default" : "pointer" }}>
            <i className="fas fa-upload" style={{ marginRight: 6 }} aria-hidden="true" />{logoBusy ? "Uploading…" : "Upload logo image"}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={logoBusy} style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
          </label>
          {logoUrl && <button className="adm-btn" disabled={logoBusy} onClick={removeLogo}>Remove logo</button>}
          {logoMsg && <span className="adm-muted" style={{ fontSize: 12 }}>{logoMsg}</span>}
        </div>
        <p className="hint" style={{ margin: 0 }}>PNG / JPG / WEBP, up to 1 MB. Shows on the opening screen and next to the search bar.</p>
        <label style={{ fontSize: 12 }}>Logo text (header + opening screen)<input value={logoText} maxLength={60} placeholder={restaurant.name} disabled={busy} onChange={(e) => setLogoText(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
        <label style={{ fontSize: 12 }}>Hero title<input value={hero} maxLength={120} placeholder="Our Menu" disabled={busy} onChange={(e) => setHero(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
        <label style={{ fontSize: 12 }}>Greeting / tagline<input value={tagline} maxLength={80} placeholder="Welcome" disabled={busy} onChange={(e) => setTagline(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <button className="adm-btn primary" disabled={busy || !brandLoaded} onClick={save}><i className="fas fa-check" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Saving…" : "Save branding"}</button>
        {!brandLoaded && <span className="adm-muted" style={{ fontSize: 12 }}>Couldn&apos;t load current branding — reopen this restaurant before saving.</span>}
        {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
