"use client";

import { useEffect, useState } from "react";

// The gentle floating "bubbles" that drift up the background of the menu.
// (AppShell only shows this when the bubbles toggle is on in the editor.)
export default function Particles() {
  // Holds the list of bubbles. Each one remembers where it sits across the
  // screen (left) and how long to wait before it starts rising (delay).
  const [particles, setParticles] = useState<{ left: string; delay: string }[]>([]);

  // Runs once when the component first appears on screen.
  // We build the bubbles here (not at the top of the file) because they use
  // random numbers — doing it on the screen avoids a server/browser mismatch.
  useEffect(() => {
    // Make 20 bubbles, each given a random horizontal spot (0–100% across)
    // and a random head-start delay (0–6 seconds) so they don't move in sync.
    const newParticles = Array.from({ length: 20 }).map(() => ({
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 6}s`,
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="particles" id="particles">
      {/* Draw one floating dot for every bubble in our list. The CSS class
          "particle" handles the actual rising animation; we just place each
          one and stagger its start time. */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="particle"
          style={{ left: p.left, animationDelay: p.delay }}
        />
      ))}
    </div>
  );
}
