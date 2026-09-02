"use client";
// Branded 404 — TWO screens, not one, because the two audiences want opposite things
// (owner, 2026-08-26, after looking at ten prototypes):
//
//   A GUEST  → "Order slip on the spike": a kitchen docket flutters onto the spike reading
//              TABLE 404, and a rubber stamp slams VOID across it. Their goal is to reach the
//              menu, so the way out IS the menu.
//   A MEMBER → "Burnt toast": a toaster pops a slice burnt black with 404 branded into it, and
//   OF STAFF   tapping the toaster pops it again. His words: "I liked burned toast for … any
//              worker like tablet owner, even me, admin manager, kitchen".
//
// WHICH ONE, AND WHY IT IS DECIDED IN REACT RATHER THAN IN AN INLINE SCRIPT.
//
// The first attempt did it with an inline <script> that stamped an attribute on <html>, and CSS
// that revealed one screen or the other. It worked on exactly two routes out of ten. React 19
// hoists <style> and <script> children, and on most routes neither ran before paint — so a waiter
// on /manager/nope was shown the GUEST screen, unstyled, with no way to tell. Measured on a
// production build, which is the only reason it was caught.
//
// So the switch is now ordinary React state: only ONE of the two screens is ever in the tree, and
// it is correct even if the <style> below never arrives (it would simply be unstyled rather than
// wrong). `useLayoutEffect` runs BEFORE the browser paints, so there is no flash of the wrong one.
//
// The initial value is "staff" on purpose. The server has no address to read, so it renders the
// staff screen; a browser with JavaScript switched off therefore gets a working screen whose way
// out is "/", which is exactly the behaviour this page had before today. With JavaScript — every
// real phone and tablet — the correct screen is chosen before the first paint.
//
// The guest doors are the same list public/offline.html uses for ITS way out, so the two screens
// can never disagree about who is looking: /r/<slug>/…, the legacy /menu and /item, the printed
// /q/<code>, and /view/<folder> (the 3D dish viewer — a guest surface with no slug in its path,
// which is exactly how it came to be missed once already).
import { useLayoutEffect, useState } from "react";
// Used only in the <noscript> fallback below, for the one link whose href is the literal "/".
// next/link renders a plain <a> into the HTML, so it still works with JavaScript switched off.
import Link from "next/link";

type Aud = "guest" | "staff";

