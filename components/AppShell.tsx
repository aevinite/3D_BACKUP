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
import { sanitizeBrandTheme, buildModeBlock, buildCanvasBlock } from "@/lib/brandTheme";
import { accentPaletteCss, accentBackground, accentCanvasCss } from "@/lib/accent";

// The accent palette now lives in lib/accent.ts so the 3D viewer (a separate
// route outside this shell) can emit the SAME variables. See that file for the
// colour maths. This only ever runs for NON-default restaurants (the caller
// passes accentColor only when it's not the French House default), so #1 keeps
// its hand-tuned gold from globals.css untouched.

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
      // WATCH THE BREADCRUMB, NOT THE SETTINGS ROW (mig 282). This used to subscribe to the
      // `settings` table itself, which is the ONLY reason the public key still needed a
      // table-wide read on it — and that read is what handed every guest every restaurant's
      // gstin and panel config. `rt_emit_settings` already writes a `menu`-topic breadcrumb for
      // exactly this change (the guest menu's own useRealtime has always used it), so the same
      // event arrives with nothing sensitive on the wire.
      //
      // `topic_rid` (mig 145) is the combined "<topic>:<restaurant_id>", so the filter is applied
      // SERVER-side and this tab is never handed another restaurant's events. Everything else
      // here — refresh(), the idle drop, the fallback poll — is unchanged.
      channel = supabase
        .channel("settings-" + rid)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic_rid=eq.menu:" + rid },
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
    // This just re-checks every 60 seconds as a safety net — PAUSED while hidden so a
    // backgrounded tab does zero work. (Was 15s, below the project's 60s backstop rule;
    // realtime already handles the fast settings/menu updates, so 60s trims steady-state
    // guest egress with no visible delay — audit fix 2026-07-08.)
    const iv = setInterval(() => { if (!document.hidden) refresh(); }, 60000);

    // Cleanup: stop the timer and the live subscription when AppShell unmounts.
    return () => {
      active = false;
      clearInterval(iv);
      clearTimeout(idleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      teardown();
    };
  }, [restaurantId]);

  // REMEMBER WHOSE MENU THIS IS, for the one screen that cannot ask.
  //
  // public/offline.html is the branded page a phone lands on with no connection and nothing
  // saved. It was completely anonymous — our wording on our dark card, no clue whose restaurant
  // it belonged to — because it is a static file that cannot fetch anything, by definition.
  //
  // The name is right here, though, on every guest page. So store it, and that page reads it with
  // no request and no data use at all. Kept deliberately dumb: ONE key, the CURRENT restaurant,
  // written only on a guest page (this component only ever wraps those). The offline page prints
  // it ONLY when the stored slug matches the slug its own path resolves to, so it can never show
  // restaurant A's name on restaurant B's screen. (owner said yes, 2026-08-26.)
  useEffect(() => {
    // The slug the way the offline page derives it: from /r/<slug>/…, else the tab's pin, else ""
    // for the legacy restaurant-#1 paths (/menu, /item) — the same rule as lib/tenantStorage.
    const name = (logoText || "").trim();
    if (!name) return;
    try {
      const p = location.pathname;
      let slug = (p.match(/^\/r\/([^/]+)\//) || [])[1]?.toLowerCase() || "";
      if (!slug && !/^\/(menu|item)(\/|$)/.test(p)) slug = (sessionStorage.getItem("lfh_tab_tenant") || "").toLowerCase();
      if (slug && !/^[a-z0-9-]+$/.test(slug)) return;
      localStorage.setItem("lfh_brand", JSON.stringify({ slug, name }));
    } catch {
      /* a device that refuses storage simply gets the anonymous card — never a crash. The
         guest menu going down over a nicety would be far worse than the nicety. */
    }
  }, [logoText]);

  // Per-restaurant FULL palette (Phase 2). When a restaurant has theme overrides, we
  // emit mode-scoped CSS (inline styles can't switch on the [data-theme] toggle). The
  // block targets #app.brand-themed so the vars cascade to EVERYTHING in the guest app
  // — menu, header, the floating chef-call button and its popup (which sit OUTSIDE
  // #menu-page) — never affecting #1 or other pages. Accent falls back to accentColor
  // per mode. Restaurants with only accentColor (no theme) keep the inline accentVars
  // path below — unchanged.
  //
  // ONE EXCEPTION, added 2026-08-05: the two vars the PAGE CANVAS is painted from (--bg, --text)
  // are ALSO emitted at the document root, because `html, body { background: var(--bg) }` sits
  // above #app in the tree and could never see the scoped block — so a themed restaurant's hero
  // band, grid margins and the area below the last dish stayed restaurant #1's brown. Same
  // reasoning as rootAccentCss below. See lib/brandTheme.ts → buildCanvasBlock.
  const bt = theme ? sanitizeBrandTheme(theme) : {};
  const darkBody = bt.dark ? buildModeBlock("dark", bt.dark, accentColor) : "";
  const lightBody = bt.light ? buildModeBlock("light", bt.light, accentColor) : "";
  const darkCanvas = bt.dark ? buildCanvasBlock(bt.dark) : "";
  const lightCanvas = bt.light ? buildCanvasBlock(bt.light) : "";
  const themed = !!(darkBody || lightBody);
  // THE PALETTE HAS TO REACH THE THINGS THAT ARE NOT INSIDE #app (guest sweep T1, 2026-08-12).
  //
  // The cart, the bill sheet, the toasts and the session widgets are GuestChrome, mounted at BODY
  // level in app/layout.tsx — siblings of #app, not children. So the `#app.brand-themed` block below
  // could never reach them, and they fell back to whatever `:root` said, i.e. the restaurant's
  // accent_color. On a restaurant whose theme accent differs from its accent_color that is a
  // different colour: measured on Aangan, the menu was blue and the bill sheet orange.
  //
  // So the same block is ALSO emitted at `html[data-theme=…]`, exactly as the canvas vars already
  // are (see the 2026-08-05 note above — same reasoning, one step further). Two things make this
  // safe rather than a leak: this <style> is rendered ONLY by AppShell, which only wraps the guest
  // pages, and one page only ever shows one restaurant. `html[data-theme="dark"]` also outranks the
  // `:root` accentPaletteCss block above it (type+attribute beats a lone pseudo-class), so a
  // restaurant that sets a real theme wins over its own accent_color instead of fighting it.
  // The #app block is KEPT and still comes last: it is the most specific, so nothing inside the app
  // changes, and #1 and the staff panels are untouched either way.
  const themedCss = themed
    ? `${darkCanvas ? `html[data-theme="dark"]{${darkCanvas}}` : ""}` +
      `${lightCanvas ? `html[data-theme="light"]{${lightCanvas}}` : ""}` +
      `${darkBody ? `html[data-theme="dark"]{${darkBody}}` : ""}` +
      `${lightBody ? `html[data-theme="light"]{${lightBody}}` : ""}` +
      `${darkBody ? `[data-theme="dark"] #app.brand-themed{${darkBody}}` : ""}` +
      `${lightBody ? `[data-theme="light"] #app.brand-themed{${lightBody}}` : ""}`
    : "";

  // WHITE-LABEL COLOUR (audit fix 2026-07-07, bug #1): emit the restaurant's
  // accent palette at :root so it reaches EVERYTHING — not only the menu body,
  // but the floating waiter button + popup (siblings of #menu-page) AND the
  // body-level GuestChrome widgets (cart, toasts, session) mounted in layout.tsx,
  // which previously fell back to French House gold. A :root rule applies
  // document-wide no matter where this <style> sits. Only non-#1 restaurants pass
  // accentColor, so #1's gold is never overridden. The menu-page background wash
  // stays a page backdrop (below), not a :root variable.
  // The accent FAMILY at :root, plus the PAGE ITSELF (bg/card/text/muted/border) derived from the
  // same accent — because a tenant with only an accent was still sitting on restaurant #1's brown
  // canvas (guest sweep T1, 2026-08-06; see lib/accent.ts → accentCanvasCss). The canvas block is
  // emitted FIRST so a tenant that has set a real `theme` still overrides it below.
  const rootAccentCss = accentColor
    ? `${accentCanvasCss(accentColor)}:root{${accentPaletteCss(accentColor)}}`
    : "";
  const pageBg = accentColor ? accentBackground(accentColor) : null;

  // Service mode replaces the whole menu with the maintenance screen. Pass THIS
  // restaurant's branding so a non-#1 tenant's maintenance screen shows its own
  // name/logo, never French House's (white-label; audit fix 2026-07-06).
  //
  // THIS RETURN USED TO SIT ABOVE THE PALETTE, and that was half the colour bug (T4, 2026-08-17).
  // `rootAccentCss` and the themed block are computed below the old position, so bailing out here
  // meant the maintenance screen rendered with NO tenant palette emitted at all — `--accent` fell
  // back to whatever globals.css `:root` says, which is restaurant #1's. Even after the `.maint*`
  // rules were taught to follow `--accent`, the variable would still have been #1's on the one
  // screen that needed it most. So the styles are emitted alongside the maintenance screen too;
  // it is the same two <style> tags, just no longer skipped.
  if (serviceMode) {
    const isDefault = (restaurantId || DEFAULT_RESTAURANT_ID) === DEFAULT_RESTAURANT_ID;
    return (
      <>
        {rootAccentCss && <style dangerouslySetInnerHTML={{ __html: rootAccentCss }} />}
        {themed && <style dangerouslySetInnerHTML={{ __html: themedCss }} />}
        <Maintenance logoText={logoText} logoUrl={logoUrl} isDefault={isDefault} />
      </>
    );
  }

  return (
    <>
      {/* Restaurant colour for the WHOLE document (widgets included). */}
      {rootAccentCss && <style dangerouslySetInnerHTML={{ __html: rootAccentCss }} />}
      {/* Per-restaurant theme (mode-scoped) — only when this restaurant set a palette. */}
      {themed && <style dangerouslySetInnerHTML={{ __html: themedCss }} />}
      {/* The one-time opening logo animation */}
      <IntroSplash wordmark={logoText} accentColor={accentColor} logoUrl={logoUrl} scopeKey={restaurantId} />
      {/* Floating background bubbles — only if the toggle is on */}
      {bubbles && <Particles />}
      <div id="app" className={themed ? "brand-themed" : undefined}>
        <div id="menu-page" className="page active" style={!themed && pageBg ? { background: pageBg } : undefined}>
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
