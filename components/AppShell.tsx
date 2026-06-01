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

export default function AppShell({ children }: { children: React.ReactNode }) {
  // General-tab toggles: bubble effect on/off, and service (maintenance) mode.
  const [bubbles, setBubbles] = useState(true);
  const [serviceMode, setServiceMode] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      getSettings()
        .then((s) => {
          if (!active) return;
          setBubbles(s.bubblesEnabled);
          setServiceMode(s.serviceMode);
        })
        .catch(() => {});
    refresh();

    // Realtime push: when the editor flips maintenance/bubbles, an already-open
    // guest tab reacts in ~1s — no manual refresh. (settings allows anon SELECT,
    // so the anon client receives these change events.)
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
    const iv = setInterval(refresh, 15000);

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
      <IntroSplash />
      {bubbles && <Particles />}
      <div id="app">
        <div id="menu-page" className="page active">
          <Header />
          {children}
        </div>
        <ChefCallButton />
        <ChefPopup />
      </div>
    </>
  );
}
