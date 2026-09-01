"use client";

// GuestNotFound — the dead-end screen for a GUEST-facing page that doesn't exist:
// a dish link that's been removed or mistyped, a restaurant that's been switched off,
// or a menu whose master switch is now off.
//
// WHY IT EXISTS (guest sweep, 2026-08-04). These pages used to fall through to the
// ROOT not-found, which is the PLATFORM's 404: it showed a diner the "Aevidine"
// wordmark four times and its only button, "Back to safety", pointed at "/" — which
// 307s to /login, the STAFF sign-in. So a customer who opened a shared or stale dish
// link was shown the software vendor's branding and then dumped on a staff password
// screen, with no route back to the menu they were on. That breaks the white-label rule
// AND leaves a real diner stranded mid-meal.
//
// HONEST ABOUT THE WAY OUT — and this is the part worth keeping whatever the screen looks
// like. A missing DISH still has a working menu to go back to, but a switched-off restaurant
// does not, and this component cannot know which case it is (a not-found boundary receives no
// params). So it ASKS: one small request to the menu-data endpoint, which is exactly the gate
// the menu page itself uses. Menu answers → offer it. Menu doesn't → say so plainly and point
// at a member of staff, instead of offering a button that 404s straight back here.
//
// ── THE LOOK: THE ORDER DOCKET, AND ONE SET OF WORDS ────────────────────────────────────────
//
// The owner picked the order-slip-on-the-spike screen for guests on 2026-08-26. It briefly had a
// dish-specific variant of the docket ("DISH — off the menu") and he threw that out the same day:
// *"we don't need this dish isn't in menu one … we don't even need it."* He is right — a guest does
// not care whether the address or the dish is the thing that is missing, only how to get back to
// the menu. One screen, one set of words, less to keep true.
//
// TWO STATES REMAIN, and the second is logic rather than decoration:
//
//     a guest page that is not there →  TABLE 404 · no such table  · stamped VOID
//     the whole menu is switched off →  MENU  —   · not serving     · stamped CLOSED
//
// That second one must never offer a button, because there is nothing behind it.
//
// It keeps this screen's own typeface and theme tokens rather than system-ui (visual sweep
// 2026-08-05): this was once the only guest screen drawn in a different typeface with no theme,
// so a diner who scanned a blue- or pink-themed restaurant's QR landed on a system-font page in
// restaurant #1's brown. A dead end still has to look like the restaurant they are sitting in.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_RESTAURANT_SLUG } from "@/lib/tenant";

const CSS = `
.gnf { min-height: 100dvh; display: grid; place-items: center; padding: 24px; text-align: center;
       background: repeating-linear-gradient(90deg, rgba(0,0,0,.022) 0 2px, transparent 2px 46px),
                   linear-gradient(#3c3733, #2b2724);
       color: #efe9df; font-family: 'Inter', system-ui, sans-serif; }
.gnf-wrap { width: min(400px, 100%); }
.gnf .rail { position: relative; height: 228px; }
.gnf .bar { position: absolute; top: 16px; left: 6%; right: 6%; height: 7px; border-radius: 4px;
            background: linear-gradient(#d8dae0, #8b8f98); box-shadow: 0 2px 5px rgba(0,0,0,.45); }
.gnf .spike { position: absolute; top: 8px; left: 50%; translate: -50% 0; width: 3px; height: 50px;
              background: linear-gradient(#e9ebf0, #9aa0aa); }
.gnf .spike::before { content: ""; position: absolute; top: -6px; left: -3px; width: 9px; height: 9px;
                      border-radius: 50%; background: #e9ebf0; }
.gnf .docket { position: absolute; top: 26px; left: 50%; width: 202px; margin-left: -101px;
  background: #fffdf6; color: #23201c; padding: 16px 14px 14px; text-align: left;
  box-shadow: 0 14px 30px rgba(0,0,0,.42); transform-origin: 50% 6px;
  clip-path: polygon(0 0,100% 0,100% calc(100% - 7px),
    94% 100%,88% calc(100% - 6px),82% 100%,76% calc(100% - 6px),70% 100%,64% calc(100% - 6px),
    58% 100%,52% calc(100% - 6px),46% 100%,40% calc(100% - 6px),34% 100%,28% calc(100% - 6px),
    22% 100%,16% calc(100% - 6px),10% 100%,4% calc(100% - 6px),0 100%);
  animation: gnfDrop 1.15s cubic-bezier(.25,.9,.3,1) .1s both, gnfSway 5.5s ease-in-out 1.4s infinite; }
.gnf .hole { position: absolute; top: 6px; left: 50%; translate: -50% 0; width: 9px; height: 9px;
             border-radius: 50%; background: #2b2724; box-shadow: inset 0 1px 2px rgba(0,0,0,.6); }
.gnf .docket h2 { margin: 8px 0 2px; font: 800 11px/1.2 ui-monospace, Menlo, monospace;
                  letter-spacing: .18em; color: #8a8175; text-transform: uppercase; }
.gnf .big { font: 800 32px/1 ui-monospace, Menlo, monospace; margin: 2px 0 8px; }
.gnf .row { display: flex; justify-content: space-between; gap: 8px;
            font: 600 11.5px/1.6 ui-monospace, Menlo, monospace; color: #8a8175;
            border-top: 1px dashed #ded5c4; padding-top: 5px; }
.gnf .row span:last-child { text-align: right; }
.gnf .stamp { position: absolute; right: -6px; bottom: 24px; padding: 5px 9px; border: 2.5px solid #c0392b;
  color: #c0392b; font: 800 12px/1 system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase;
  border-radius: 4px; opacity: 0; animation: gnfSlam .32s cubic-bezier(.2,1.4,.4,1) 1.25s forwards; }
.gnf h1 { font-size: 21px; margin: 12px 0 8px; font-weight: 800; }
.gnf .sub { color: #b3aa9d; font-size: 14px; margin: 0 auto 20px; max-width: 33ch; }
/* !important on the COLOUR, not just the underline: app/globals.css has
   \`a { color: inherit !important }\` to stop guest links turning blue, and that beats any normal
   declaration however specific — so this button's text inherited the page colour and measured
   1.19:1 against its own background. Unreadable, on the only control this screen offers. */
.gnf .btn, .gnf a.btn:visited, .gnf a.btn:hover, .gnf a.btn:active {
  display: block; width: 100%; padding: 13px 18px; border-radius: 12px; border: 0;
  font: 700 14.5px/1 system-ui, sans-serif; cursor: pointer;
  background: #fffdf6; color: #23201c !important; text-decoration: none !important; }
@keyframes gnfDrop { 0% { transform: translateY(-190px) rotate(-13deg); opacity: 0 }
                     55% { opacity: 1 } 70% { transform: translateY(4px) rotate(4deg) }
                     100% { transform: translateY(0) rotate(0); opacity: 1 } }
@keyframes gnfSway { 0%,100% { transform: rotate(-1.5deg) } 50% { transform: rotate(1.5deg) } }
@keyframes gnfSlam { 0% { opacity: 0; transform: rotate(-11deg) scale(2.4) }
                     60% { opacity: 1; transform: rotate(-11deg) scale(.94) }
                     100% { opacity: 1; transform: rotate(-11deg) scale(1) } }
@media (prefers-reduced-motion: reduce) {
  .gnf .docket { animation: none }
  .gnf .stamp { animation: none; opacity: 1; transform: rotate(-11deg) }
}`;

