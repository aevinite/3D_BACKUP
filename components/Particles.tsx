"use client";

import { useEffect, useState } from "react";

export default function Particles() {
  const [particles, setParticles] = useState<{ left: string; delay: string }[]>([]);

  useEffect(() => {
    const newParticles = Array.from({ length: 20 }).map(() => ({
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 6}s`,
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="particles" id="particles">
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
