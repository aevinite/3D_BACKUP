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

// The outer "frame" wrapped around every page: it shows the intro animation,
// the background bubbles, the header, the chef-call button, and finally the
// actual page content (`children`). It also listens for site-wide settings the
// staff control from the editor, so the guest's screen updates live.
export default function AppShell({ children }: { children: React.ReactNode }) {
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
        <div id="menu-page" className="page active">
          {/* The top bar (logo, language/currency, theme toggle, cart) */}
          <Header />
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
