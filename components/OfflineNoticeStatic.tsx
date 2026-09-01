// OfflineNoticeStatic.tsx — the offline warning that still appears when NOTHING ELSE CAN.
//
// WHY THIS EXISTS, AND WHY components/OfflineNotice.tsx IS NOT ENOUGH (owner's item 11, 2026-09-01:
// *"there should be a visible error in the phone or whichever screen … that you are offline so any
// changes you made will not happen"*).
//
// `OfflineNotice` is the right bar and it works: measured on the dish page, the 3D screen and the
// menu, when the signal drops on a page that is ALREADY OPEN, it appears in red within a second and
// says the true thing. That is the common case and it is already built.
//
// The case it cannot cover is a RELOAD with no signal. Measured on this stack: after an offline
// reload the service worker serves the cached document, but **the client JavaScript never boots at
// all** — `--lfh-offbar-h` is never set, firing a synthetic `offline` event does nothing, and a
// click does nothing. So every React component is out of the game, including the offline bar. What
// a diner actually got was a page frozen mid-load with no explanation: on the dish page, the words
// "PLATING YOUR DISH" and nothing else, for as long as they cared to wait.
//
// This is a plain `<script>` in the document, so it runs as the parser reaches it — the same
// mechanism app/view/[folder]/page.tsx already uses to pin the tab's restaurant before React, and
// the same one the tenant menu uses to stamp dark mode. It needs no framework, no hydration and no
// module graph, which is exactly the point: it is the one thing left standing.
//
// IT DOES NOT DOUBLE UP. If React does boot, `OfflineNotice` renders its own bar and this one
// removes itself the moment it sees it — so a guest never gets two bars saying the same thing.
//
// THE WORDING IS DELIBERATELY NOT THE SAME as the React bar's. That bar can promise "anything you
// send is saved and goes by itself", because when it is on screen the guest outbox is running. Here
// nothing is running, so that promise would be a lie. This says what is actually true: the page
// cannot load or send anything until the signal is back.
//
// STILL ENGLISH, like the bar it stands in for — R15 in docs/REJECTED-IDEAS.md ("No — English is
// fine for these", owner 2026-08-12). Do not wire it to lib/i18n.ts: lib/i18n.ts is a module, and a
// module is the one thing this file cannot use.

// NOTHING DYNAMIC REACHES THIS SCRIPT, WHICH IS WHY IT IS SAFE TO INLINE. The only interpolation
// below is `JSON.stringify(BAR_ID)`, and BAR_ID is the hardcoded constant on the next line — no
// search parameter, no path segment, no database value and no guest input is anywhere near it. The
// `innerHTML` inside the script is likewise a fixed literal. Contrast app/view/[folder]/page.tsx,
// which inlines a script carrying a value that CAME from the address bar: that one has to resolve
// the slug against the database and character-check it first, and its comment explains why. This
// one has nothing to check.

// The bar's own id, so the script can find, re-use and remove it without touching anything else.
const BAR_ID = "lfh-offline-static";

// Written as one line and inlined verbatim. Kept small on purpose — it sits in the HTML of every
// dish page and every 3D page, so every character is paid for on the guest's first byte.
const SCRIPT = `(function(){try{
var ID=${JSON.stringify(BAR_ID)};
function bar(){
  var e=document.getElementById(ID);
  if(e)return e;
  e=document.createElement('div');
  e.id=ID;e.setAttribute('role','status');
  e.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99991;display:flex;align-items:center;justify-content:center;gap:8px;padding:9px 14px calc(9px + env(safe-area-inset-bottom));background:rgba(239,68,68,.94);color:#fff;font:700 12.5px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 -6px 24px rgba(0,0,0,.28);pointer-events:none';
  e.innerHTML='<span aria-hidden="true">\\u26A0\\uFE0F</span><span>No internet \\u2014 this page can\\u2019t load or send anything right now. <span style="font-weight:600;opacity:.9">Reconnect and it will work again.</span></span>';
  (document.body||document.documentElement).appendChild(e);
  return e;
}
function drop(){var e=document.getElementById(ID);if(e&&e.parentNode)e.parentNode.removeChild(e);}
// IS REACT ALIVE AND ALREADY DOING THIS JOB? components/OfflineNotice.tsx sets this custom
// property from an effect the moment it mounts — even to '0px' when it has nothing to say — so its
// presence is the honest signal that the framework booted. Asked EVERY time, not once at startup:
// an earlier version only watched for the first five seconds, and a diner whose signal dropped
// later than that got BOTH bars, one under the other, saying different things. Measured: 2 bars on
// the dish page and 2 on the 3D screen.
function reactOwnsIt(){
  try{ return document.documentElement.style.getPropertyValue('--lfh-offbar-h')!==''; }catch(e){ return false; }
}
function sync(){
  if(navigator.onLine===false && !reactOwnsIt()){ bar(); } else { drop(); }
}
// The browser's own signal, both ways.
window.addEventListener('offline',sync);
window.addEventListener('online',drop);
// The document may still be parsing when this runs, so there may be no <body> to append to yet.
if(document.body){sync();}else{document.addEventListener('DOMContentLoaded',sync);}
// One short watch for the case where we drew the bar BEFORE React booted: as soon as it does, this
// stands down. It gives up after a few seconds, so nothing is left watching for the life of the tab
// — the check inside sync() above is what covers every later drop.
var n=0,iv=setInterval(function(){
  n++;
  if(reactOwnsIt()){drop();clearInterval(iv);}
  else if(n>20){clearInterval(iv);}
},250);
}catch(e){}})();`;

/**
 * Renders nothing visible. Drop it into any SERVER component whose screen a guest can reload with
 * no signal — the two dish doors and the 3D route today.
 */
export default function OfflineNoticeStatic() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
