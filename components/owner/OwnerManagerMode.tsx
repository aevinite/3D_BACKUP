"use client";

import { useEffect, useRef, useState } from "react";
import { attachSafeAreaBridge } from "@/lib/safeAreaBridge";
import { useBackClose } from "@/lib/backStack";
import { useOwnerSkin, pushSkinTo } from "./useOwnerSkin";
import { portfolioColor } from "@/lib/restaurantColor";

// Owner panel → Manager mode (owner, 2026-08-02). Hosts the SAME live manager panel
// (public/panels/editor, ?ownermode=1) inside the owner cockpit. One engine per
// restaurant — identical floor/bills/ordering + realtime, so it stays in step with the
// manager/kitchen/tablet panels with zero extra plumbing. The panel itself hides
// Settings / Ratings / Audit / the Menu tab (the owner panel already has those).
//
// TWO SCREENS (owner, 2026-08-02: "there should be first screen to select the
// restaurant, and you can launch the manager mode"):
//   • >1 restaurant and none picked → a LAUNCHER of restaurant cards; tapping one
//     opens its floor. Hardware BACK inside the floor returns here (useBackClose), and
//     the cockpit bar's own "Switch restaurant" dropdown re-scopes the floor in place —
//     this page had a second switch bar of its own until 2026-08-15, when it was deleted
//     for being 47px of duplicate chrome on a screen the owner said was already too full.
//   • 1 restaurant (or a ?rid deep link / admin act-as) → straight into the floor,
//     no ceremony.
//
// SKIN REPLICATION (owner, 2026-08-02: "it will replicate the mode you are in owner"):
// the shell broadcasts `lfh:owner-skin` on every toggle; we forward it into the
// running iframe as a postMessage so the floor flips light/dark the same instant the
// cockpit does — no reload, no refetch. On iframe load we push the current skin once,
// so even a stale ?skin= param in the URL can never leave the panel on the wrong mode.
export default function OwnerManagerMode({
  restaurants,
  initial,
  skin: initialSkin,
}: {
  // NO `accentColor` (T17 sweep, 2026-09-04): the dot below is keyed by ID through
  // lib/restaurantColor, so this screen needs nothing from the restaurants table but an id and a
  // name. app/owner/manager/page.tsx stopped reading `accent_color` in the same commit.
  restaurants: { id: string; name: string }[];
  initial: string;
  skin: "light" | "dark";
}) {
  const [rid, setRid] = useState<string | null>(initial || null);
  // Follow the cockpit's skin (shared with the Menu + Inventory embeds — one hook, so the
  // three can't drift apart again). The frame is told by message; its ?skin= is only ever
  // the value it was born with.
  const skin = useOwnerSkin(initialSkin);
  const frame = useRef<HTMLIFrameElement>(null);
  const skinRef = useRef(skin);
  skinRef.current = skin;
  const many = restaurants.length > 1;

  const pushSkin = (s: "light" | "dark") => pushSkinTo(frame.current, s);
  useEffect(() => { pushSkin(skin); }, [skin]);

  // Hardware BACK inside the floor peels back to the launcher (multi-restaurant only) —
  // project rule: every screen is a back step, never a whole-site exit.
  useBackClose("owner-mmode-panel", !!rid && many, () => setRid(null));

  // Tell the cockpit bar WHICH restaurant is on the floor, the same way the dashboard and
  // reports do it (lfh:owner-crumb). Without this the top pill kept saying the restaurant you
  // ARRIVED as, even after the switcher had swapped the floor underneath it — the name on
  // screen and the floor on screen disagreed. An empty tail on the launcher / on unmount.
  // ── AND IT HAS TO STILL BE LISTENING WHEN WE SHOUT (T12 sweep, 2026-08-18) ───────────────────
  // On a HARD load of /owner/manager the pill was blank anyway. React runs child effects BEFORE
  // parent effects, so this component broadcast before OwnerShell had attached its `lfh:owner-crumb`
  // listener, and the tail was shouted into an empty room. Measured: the crumb read "Owner › Manager
  // mode" with the floor iframe already on screen. The dashboard and the reports hub only escape
  // this by accident — their emitters re-run when their data lands, which is after the shell is up.
  //   So emit once now (for the ordinary in-app navigation, where the shell is already mounted and
  // listening) and once more on the next frame, which is after the parent's effects have run. The
  // second emit is identical, so a listener that heard the first just sets the same value again.
  useEffect(() => {
    const name = restaurants.find((r) => r.id === rid)?.name;
    const emit = (tail: string[]) => {
      window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail } }));
    };
    const tail = name ? [name] : [];
    emit(tail);
    const again = requestAnimationFrame(() => emit(tail));
    return () => { cancelAnimationFrame(again); emit([]); };
  }, [rid, restaurants]);

  // The top bar's "Switch restaurant" dropdown re-scopes THIS page instead of bouncing out to
  // the owner home — the same event trick Reports uses. That is what let the page's own 47px
  // switch row be deleted: one switcher, in the bar that was already there. "All restaurants"
  // sends rid null, which lands back on the restaurant launcher.
  useEffect(() => {
    const onPick = (e: Event) => setRid((e as CustomEvent).detail?.rid ?? null);
    window.addEventListener("lfh:owner-manager-rid", onPick as EventListener);
    return () => window.removeEventListener("lfh:owner-manager-rid", onPick as EventListener);
  }, []);

  // The iframe is created IMPERATIVELY, with src set BEFORE it enters the DOM. Rendered
  // as JSX, React inserts the element first and assigns src after — the browser treats
  // that as a NAVIGATION and adds a history entry ON TOP of the back-stack's layer, so
  // the phone's BACK blanked the floor instead of returning to the launcher (found by
  // the launcher back-test, 2026-08-02). An iframe whose src is set pre-insertion does
  // an initial load with no entry. Skin changes travel by postMessage, never a reload.
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rid || !mount.current) return;
    const el = document.createElement("iframe");
    el.src = `/panels/editor/index.html?rid=${encodeURIComponent(rid)}&ownermode=1&skin=${skinRef.current}`;
    el.title = "Manager mode";
    el.className = "omm-frame";
    el.addEventListener("load", () => pushSkin(skinRef.current));
    mount.current.appendChild(el);
    frame.current = el;
    // The phone's notch / gesture-bar insets, pushed in as --safe-t/-b/-l/-r (T12, 2026-08-13).
    // Manager mode IS the floor on his own phone, so its "Send to kitchen" and undo bar are
    // exactly the controls that were landing in the gesture strip. Same bridge as PanelFrame.
    const stopSafeArea = attachSafeAreaBridge(() => el);
    return () => { stopSafeArea(); frame.current = null; el.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);

  // ── Screen 1: pick the restaurant ─────────────────────────────────────────────
  if (!rid) {
    return (
      <div className="omm-launch">
        {/* `adm-page-h`, NOT `adm-page-title` (T17 sweep, 2026-09-04). No stylesheet has ever
            declared `adm-page-title`, so this heading fell through to the browser's own h1 —
            measured 27px / weight 700 with an 18px margin above AND below, beside a console whose
            page headings are 22px / weight 800 with no top margin and 4px below (19px on a phone).
            So the one screen a multi-restaurant owner meets first had the biggest, loosest, least
            emphatic heading in the whole cockpit, and its own sub-line was pushed 18px away from it.
            Three PAGES were cleaned of this class on 2026-08-31 and `verify:owner-money` item 7
            exists for exactly it — but that check's walk only ever entered `app/`, and this file is
            in `components/`, so it sat green over the fault. The walk now enters `components/` too,
            and `verify:owner-shell` §1 asserts this file by name. */}
        <h1 className="adm-page-h">Manager mode</h1>
        <p className="adm-page-sub">Pick the restaurant whose floor you want to run — live tables, orders and bills, exactly like the manager panel.</p>
        <div className="omm-grid">
          {restaurants.map((r) => (
            <button key={r.id} type="button" className="omm-card" onClick={() => setRid(r.id)}>
              {/* THE SAME COLOUR THE REST OF THE COCKPIT GIVES THIS RESTAURANT (T17 sweep,
                  2026-09-04). This dot used the restaurant's BRAND accent while the sidebar three
                  inches to the left uses `portfolioColor(id)` — so on ONE screen My Little French
                  House was gold here and cyan there, and Pizza Palace red here and emerald there
                  (measured rgb(227,192,111) vs rgb(6,182,212), and rgb(192,57,43) vs
                  rgb(52,211,153)). That is the exact drift the T5 sweep fixed for the sidebar, the
                  switcher and the charts on 2026-08-07 — lib/restaurantColor exists to hold the one
                  answer, and this launcher was simply never converted. Keyed by id, so it is stable
                  across sorts, reloads and pages. */}
              <span className="sw" style={{ background: portfolioColor(r.id) }} aria-hidden="true" />
              <span className="nm">{r.name}</span>
              <span className="go">Open the live floor <i className="fas fa-arrow-right" aria-hidden="true" /></span>
            </button>
          ))}
        </div>
        <style>{`
          .omm-launch{ max-width: 860px; }
          .omm-grid{ display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:14px; margin-top:18px; }
          .omm-card{ display:flex; flex-direction:column; align-items:flex-start; gap:10px; text-align:left;
            min-height:110px; padding:16px 18px; font:inherit; color:var(--text); cursor:pointer;
            background:var(--card); border:var(--border); border-radius:14px;
            transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease; }
          .omm-card:hover{ border-color:var(--accent); transform:translateY(-2px); box-shadow:0 10px 26px rgba(0,0,0,.18); }
          .omm-card:active{ transform:scale(.98); }
          .omm-card:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }
          .omm-card .sw{ width:12px; height:12px; border-radius:50%; flex:0 0 auto; }
          .omm-card .nm{ font-size:16px; font-weight:700; line-height:1.3; }
          .omm-card .go{ margin-top:auto; font-size:12.5px; font-weight:600; color:var(--accent);
            display:inline-flex; align-items:center; gap:7px; }
        `}</style>
      </div>
    );
  }

  // ── Screen 2: the floor ───────────────────────────────────────────────────────
  return (
    <div className="omm-full">
      {/* THE SWITCH ROW IS GONE (owner, 2026-08-15: "there are too much thing. Half of the screen
          has been covered by the top thing"). It was a whole 47px row carrying one button, under
          a bar that ALREADY has a "Switch restaurant" dropdown — and it printed the restaurant's
          name a third time, under two bars that both name it. The shell's dropdown used to bounce
          you out to the owner home from here; it now re-scopes this page in place instead (see
          openRestaurant in OwnerShell), which is the same trick Reports already uses, so nothing
          was lost by deleting the row. The floor gained the full 47px. */}
      <div ref={mount} className="omm-mount" />
      <style>{`
        /* Break out of the owner content padding / centered max-width — only on this page. */
        .adm-main:has(.omm-full){ padding:0 !important; overflow:hidden !important; }
        .owx-wrap:has(.omm-full){ max-width:none !important; margin:0 !important; height:100% !important; }
        .omm-full{ height:100%; display:flex; flex-direction:column; min-height:0; }
        .omm-mount{ flex:1 1 auto; min-height:0; display:flex; }
        .omm-frame{ flex:1 1 auto; width:100%; border:0; display:block; background:var(--bg, #0a0c10); }
      `}</style>
    </div>
  );
}
