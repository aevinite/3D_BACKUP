"use client";

import React from "react";
// Next.js's <Script> safely loads an external JavaScript file into the page.
import Script from "next/script";

// The settings this viewer needs: where the 3D model file lives (`modelUrl`)
// and the list of "hotspot" tags to pin onto the model (the little labelled
// callouts pointing at parts of the dish).
//
// WHERE THE TAGS COME FROM: the DISH'S OWN DATABASE ROW — `menu_items.model_tags`, migration 402.
// Until 2026-09-20 they were read out of `public/content/items/<folder>/config.json`, keyed on a
// folder name two restaurants could share; that is why the 3D screen had to stop reading the file
// for every tenant but #1, and why every other restaurant's model spun with no callouts on it at
// all. This component does not care where they came from — it just draws what it is handed — but
// the caller must keep handing it exactly one source. See app/view/[folder]/ViewerClient.tsx.
interface PublicConfig {
  modelUrl?: string;
  // Camera angle + distance the editor saved ("<theta>deg <phi>deg <radius>m").
  // Used as the model's starting framing so it opens on the intended pose.
  frontView?: string;
  tags?: Array<{
    id: string;
    emoji: string;
    name: string;
    b1: string;
    b2: string;
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    tagPosition?: string;
    _tx?: number;
    _ty?: number;
    _tz?: number;
  }>;
}

