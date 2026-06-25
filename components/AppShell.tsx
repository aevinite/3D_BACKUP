"use client";

import { useEffect, useState } from "react";
import Header from "./Header";
import ChefCallButton from "./ChefCallButton";
import ChefPopup from "./ChefPopup";
import Particles from "./Particles";
import IntroSplash from "./IntroSplash";
import Maintenance from "./Maintenance";
import { getSettings } from "@/lib/menu";
import { supabase } from "@/lib/supabase";

// Turn a brand hex (e.g. "#c0392b") into "r, g, b" so we can build rgba() glows
// at any opacity. Accepts #rgb or #rrggbb; returns null for anything we can't
// parse so the caller can fall back to leaving the gold defaults alone.
function hexToRgbTriplet(hex: string): string | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Build the FULL accent palette from ONE brand colour, so the gradient pills,
// glows and dim tints all follow the restaurant — not just the flat --accent.
// CLAUDE.md gotcha note: this only ever runs for NON-default restaurants (the
// caller passes accentColor only when it's not the French House default), so
// restaurant #1 keeps its hand-tuned gold variables untouched.
//   - --accent / --gold : the brand colour itself.
//   - --accent-grad     : a 135deg gradient from the brand colour to a slightly
//                         darker shade (color-mix with black — no hex math, and
//                         it's already used elsewhere in this codebase).
//   - --accent-dim/-glow / --gold-glow : rgba() of the brand colour at the same
//                         opacities the gold defaults used (0.6 / 0.34 / 0.42).
function accentVars(accentColor: string): React.CSSProperties {
  const rgb = hexToRgbTriplet(accentColor);
  const grad = `linear-gradient(135deg, ${accentColor} 0%, color-mix(in srgb, ${accentColor} 82%, #000) 100%)`;
  const base: Record<string, string> = {
    "--accent": accentColor,
    "--gold": accentColor,
    "--accent-grad": grad,
    "--gold-grad": grad,
  };
  if (rgb) {
    base["--accent-dim"] = `rgba(${rgb}, 0.6)`;
    base["--accent-glow"] = `rgba(${rgb}, 0.34)`;
    base["--gold-glow"] = `rgba(${rgb}, 0.42)`;
  }
  return base as React.CSSProperties;
}

// The outer "frame" wrapped around every page: it shows the intro animation,
// the background bubbles, the header, the chef-call button, and finally the
// actual page content (`children`). It also listens for site-wide settings the
// staff control from the editor, so the guest's screen updates live.
export default function AppShell({ children, logoText, accentColor }: { children: React.ReactNode; logoText?: string; accentColor?: string }) {
  // General-tab toggles: bubble effect on/off, and service (maintenance) mode.
  // These are pieces of remembered state — when they change, the screen redraws.
  const [bubbles, setBubbles] = useState(true);
  const [serviceMode, setServiceMode] = useState(false);
  // Runs once when the app first loads. Sets up fetching + live updates of
  // those two settings, and tidies everything up when the app closes.
  useEffect(() => {
    // A guard so we don't try to update the screen after it's gone away.
    let active = true;
    // Go ask the database for the current settings and copy them into state.
    const refresh = () =>
      getSettings()
        .then((s) => {
          if (!active) return;
          setBubbles(s.bubblesEnabled);
          setServiceMode(s.serviceMode);
        })
        .catch(() => {});
    // Fetch them right away on first load.
    refresh();

    // Realtime push: when the editor flips maintenance/bubbles, an already-open
    // guest tab reacts in ~1s — no manual refresh. (settings allows anon SELECT,
    // so the anon client receives these change events.)
    // In plain terms: we "subscribe" to the settings row and re-fetch whenever
    // it changes, so the guest sees the toggle flip almost instantly.
    const channel = supabase
      .channel("settings-site")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settings", filter: "id=eq.site" },
        () => refresh()
      )
      .subscribe();

    // Fallback poll in case the realtime socket can't connect (captive wifi,
    // blocked websockets). Slow on purpose — realtime does the fast path.
    // This just re-checks every 15 seconds as a safety net.
    const iv = setInterval(refresh, 15000);

    // Cleanup: stop the timer and the live subscription when AppShell unmounts.
    return () => {
      active = false;
      clearInterval(iv);
      supabase.removeChannel(channel);
    };
  }, []);

  // Service mode replaces the whole menu with the maintenance screen.
  if (serviceMode) return <Maintenance />;

  return (
    <>
      {/* The one-time opening logo animation */}
      <IntroSplash />
      {/* Floating background bubbles — only if the toggle is on */}
      {bubbles && <Particles />}
      <div id="app">
        <div id="menu-page" className="page active" style={accentColor ? accentVars(accentColor) : undefined}>
          {/* The top bar (logo, language/currency, theme toggle, cart) */}
          <Header logoText={logoText} />
          {/* Whatever page is currently being shown goes here */}
          {children}
        </div>
        {/* The floating "call the chef/waiter" button and its popup */}
        <ChefCallButton />
        <ChefPopup />
      </div>
    </>
  );
}