/** The audience, the restaurant this path belongs to, and where the way out should go. */
function readAudience(): { aud: Aud; slug: string; href: string; label: string; maybe?: string } {
  const p = typeof location === "undefined" ? "" : location.pathname || "";
  const pinned = (): string => {
    let t = "";
    try { t = (sessionStorage.getItem("lfh_tab_tenant") || "").toLowerCase(); } catch { /* refused */ }
    return /^[a-z0-9-]+$/.test(t) ? t : "";
  };
  const fromQuery = (): string => {
    // ?r= is whatever a stranger put in a link, so it is validated exactly as
    // app/view/[folder]/page.tsx validates it before trusting it.
    let q = (location.search.match(/[?&]r=([^&]*)/) || [])[1] || "";
    try { q = decodeURIComponent(q).toLowerCase(); } catch { q = ""; }
    return /^[a-z0-9-]+$/.test(q) ? q : "";
  };

  const m = p.match(/^\/r\/([^/]+)\//);
  if (m) {
    const slug = m[1].toLowerCase();
    return { aud: "guest", slug, href: `/r/${slug}/menu`, label: "Go to the menu" };
  }
  if (/^\/(menu|item)(\/|$)/.test(p)) return { aud: "guest", slug: "", href: "/menu", label: "Go to the menu" };
  if (/^\/q\/[^/]+/.test(p)) {
    const slug = pinned();
    // With nothing pinned we cannot send them anywhere else: the printed code is the only thing
    // that knows their table, and /menu would be the WRONG restaurant on a multi-restaurant
    // install. So the way out reloads this same code.
    return { aud: "guest", slug, href: slug ? `/r/${slug}/menu` : p, label: "Go to the menu" };
  }
  if (/^\/view\/[^/]+/.test(p)) {
    const slug = pinned() || fromQuery();
    return { aud: "guest", slug, href: slug ? `/r/${slug}/menu` : "/menu", label: "Go to the menu" };
  }
  // THE ADDRESS SAYS STAFF — that half is his instruction word for word: the staff door is offered
  // "if written login or aevinite then only".
  if (STAFF_WORDS.test(p)) return { aud: "staff", slug: "", href: "/", label: "Go to the home screen" };

  // EVERYTHING ELSE IS A STRANGER, AND A STRANGER ON THIS SITE IS A DINER (owner, 2026-08-28, asked
  // to settle it: he left the call to me, and this is the call).
  //
  // Two of this repo's own guards disagreed here for two days, and both quoted him from 2026-08-26.
  // verify:notfound said an address like /signup gets the BURNT TOAST worker screen, because that
  // is the default for anyone who is not obviously a guest. verify:guest said it gets the guest
  // advice, because he also said the staff door is offered only when the address itself says staff.
  //
  // The tie-breaker is who actually turns up. This is a restaurant's public web address: the people
  // typing a wrong path into it are overwhelmingly diners with a bad link, not waiters. Getting it
  // wrong towards the guest costs a worker one extra tap — "/" is one word away and they know the
  // way in. Getting it wrong towards staff costs a diner a PASSWORD PROMPT, which is the exact dead
  // end both of these screens were designed to remove (and it is what item 9 in this same branch
  // had to put right for a mistyped menu link).
  //
  // The address may ALSO be a restaurant's own with the "/r/" dropped, and that has to be ASKED
  // rather than guessed — see resolveSlug(). If it resolves, nothing below is ever painted.
  const seg = p.split("/").filter(Boolean)[0] || "";
  let maybe = "";
  try { maybe = decodeURIComponent(seg).toLowerCase(); } catch { maybe = ""; }
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(maybe)) maybe = "";

  // The way out, when there is one. If this device has been in a restaurant, send them back to that
  // restaurant — never to "/menu", which is restaurant #1 by definition and would be the WRONG
  // restaurant for a stranger on a multi-restaurant install. With nothing pinned there is NO BUTTON
  // at all: the advice ("scan the QR code on your table again") is the honest answer, and a button
  // that leads nowhere useful would only bounce them back to this same screen. That is the same
  // reasoning components/GuestNotFound.tsx already uses for its own menu-is-off case.
  const known = pinned();
  return known
    ? { aud: "guest", slug: known, href: `/r/${known}/menu`, label: "Go to the menu", maybe }
    : { aud: "guest", slug: "", href: "", label: "", maybe };
}

// The words that mean "this person was heading somewhere staff-only". `/login` and `/aevinite` are
// the two the owner named; the panels are the same kind of address and would be just as wrong to
// answer with a restaurant's menu.
const STAFF_WORDS = /(^|\/)(login|staff-login|aevinite|admin|manager|editor|kitchen|tablet|owner)(\/|$)/i;

/**
 * A DINER WHO DROPPED THE "/r/" IS SENT TO THE MENU, NOT TO A PASSWORD SCREEN.
 *
 * Owner, 2026-08-26: *"yes for this guest should be redirected to menu if you make it like that if
 * possible and if written login or aevinite then only locate to there"*.
 *
 * A menu's real address is /r/<slug>/menu. Drop the "/r/" — by editing a shared link, or retyping
 * one — and the visitor lands here, on the STAFF screen, whose way out is "/" and therefore the
 * staff sign-in. A guest mid-meal shown a password prompt is the exact dead end these two screens
 * exist to remove.
 *
 * This was built on 2026-08-26 and then lost three days later, when the two picked 404 designs
 * replaced this whole file and the redirect was not carried across. verify:guest has been red on
 * clean main for it ever since (11 checks). Restored here, inside the new design rather than beside
 * it. (sweep #7 / T28, 2026-08-27.)
 *
 * ONE HEAD REQUEST to the menu-data endpoint — the same gate the menu page itself uses, so a
 * switched-off restaurant, or one whose Menu feature is off, correctly does NOT resolve and the
 * visitor keeps the screen they would have had. HEAD, not GET: a menu is ~24KB and none of it is
 * wanted, only the yes/no.
 */