// Shows an interactive 3D model of a dish that the visitor can spin and zoom
// (and even view in AR on a phone). `mvRef` is a handle the parent uses to talk
// to the viewer directly.
export default function PublicModelViewer({
  config,
  mvRef,
  onScriptError,
  dishName,
}: {
  config: PublicConfig;
  mvRef: React.RefObject<any>;
  // What this dish is CALLED, for the alt text (T1 improvement 4, 2026-08-12). Every dish used to
  // announce itself as the same "3D food model", which tells a screen-reader user nothing about which
  // dish they are looking at. Optional so any other caller keeps today's generic text.
  dishName?: string;
  // Called if the <model-viewer> web-component script can't load (e.g. a network
  // that blocks Google's CDN). Lets the parent show a real "unavailable" message
  // instead of an endless spinner.
  onScriptError?: () => void;
}) {
  // Safety check: if no real model URL was set up yet, say so the way a GUEST needs to hear
  // it. This used to print "Model URL not configured yet. / Check config.json for valid
  // Supabase Storage URL." straight at a diner — an instruction for us, meaningless to them
  // (guest sweep 2026-08-04). Same rule the AR message already follows: no internal detail.
  if (!config.modelUrl || config.modelUrl === "SUPABASE_GLB_URL_HERE") {
    // ── THIS MESSAGE HAD NO STYLING AT ALL, AND THAT IS NOT WHAT IT LOOKED LIKE ────────────────
    // (sweep #9 T2, 2026-09-14 — item 2.)
    //
    // It was laid out with Tailwind utility classes — `flex`, `items-center`, `justify-center`,
    // `h-full`, `text-center`, `p-8`, `text-white`. NONE OF THOSE MATCH A RULE IN THIS PRODUCT:
    // `app/globals.css` is the app's only stylesheet and it never imports Tailwind, so no utility
    // is generated. MEASURED on the running 3D route: a fresh `<div class="flex p-4 text-white">`
    // computes `display:block`, `padding:0px`, `color:rgb(60,42,30)` — so this card was unstyled
    // brown text in the top-left corner, 1.39:1 against the viewer's near-black canvas.
    //
    // Same remedy as the three dead ends in app/view/[folder]/ViewerClient.tsx: the `.try-again-*`
    // card in app/globals.css, which the slow-model overlay on this very screen already wears, so
    // there is one look for "this dish has no 3D" rather than two. Not the fixed full-screen
    // `#try-again-overlay` wrapper though — this message renders in the model's own slot, and a
    // fixed overlay at z-index 5800 would cover BACK and AR, which stay usable here.
    // The `<h2>` is kept (sweep #8's item 10 made these headings on purpose) with the margin an h2
    // brings zeroed inline, the same idiom the dish bar's own title uses.
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24 }}>
        {/* The padding and the two margins below are what `.viewer-wrapper *{margin:0;padding:0}`
            in app/globals.css strips off this card — it is declared later than `.try-again-card`
            at the same specificity, so it wins every tie. Measured: card padding 0px where the
            stylesheet asks for 28px 24px. See the long note at CARD_PAD in
            app/view/[folder]/ViewerClient.tsx. */}
        <div className="try-again-card" style={{ padding: "28px 24px" }}>
          <div className="try-again-emoji" style={{ marginBottom: 12 }}>🍽️</div>
          <h2 className="try-again-title" style={{ margin: "0 0 8px" }}>
            3D view isn&apos;t ready for this dish
          </h2>
          <p className="try-again-sub" style={{ margin: 0 }}>
            You can still see its photo and details on the menu.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Load Google's <model-viewer> web component from their CDN. "afterInteractive"
          means: load it once the page is usable, not blocking the first paint.
          This is what teaches the browser how to render the <model-viewer> tag below.

          `crossOrigin="anonymous"` IS NOT DECORATION — WITHOUT IT THE FILE ARRIVES TWICE
          (sweep #6 T2, 2026-08-17). Next emits a `<link rel="preload" as="script">` beside this
          tag. A `<script type="module">` is always fetched in CORS mode, but a preload with no
          `crossorigin` is not — so the two disagree on credentials mode, the browser refuses to
          reuse the preloaded copy, and downloads the whole thing again. Measured on a Samsung
          A35 profile: two 200s, 253,368 bytes each — roughly a quarter of a megabyte of a
          diner's mobile data spent twice, on the first open of the feature this product is sold
          on, plus Chrome's own two warnings in the console ("the request credentials mode does
          not match" and "preloaded ... but not used"). Saying `anonymous` here makes the preload
          and the script agree, so the preload is used and the file is fetched once. */}
      <Script
        type="module"
        src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onError={() => onScriptError?.()}
      />
      {/* <model-viewer> isn't a normal React tag, so we create it manually with
          React.createElement and pass all its settings as an object. */}
      {React.createElement(
        "model-viewer" as any,
        {
          ref: mvRef,
          id: "mv",
          src: config.modelUrl,        // the 3D model file to display
          ar: true,                    // allow "view in your room" AR
          "ar-modes": "webxr scene-viewer quick-look", // AR methods to try, in order
          "ar-placement": "floor",
          "camera-controls": true,     // let the visitor drag to rotate / pinch to zoom
          // "none" lets the viewer own BOTH drag axes from the first touch.
          // With "pan-y" the browser kept vertical gestures for page-scroll, so
          // you had to drag horizontally first before vertical orbit responded.
          "touch-action": "none",
          // Starting camera angle + distance. If the editor saved a front view,
          // open on exactly that pose; otherwise use the default framing.
          "camera-orbit": config.frontView || "0deg 75deg 2.2m",
          "min-camera-orbit": "auto 20deg auto", // how far down the visitor can tilt
          "max-camera-orbit": "auto 160deg auto", // how far up the visitor can tilt
          "shadow-intensity": "1",      // strength of the model's shadow
          "environment-image": "neutral", // soft, even lighting on the model
          exposure: "1.1",              // overall brightness
          // Named, not generic — see the dishName prop above.
          alt: dishName ? `3D model of ${dishName}` : "3D food model",
          style: { width: "100%", height: "100%" },
        },
        // For each tag in the config, draw two things pinned to the model:
        // an anchor (a thin line out from the surface) and a tag card (the label).
        config.tags?.map((tag) => (
          <React.Fragment key={tag.id}>
            {/* The anchor point on the model's surface, with a connector line */}
            <button
              className="hotspot hs-anchor"
              id={`hs-${tag.id}`}
              slot={`hotspot-${tag.id}`}
              data-position={`${tag.x} ${tag.y} ${tag.z}`}
              data-normal={`${tag.nx} ${tag.ny} ${tag.nz}`}
              data-visibility-attribute="visible"
              style={{
                width: "0",
                height: "0",
                padding: "0",
                margin: "0",
                border: "none",
                background: "none",
                position: "relative",
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
              {/* The little leader line drawn from the anchor toward the label */}
              <svg
                className="hs-line-svg"
                style={{
                  position: "absolute",
                  left: "0",
                  top: "0",
                  width: "1px",
                  height: "1px",
                  overflow: "visible",
                  pointerEvents: "none",
                }}
              >
                <line
                  id={`hs-line-${tag.id}`}
                  x1="0"
                  y1="0"
                  x2="80"
                  y2="-80"
                  stroke="rgba(255,255,255,0.50)"
                  strokeWidth="0.9"
                  strokeLinecap="round"
                  className="hs-line-el"
                />
              </svg>
            </button>

            {/* The label card that floats near the anchor */}
            <button
              className="hotspot hs-tag"
              id={`hs-tag-${tag.id}`}
              slot={`hotspot-tag-${tag.id}`}
              // Where to place the card in 3D space. We prefer a saved precise
              // spot (_tx/_ty/_tz), then a saved tagPosition string, and finally
              // fall back to just offsetting from the anchor a little.
              data-position={
                (() => {
                  // ── A POSITION IS THREE REAL NUMBERS, OR IT IS NOT A POSITION ───────────────
                  // (owner's item 6, 2026-09-14.)
                  //
                  // This used to test `tag._tx` alone and then print all three, so a callout with a
                  // precise x and no y or z came out as `data-position="0.5 undefined undefined"`.
                  // The first attempt at this fix only tightened THAT test — and pushed the same
                  // fault into the last fallback, where `tag.x` is undefined too: measured, it
                  // produced `"NaN NaN undefined"`. Caught by driving it, not by reading it.
                  //
                  // So every source is checked the same way: three finite numbers or move on, and
                  // `0 0 0` if nothing qualifies — a real point on the model, never a word.
                  // `Number.isFinite` and not `|| 0`, because a saved **0** is a real coordinate
                  // and the old `p[0] || 0` threw it away along with the blanks.
                  //
                  // Nothing in this repository writes `_tx/_ty/_tz`, and both config files that
                  // exist fill `tagPosition` properly — so no data this product can produce reaches
                  // any of this today. It is the belt, put on before something starts writing them.
                  const triple = (a?: unknown, b?: unknown, c?: unknown) =>
                    [a, b, c].every((v) => Number.isFinite(Number(v)) && v !== null && v !== "")
                      ? `${Number(a)} ${Number(b)} ${Number(c)}`
                      : null;
                  const fromPrecise = triple(tag._tx, tag._ty, tag._tz);
                  if (fromPrecise) return fromPrecise;
                  if (tag.tagPosition) {
                    // Per-part here, not all-or-nothing: a saved string is a list of coordinates
                    // and a missing tail genuinely means 0, so "0.4" is x=0.4 — the one number
                    // they gave is kept. (A half-filled `_tx` triple above is different: that is
                    // one precise point, and half of one point means nothing.)
                    const p = tag.tagPosition.trim().split(/\s+/);
                    const n = (i: number) => (Number.isFinite(Number(p[i])) && p[i] !== undefined && p[i] !== "" ? Number(p[i]) : 0);
                    return `${n(0)} ${n(1)} ${n(2)}`;
                  }
                  const fromAnchor = triple(Number(tag.x) + 0.5, Number(tag.y) + 0.5, tag.z);
                  return fromAnchor ?? "0 0 0";
                })()
              }
              data-visibility-attribute="visible"
              style={{
                width: "0",
                height: "0",
                padding: "0",
                margin: "0",
                border: "none",
                background: "none",
                position: "relative",
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
              <div
                className="hs-card-wrap"
                id={`hs-card-${tag.id}`}
                style={{
                  position: "absolute",
                  left: "0px",
                  top: "0px",
                  pointerEvents: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {/* The label's title, then a card with an emoji icon and two
                    bullet points of info (b1 / b2) about this part of the dish */}
                <div className="hs-title">{tag.name}</div>
                <div className="hs-card">
                  <div className="hs-icon">{tag.emoji}</div>
                  {/* A BULLET ONLY WHERE THERE ARE WORDS (owner's item 6, 2026-09-14). Both lines
                      were drawn unconditionally, so a callout with only one line of text still got
                      a second `<li>` — and `.viewer-wrapper .hs-bullets li::before` in
                      app/globals.css paints a 4px green dot on it. Measured by serving a tag with
                      an empty `b2`: an 4px-tall empty row with a dot pointing at nothing. Neither
                      config that exists has an empty line, and nothing in this repository writes a
                      config, so no data reaches this today either. */}
                  <ul className="hs-bullets">
                    {[tag.b1, tag.b2].filter((line) => String(line ?? "").trim() !== "").map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </button>
          </React.Fragment>
        ))
      )}
    </>
  );
}
