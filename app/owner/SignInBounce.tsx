"use client";
// SIGN IN, THEN COME BACK TO THIS PAGE (sweep #10 T17 round 6, item 37 — owner 2026-10-09: "do all 4").
//
// A server layout cannot know which owner page was asked for (Next.js gives layouts no pathname), so the owner layout
// used to send every signed-out visitor to /login?next=/owner — an owner's bookmark to Reports always landed on the
// home page after signing in. This tiny step runs in the browser, where the address IS known, and goes to the sign-in
// card carrying it. The card (app/login/LoginForm.tsx → landingFor) only honours a ?next on this site AND inside the
// person's own panel, so nothing here can send anyone anywhere else. Without JavaScript the <noscript> refresh still
// reaches the sign-in card (landing on the owner home, as before).
import { useEffect } from "react";

export default function SignInBounce() {
  useEffect(() => {
    const here = window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(`/login?next=${encodeURIComponent(here)}`);
  }, []);
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#8aa0c9", fontFamily: "system-ui, sans-serif", fontSize: 14, padding: 16, boxSizing: "border-box" }}>
      <noscript>
        <meta httpEquiv="refresh" content="0;url=/login?next=%2Fowner" />
      </noscript>
      <p style={{ margin: 0 }}>
        Opening sign-in… <a href="/login?next=%2Fowner" style={{ color: "#8aa0c9" }}>Sign in</a>
      </p>
    </main>
  );
}