async function resolveSlug(slug: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/r/${encodeURIComponent(slug)}/menu-data`, { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch { return false; }   // offline → never promise a menu we cannot reach
}

const CSS = `
.nf { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 24px; text-align: center; }
/* THE WAY OUT WAS INVISIBLE, AND THIS IS WHY.
   app/globals.css carries \`a { color: inherit !important }\` so guest links never turn blue. An
   !important declaration beats ANY normal one however specific, so the colours set on .nf-home and
   .nf-again below never applied to an anchor: its text simply inherited the page colour. Measured
   on the built site — the guest button came out at 1.19:1 and the STAFF button at 1.00:1, which is
   text the exact colour of the thing it is printed on. Both "Go to the menu" and "Go to the home
   screen" were unreadable, on the one control these screens exist to offer.
   I had written the comment that a stronger selector was needed and then only overridden the
   UNDERLINE. It needs !important on the colour too. */
.nf a.nf-btn, .nf a.nf-btn:visited, .nf a.nf-btn:hover, .nf a.nf-btn:active { text-decoration: none !important; }
.nf-g a.nf-home, .nf-g a.nf-home:visited, .nf-g a.nf-home:hover, .nf-g a.nf-home:active { color: #23201c !important; }
.nf-g a.nf-again, .nf-g a.nf-again:visited { color: #d9d1c5 !important; }
.nf-s a.nf-home, .nf-s a.nf-home:visited, .nf-s a.nf-home:hover, .nf-s a.nf-home:active { color: #fff9f0 !important; }
.nf-s a.nf-again, .nf-s a.nf-again:visited { color: #241a12 !important; }
.nf .nf-btn { display: block; width: 100%; padding: 14px 18px; border-radius: 12px; border: 0;
              font: 700 14.5px/1 system-ui, sans-serif; cursor: pointer; }
.nf .nf-wrap { width: min(420px, 100%); }
.nf h1 { font-weight: 800; letter-spacing: -.01em; }
.nf .nf-brand { font: 800 11px/1 system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase; }

/* ══ GUEST — the order slip on the spike ══════════════════════════════════════════════════ */
.nf-g { background: repeating-linear-gradient(90deg, rgba(0,0,0,.022) 0 2px, transparent 2px 46px),
                    linear-gradient(#3c3733, #2b2724); color: #efe9df;
        font: 500 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.nf-g .nf-brand { color: #b9ad9a; margin-bottom: 10px; }
.nf-g .rail { position: relative; height: 236px; }
.nf-g .bar { position: absolute; top: 16px; left: 6%; right: 6%; height: 7px; border-radius: 4px;
             background: linear-gradient(#d8dae0, #8b8f98); box-shadow: 0 2px 5px rgba(0,0,0,.45); }
.nf-g .spike { position: absolute; top: 8px; left: 50%; translate: -50% 0; width: 3px; height: 50px;
               background: linear-gradient(#e9ebf0, #9aa0aa); }
.nf-g .spike::before { content: ""; position: absolute; top: -6px; left: -3px; width: 9px; height: 9px;
                       border-radius: 50%; background: #e9ebf0; }
.nf-g .docket { position: absolute; top: 26px; left: 50%; width: 206px; margin-left: -103px;
  background: #fffdf6; color: #23201c; padding: 16px 14px 14px; text-align: left;
  box-shadow: 0 14px 30px rgba(0,0,0,.42); transform-origin: 50% 6px;
  clip-path: polygon(0 0,100% 0,100% calc(100% - 7px),
    94% 100%,88% calc(100% - 6px),82% 100%,76% calc(100% - 6px),70% 100%,64% calc(100% - 6px),
    58% 100%,52% calc(100% - 6px),46% 100%,40% calc(100% - 6px),34% 100%,28% calc(100% - 6px),
    22% 100%,16% calc(100% - 6px),10% 100%,4% calc(100% - 6px),0 100%);
  animation: nfDrop 1.15s cubic-bezier(.25,.9,.3,1) .1s both, nfSway 5.5s ease-in-out 1.4s infinite; }
.nf-g .hole { position: absolute; top: 6px; left: 50%; translate: -50% 0; width: 9px; height: 9px;
              border-radius: 50%; background: #2b2724; box-shadow: inset 0 1px 2px rgba(0,0,0,.6); }
.nf-g .docket h2 { margin: 8px 0 2px; font: 800 11px/1.2 ui-monospace, Menlo, monospace;
                   letter-spacing: .18em; color: #8a8175; text-transform: uppercase; }
.nf-g .big { font: 800 33px/1 ui-monospace, Menlo, monospace; margin: 2px 0 8px; }
.nf-g .row { display: flex; justify-content: space-between; font: 600 11.5px/1.6 ui-monospace, Menlo, monospace;
             color: #8a8175; border-top: 1px dashed #ded5c4; padding-top: 5px; }
/* THE STAMP LANDS ON THE BLANK PART OF THE DOCKET, NOT ACROSS ITS WORDS (owner, item 9, 2026-09-02).
   It was pinned to the BOTTOM, which on a 206px docket put it straight over the last two rows: the
   word "none" was half covered and "no such table" was struck through by the stamp's own border.
   Measured at 360x780. A rubber stamp slammed across a docket is exactly what was asked for — the
   fault was only WHERE it landed. The top-right of the docket is genuinely empty (the big "404" is
   about 70px of a 178px-wide box), so the stamp now slams down there: same slam, same angle, same
   size, nothing underneath it. Measured after the change: 0 overlapping text nodes. */
.nf-g .stamp { position: absolute; right: -6px; top: 34px; padding: 5px 9px; border: 2.5px solid #c0392b;
  color: #c0392b; font: 800 12px/1 system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase;
  border-radius: 4px; opacity: 0; animation: nfSlam .32s cubic-bezier(.2,1.4,.4,1) 1.25s forwards; }
.nf-g h1 { font-size: 21px; margin: 12px 0 8px; }
.nf-g .sub { color: #b3aa9d; font-size: 14px; margin: 0 auto 22px; max-width: 33ch; }
.nf-g .nf-home { background: #fffdf6; color: #23201c; }
.nf-g .nf-again { background: transparent; color: #d9d1c5; border: 1px solid rgba(255,255,255,.22); margin-top: 9px; }
@keyframes nfDrop { 0% { transform: translateY(-190px) rotate(-13deg); opacity: 0 }
                    55% { opacity: 1 } 70% { transform: translateY(4px) rotate(4deg) }
                    100% { transform: translateY(0) rotate(0); opacity: 1 } }
@keyframes nfSway { 0%,100% { transform: rotate(-1.5deg) } 50% { transform: rotate(1.5deg) } }
@keyframes nfSlam { 0% { opacity: 0; transform: rotate(-11deg) scale(2.4) }
                    60% { opacity: 1; transform: rotate(-11deg) scale(.94) }
                    100% { opacity: 1; transform: rotate(-11deg) scale(1) } }

/* ══ STAFF — burnt toast ══════════════════════════════════════════════════════════════════ */
.nf-s { background: radial-gradient(120% 100% at 50% -10%, #fffdf8, #fff8ec 50%, #f6e6cd 100%);
        color: #241a12; font: 500 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
.nf-s .stage { height: 176px; display: grid; place-items: end center; }
.nf-s .toaster { position: relative; width: 150px; height: 104px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.nf-s .toaster:focus-visible { outline: 3px solid #241a12; outline-offset: 6px; border-radius: 18px; }
.nf-s .slice { position: absolute; left: 50%; bottom: 56px; width: 76px; height: 66px; margin-left: -38px;
  border-radius: 10px 10px 4px 4px; background: linear-gradient(#3b2a1d, #221610 62%, #1a110c);
  display: grid; place-items: center; z-index: 0; transform: translateY(70px);
  animation: nfPop .62s cubic-bezier(.2,1.5,.4,1) .55s both; }
.nf-s .slice b { font: 800 25px/1 ui-monospace, Menlo, monospace; color: #6d5a48;
                 text-shadow: 0 1px 0 rgba(0,0,0,.5); }
.nf-s .slice::before { content: ""; position: absolute; inset: 0; border-radius: inherit; opacity: .5;
  background: radial-gradient(10px 7px at 22% 30%, #000 40%, transparent 42%),
              radial-gradient(8px 6px at 74% 22%, #000 40%, transparent 42%),
              radial-gradient(12px 8px at 62% 72%, #000 40%, transparent 42%),
              radial-gradient(7px 5px at 30% 76%, #000 40%, transparent 42%); }
.nf-s .tbody { position: absolute; left: 0; bottom: 0; width: 150px; height: 74px;
  border-radius: 16px 16px 12px 12px; background: linear-gradient(165deg,#f2f4f8 0%,#cfd4dc 45%,#9aa0aa 100%);
  box-shadow: inset -6px -5px 12px rgba(255,255,255,.55), 0 10px 20px rgba(70,55,40,.26); z-index: 1; }
.nf-s .slot { position: absolute; left: 20px; top: -5px; width: 110px; height: 12px; border-radius: 8px;
  background: linear-gradient(#4a4f58,#2a2e35); box-shadow: inset 0 2px 4px rgba(0,0,0,.6); }
.nf-s .lever { position: absolute; right: -8px; top: 18px; width: 12px; height: 26px; border-radius: 6px;
  background: linear-gradient(#e9ecf1,#a7adb7); animation: nfLever .62s ease-out .55s both; }
.nf-s .dial { position: absolute; left: 16px; bottom: 16px; width: 20px; height: 20px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, #9aa0aa); box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.nf-s .dial::after { content: ""; position: absolute; left: 9px; top: 3px; width: 2px; height: 8px;
  background: #3d434c; border-radius: 2px; }
.nf-s .smoke { position: absolute; left: 50%; bottom: 112px; translate: -50% 0; width: 54px; height: 74px;
  pointer-events: none; z-index: 0; }
.nf-s .smoke span { position: absolute; bottom: 0; width: 9px; height: 9px; border-radius: 50%;
  background: rgba(90,80,70,.34); opacity: 0; }
.nf-s .smoke span:nth-child(1) { left: 10px; animation: nfRise 3s ease-out 1.15s infinite }
.nf-s .smoke span:nth-child(2) { left: 24px; animation: nfRise 3s ease-out 1.75s infinite }
.nf-s .smoke span:nth-child(3) { left: 37px; animation: nfRise 3s ease-out 2.35s infinite }
.nf-s h1 { font-size: 22px; margin: 12px 0 8px; }
.nf-s .sub { color: #7d6d5e; font-size: 14.5px; margin: 0 auto 6px; max-width: 33ch; }
.nf-s .poke { font-size: 12.5px; color: #a4947f; margin: 0 0 20px; }
.nf-s .nf-home { background: #241a12; color: #fff9f0; }
.nf-s .nf-again { background: transparent; color: #241a12; border: 1px solid rgba(36,26,18,.22); margin-top: 9px; }
.nf-s .again .slice { animation: nfPop .62s cubic-bezier(.2,1.5,.4,1) both }
.nf-s .again .lever { animation: nfLever .62s ease-out both }
@keyframes nfPop { 0% { transform: translateY(70px) } 70% { transform: translateY(-6px) } 100% { transform: translateY(0) } }
@keyframes nfLever { 0% { transform: translateY(22px) } 100% { transform: translateY(0) } }
@keyframes nfRise { 0% { opacity: 0; transform: translateY(0) scale(.6) }
                    20% { opacity: .5 } 100% { opacity: 0; transform: translateY(-58px) scale(2.1) } }

@media (prefers-reduced-motion: reduce) {
  .nf-g .docket, .nf-g .stamp, .nf-s .slice, .nf-s .lever,
  .nf-s .again .slice, .nf-s .again .lever { animation: none }
  .nf-g .stamp { opacity: 1; transform: rotate(-11deg) }
  .nf-s .slice { transform: none }
  .nf-s .smoke span { animation: none; opacity: .3 }
  .nf-s .poke { display: none }
}`;

export default function NotFound() {
  // NOTHING IS RENDERED UNTIL WE KNOW WHO IS LOOKING, and that is a correction of my own first go.
  //
  // The first version defaulted to "staff" so that a JavaScript-less browser got something. But
  // the server has no address to read, so it SERVER-RENDERED the staff screen — which the browser
  // paints — and only then did useLayoutEffect flip it to the guest one. useLayoutEffect beats the
  // paint of ITS OWN render, not the paint of the server's HTML. So a diner really could see the
  // staff screen first and then watch it change.
  //
  // Caught by running the guard against the deployed site repeatedly: two runs in seven read
  // "staff" on a guest path, on a site that was otherwise correct. On localhost it never showed up,
  // because hydration there is instant.
  //
  // So: null until decided, and a <noscript> block below carries a plain working screen for a
  // browser with JavaScript switched off. A 404 has nothing to gain from being server-rendered —
  // no search engine needs it — and a blank instant is far better than the wrong screen.
  const [a, setA] = useState<{ aud: Aud; slug: string; href: string; label: string; maybe?: string } | null>(null);
  const [name, setName] = useState("");
  const [popped, setPopped] = useState(0);

  useLayoutEffect(() => {
    const next = readAudience();
    // An address that might be a restaurant with the "/r/" dropped is ASKED about before anything
    // is shown. `a` stays null meanwhile, which this screen already treats as "not decided yet" —
    // a blank instant, never the wrong screen. If it resolves we leave for the menu and no 404 is
    // ever painted; if it does not, the screen this address would have had appears as normal.
    if (next.maybe) {
      let alive = true;
      resolveSlug(next.maybe).then((real) => {
        if (!alive) return;
        // replace, not assign: the address they typed was never a real page, so it must not sit in
        // their history waiting for Back to return them to this same dead end.
        if (real) location.replace(`/r/${next.maybe}/menu`);
        else setA(next);
      });
      return () => { alive = false; };
    }
    setA(next);
    // The restaurant's own name, when this device stored it — and ONLY for the same restaurant this
    // path resolves to, so one restaurant's name can never appear on another's screen. Never a
    // guess: de-slugging would print "French House" for a place called "My Little French House".
    if (next.aud === "guest") {
      try {
        const b = JSON.parse(localStorage.getItem("lfh_brand") || "null");
        if (b && typeof b.name === "string" && b.name.trim() && String(b.slug ?? "").toLowerCase() === next.slug) {
          setName(b.name.slice(0, 60));
        }
      } catch { /* storage refused — the screen is simply anonymous, never broken */ }
    }
  }, []);

  const reload = () => location.reload();

  // Until the audience is known: the stylesheet (so the chosen screen paints complete, with no
  // unstyled flash of its own) and a no-JavaScript fallback. Nothing else.
  if (!a) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <noscript>
          <div className="nf nf-s">
            <div className="nf-wrap">
              <h1>We can&rsquo;t find that page</h1>
              <p className="sub">It may have moved, or the link was mistyped.</p>
              {/* Both doors, because with no JavaScript we cannot tell which one this person needs.
                  The menu first: a diner is the one who would be stranded by the wrong choice. */}
              <a className="nf-btn nf-home" href="/menu">Go to the menu</a>
              <Link className="nf-btn nf-again" href="/">Go to the home screen</Link>
            </div>
          </div>
        </noscript>
      </>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {a.aud === "guest" ? (
        <div className="nf nf-g">
          <div className="nf-wrap">
            {name ? <div className="nf-brand">{name}</div> : null}
            <div className="rail">
              <div className="bar" /><div className="spike" />
              <div className="docket">
                <div className="hole" />
                <h2>Table</h2>
                <div className="big">404</div>
                <div className="row"><span>Covers</span><span>&mdash;</span></div>
                <div className="row"><span>Order</span><span>none</span></div>
                <div className="row"><span>Status</span><span>no such table</span></div>
                <div className="stamp">Void</div>
              </div>
            </div>
            <h1>That table doesn&rsquo;t exist</h1>
            <p className="sub">The page you asked for isn&rsquo;t here. If you&rsquo;re sitting down, scan
              the QR code on your table again &mdash; or ask a member of staff.</p>
            {/* No button when we do not know which restaurant they meant — see readAudience(). An
                offer that leads nowhere useful is worse than the advice above it. */}
            {a.href ? <a className="nf-btn nf-home" id="nf-home" href={a.href}>{a.label}</a> : null}
            <button className="nf-btn nf-again" type="button" onClick={reload}>Try again</button>
          </div>
        </div>
      ) : (
        <div className="nf nf-s">
          <div className="nf-wrap">
            <div className="stage">
              {/* `key` forces the slice and lever to remount on each tap, which is what restarts
                  their animations — cleaner than removing a class and forcing a reflow. */}
              <div
                className="toaster"
                id="nf-toaster"
                role="button"
                tabIndex={0}
                aria-label="Pop the toast again"
                onClick={() => setPopped((n) => n + 1)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPopped((n) => n + 1); } }}
              >
                <div className="smoke"><span /><span /><span /></div>
                <div className="slice" key={`s${popped}`}><b>404</b></div>
                <div className="tbody">
                  <div className="slot" /><div className="lever" key={`l${popped}`} /><div className="dial" />
                </div>
              </div>
            </div>
            <h1>We burnt that one</h1>
            <p className="sub">That screen doesn&rsquo;t exist &mdash; it may have moved, or the link was mistyped.</p>
            <p className="poke">(go on, tap the toaster)</p>
            <a className="nf-btn nf-home" id="nf-home" href={a.href}>{a.label}</a>
            <button className="nf-btn nf-again" type="button" onClick={reload}>Try again</button>
          </div>
        </div>
      )}
    </>
  );
}
