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
    // Where the camera is RIGHT NOW (radians + metres), as opposed to `cameraOrbit`, which is
    // only the last value anybody wrote. The AR handoff needs the live one: the guest has
    // usually spun and zoomed the dish before tapping AR VIEW, and that is the framing we have
    // to put back afterwards. Optional because it only exists once the element has upgraded.
    getCameraOrbit?: () => { theta: number; phi: number; radius: number };
    // model-viewer is a Lit element: writing `scale` SCHEDULES the transform rather than
    // applying it. Awaiting this is the difference between Quick Look exporting the new size
    // and the old one.
    updateComplete?: Promise<boolean>;
    // model-viewer's own camera smoothing. Turned off while an animation owns the motion, then
    // restored — the reveal cinematic does the same dance.
    interpolationDecay?: number;
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

