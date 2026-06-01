"use client";

import React from "react";
import Script from "next/script";

interface PublicConfig {
  modelUrl?: string;
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

export default function PublicModelViewer({
  config,
  mvRef,
}: {
  config: PublicConfig;
  mvRef: React.RefObject<any>;
}) {
  if (!config.modelUrl || config.modelUrl === "SUPABASE_GLB_URL_HERE") {
    return (
      <div className="flex items-center justify-center h-full text-center p-8">
        <div>
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-white mb-2">
            Model URL not configured yet.
          </h2>
          <p className="text-white/50">
            Check config.json for valid Supabase Storage URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Script
        type="module"
        src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"
        strategy="afterInteractive"
      />
      {React.createElement(
        "model-viewer" as any,
        {
          ref: mvRef,
          id: "mv",
          src: config.modelUrl,
          ar: true,
          "ar-modes": "webxr scene-viewer quick-look",
          "ar-placement": "floor",
          "camera-controls": true,
          // "none" lets the viewer own BOTH drag axes from the first touch.
          // With "pan-y" the browser kept vertical gestures for page-scroll, so
          // you had to drag horizontally first before vertical orbit responded.
          "touch-action": "none",
          "camera-orbit": "0deg 75deg 2.2m",
          "min-camera-orbit": "auto 20deg auto",
          "max-camera-orbit": "auto 160deg auto",
          "shadow-intensity": "1",
          "environment-image": "neutral",
          exposure: "1.1",
          alt: "3D food model",
          style: { width: "100%", height: "100%" },
        },
        config.tags?.map((tag) => (
          <React.Fragment key={tag.id}>
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

            <button
              className="hotspot hs-tag"
              id={`hs-tag-${tag.id}`}
              slot={`hotspot-tag-${tag.id}`}
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
