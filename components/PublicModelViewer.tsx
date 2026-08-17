"use client";

import React from "react";
// Next.js's <Script> safely loads an external JavaScript file into the page.
import Script from "next/script";

// The settings this viewer needs: where the 3D model file lives (`modelUrl`)
// and the list of "hotspot" tags to pin onto the model (the little labelled
// callouts pointing at parts of the dish).
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
    return (
      <div className="flex items-center justify-center h-full text-center p-8">
        <div>
          <div className="text-4xl mb-4">🍽️</div>
          <h2 className="text-xl font-bold text-white mb-2">
            3D view isn&apos;t ready for this dish
          </h2>
          <p className="text-white/50">
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
                  if (tag._tx !== undefined) {
                    return `${tag._tx} ${tag._ty} ${tag._tz}`;
                  }
                  if (tag.tagPosition) {
                    const p = tag.tagPosition.split(" ").map(Number);
                    return `${p[0] || 0} ${p[1] || 0} ${p[2] || 0}`;
                  }
                  return `${tag.x + 0.5} ${tag.y + 0.5} ${tag.z}`;
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
                  <ul className="hs-bullets">
                    <li>{tag.b1}</li>
                    <li>{tag.b2}</li>
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
