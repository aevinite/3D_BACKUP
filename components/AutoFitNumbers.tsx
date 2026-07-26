"use client";
// Panel-wide safety net for the fit-numbers rule (owner 2026-07-26): EVERY stat/KPI figure in
// the owner + admin panels must shrink its font to fit its tile instead of clipping — including
// ad-hoc tiles that don't render through AnimatedNumber, and ones added in the future.
//
// Mounted once per panel layout (app/owner/layout.tsx, app/aevinite/layout.tsx). It watches the
// DOM and re-fits every matching element after any render and on resize. One scan touches a few
// dozen elements at most — a no-op unless something actually overflows. AnimatedNumber spans fit
// themselves precisely via useFitNumber; this net covers everything else, so add `fit-num` to
// any new ad-hoc big number and it's handled.
import { useEffect } from "react";
import { fitNumberEl } from "@/components/FitNumber";

const SEL = [
  ".fit-num", "[data-fit-num]",       // explicit opt-in for one-off numbers
  ".anim-num",                        // count-up spans (their hook fits React updates; this
                                      // net also catches any direct DOM text change)
  ".adm-stat .v",                     // shared stat tiles (owner + admin, khata, billing, …)
  ".cmd-strip .cell .v",              // admin dashboard strip
  ".rev-strip .v",                    // admin revenue + usage strips
  ".rs-stat-v", ".rs-ov-val",         // reports Stat tiles + hero figure
  ".ow2-drawer .dstats b",            // owner restaurant drawer
  ".rv-rec b",                        // owner records strip
].join(",");

export default function AutoFitNumbers() {
  useEffect(() => {
    let raf = 0;
    const scan = () => {
      raf = 0;
      document.querySelectorAll<HTMLElement>(SEL).forEach(fitNumberEl);
    };
    // One scan per frame at most — React commits arrive in bursts. We only ever write style
    // (an attribute) while observing childList/characterData, so our writes never re-trigger.
    const queue = () => { if (!raf) raf = requestAnimationFrame(scan); };
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", queue);
    queue();
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", queue);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