export default function GuestNotFound() {
  const pathname = usePathname() || "";
  // /r/<slug>/... carries its restaurant in the path. The legacy /item/<slug> route IS
  // restaurant #1 by definition (same rule as lib/tenantStorage + restaurant-context).
  const m = pathname.match(/^\/r\/([^/]+)/);
  const slug = m ? decodeURIComponent(m[1]) : /^\/item(\/|$)/.test(pathname) ? DEFAULT_RESTAURANT_SLUG : null;
  // null = still asking · true = this restaurant's menu is live · false = it isn't.
  const [menuLive, setMenuLive] = useState<boolean | null>(null);
  useEffect(() => {
    if (!slug) { setMenuLive(false); return; }
    let alive = true;
    fetch(`/api/r/${encodeURIComponent(slug)}/menu-data`, { cache: "no-store" })
      .then((r) => { if (alive) setMenuLive(r.ok); })
      .catch(() => { if (alive) setMenuLive(false); }); // offline / unreachable → don't promise a menu
    return () => { alive = false; };
  }, [slug]);

  // Two states. The menu-is-off case deliberately gets no button at all: there is nothing behind
  // it, and offering one would bounce a guest straight back to this screen.
  const off = menuLive === false;
  const kind = off ? "Menu" : "Table";
  const mark = off ? "—" : "404";
  const status = off ? "not serving" : "no such table";
  const stamp = off ? "Closed" : "Void";
  const title = off ? "This menu isn’t available right now" : "That table doesn’t exist";
  const sub = off
    ? "Please ask a member of staff — they can bring you the menu or scan the current code for your table."
    : "The page you asked for isn’t here. If you’re sitting down, scan the QR code on your table again — or ask a member of staff.";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="gnf">
        <div className="gnf-wrap">
          <div className="rail">
            <div className="bar" /><div className="spike" />
            <div className="docket">
              <div className="hole" />
              <h2>{kind}</h2>
              <div className="big">{mark}</div>
              <div className="row"><span>Covers</span><span>&mdash;</span></div>
              <div className="row"><span>Order</span><span>none</span></div>
              <div className="row"><span>Status</span><span>{status}</span></div>
              <div className="stamp">{stamp}</div>
            </div>
          </div>
          <h1>{title}</h1>
          <p className="sub">{sub}</p>
          {/* Only offered once we KNOW the menu answers, so this can never bounce a guest
              straight back to this same screen. */}
          {menuLive === true && slug && (
            <a className="btn" href={`/r/${encodeURIComponent(slug)}/menu`}>Go to the menu</a>
          )}
        </div>
      </main>
    </>
  );
}
