"use client";

import { useEffect, useState } from "react";
import Header from "./Header";
import ChefCallButton from "./ChefCallButton";
import ChefPopup from "./ChefPopup";
import Particles from "./Particles";
import IntroSplash from "./IntroSplash";
import Maintenance from "./Maintenance";
import { getSettings } from "@/lib/menu";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { supabase } from "@/lib/supabase";
import { sanitizeBrandTheme, buildModeBlock } from "@/lib/brandTheme";

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
    "--brand-highlight": accentColor, // brand name in the header follows the restaurant
  };
  if (rgb) {
    base["--accent-dim"] = `rgba(${rgb}, 0.6)`;
    base["--accent-glow"] = `rgba(${rgb}, 0.34)`;
    base["--gold-glow"] = `rgba(${rgb}, 0.42)`;
    // Per-restaurant ATMOSPHERE: a soft brand-coloured glow at the top + a faint
    // brand wash over the whole menu, so each restaurant feels distinctly its own
    // (not just a different accent). Subtle enough that cards/text stay readable.
    // Only NON-#1 restaurants pass accentColor, so the live French House (#1) is
    // never washed — it keeps its exact warm theme.
    base["background"] = `radial-gradient(1200px 620px at 50% -240px, rgba(${rgb}, 0.16), transparent 68%), color-mix(in srgb, ${accentColor} 6%, var(--bg))`;
  }
  return base as React.CSSProperties;
}

// The outer "frame" wrapped around every page: it shows the intro animation,
// the background bubbles, the header, the chef-call button, and finally the
// actual page content (`children`). It also listens for site-wide settings the
// staff control from the editor, so the guest's screen updates live.
export default function AppShell({ children, logoText, accentColor, restaurantId, theme, logoUrl }: { children: React.ReactNode; logoText?: string; accentColor?: string; restaurantId?: string; theme?: Record<string, unknown>; logoUrl?: string }) {
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
      getSettings(restaurantId)
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
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const subscribe = () => {
      if (channel) return; // already connected
      // Per-restaurant channel + filter: each tenant has its OWN settings row
      // (settings.restaurant_id), so a guest at restaurant B must watch B's row, not
      // #1's "site" row. Keying the channel name per restaurant also keeps the realtime
      // topics tenant-scoped (the SaaS rule). Falls back to the #1 default if no rid.
      const rid = restaurantId || DEFAULT_RESTAURANT_ID;
      channel = supabase
        .channel("settings-" + rid)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "settings", filter: "restaurant_id=eq." + rid },
          () => refresh()
        )
        .subscribe();
    };
    subscribe();

    // IDLE-DISCONNECT (owner 2026-06-26 — protect the realtime connection budget): a tab
    // left HIDDEN for IDLE_MS DROPS this channel so it stops holding a websocket connection
    // (the "stale 41 connections" problem). It re-subscribes + refetches the instant the tab
    // is shown again, and the fallback poll below pauses while hidden. Mirrors lib/useRealtime.ts.
    const IDLE_MS = 120000;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const teardown = () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(teardown, IDLE_MS); // arm the idle drop
      } else {
        clearTimeout(idleTimer);
        if (!channel) { subscribe(); refresh(); } // reconnect after idle + refetch so we're not stale
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Fallback poll in case the realtime socket can't connect (captive wifi,
    // blocked websockets). Slow on purpose — realtime does the fast path.
    // This just re-checks every 15 seconds as a safety net — PAUSED while hidden
    // so a backgrounded tab does zero work.
    const iv = setInterval(() => { if (!document.hidden) refresh(); }, 15000);

    // Cleanup: stop the timer and the live subscription when AppShell unmounts.
    return () => {
      active = false;
      clearInterval(iv);
      clearTimeout(idleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      teardown();
    };
  }, [restaurantId]);

  // Service mode replaces the whole menu with the maintenance screen.
  if (serviceMode) return <Maintenance />;

  // Per-restaurant FULL palette (Phase 2). When a restaurant has theme overrides, we
  // emit mode-scoped CSS (inline styles can't switch on the [data-theme] toggle). The
  // block targets #app.brand-themed so the vars cascade to EVERYTHING in the guest app
  // — menu, header, the floating chef-call button and its popup (which sit OUTSIDE
  // #menu-page) — never affecting #1 or other pages. Accent falls back to accentColor
  // per mode. Restaurants with only accentColor (no theme) keep the inline accentVars
  // path below — unchanged.
  const bt = theme ? sanitizeBrandTheme(theme) : {};
  const darkBody = bt.dark ? buildModeBlock("dark", bt.dark, accentColor) : "";
  const lightBody = bt.light ? buildModeBlock("light", bt.light, accentColor) : "";
  const themed = !!(darkBody || lightBody);
  const themedCss = themed
    ? `${darkBody ? `[data-theme="dark"] #app.brand-themed{${darkBody}}` : ""}` +
      `${lightBody ? `[data-theme="light"] #app.brand-themed{${lightBody}}` : ""}`
    : "";

  return (
    <>
      {/* Per-restaurant theme (mode-scoped) — only when this restaurant set a palette. */}
      {themed && <style dangerouslySetInnerHTML={{ __html: themedCss }} />}
      {/* The one-time opening logo animation */}
      <IntroSplash wordmark={logoText} accentColor={accentColor} logoUrl={logoUrl} scopeKey={restaurantId} />
      {/* Floating background bubbles — only if the toggle is on */}
      {bubbles && <Particles />}
      <div id="app" className={themed ? "brand-themed" : undefined}>
        <div id="menu-page" className="page active" style={!themed && accentColor ? accentVars(accentColor) : undefined}>
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
