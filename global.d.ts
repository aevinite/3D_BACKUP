import type * as React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }

  interface ModelViewerElement extends HTMLElement {
    canActivateAR?: boolean;
    activateAR?: () => void;
    cameraOrbit?: string;
    cameraTarget?: string;
    orientation?: string;
    scale?: string;
    autoplay?: boolean;
    environmentImage?: string;
    exposure?: number;
    shadowIntensity?: number;
    cameraControls?: boolean;
    "min-camera-orbit"?: string;
    "max-camera-orbit"?: string;
    ar?: boolean;
    "ar-modes"?: string;
    "ar-placement"?: string;
    src?: string;
  }
}

