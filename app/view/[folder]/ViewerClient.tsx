// "use client" = runs in the browser. The 3D viewer is fully interactive
// (spinning the model, hotspots, AR), so it has to run here.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation"; // reads the "?from=..." in the address
import PublicModelViewer from "@/components/PublicModelViewer"; // wraps the <model-viewer> 3D element
import InfinityLoader from "@/components/InfinityLoader";       // loading spinner
import { modelLoader } from "@/lib/modelLoader";     // 3D model download manager
import { modelWatchlist } from "@/lib/modelWatchlist"; // tracks who's waiting on a model (for toasts)
import { getMenuItem, type MenuItem } from "@/lib/menu"; // fetch one dish's details
import { allergenIcon, allergenLabel } from "@/lib/allergens"; // allergen icon + label
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format"; // money formatting

// Describes the "config.json" file each dish folder has — the 3D model URLs,
// the title/subtitle/stats, and the hotspot "tags" pinned onto the model.
interface PublicConfig {
  modelUrl?: string;
  smallUrl?: string;
  optimizedUrl?: string;
  title?: string;
  subtitle?: string;
  stats?: {
    calories?: string;
    protein?: string;
    carbs?: string;
    price?: string;
  };
  // The camera angle + distance the editor's "Set front view" button captured,
  // stored as a model-viewer camera-orbit string: "<theta>deg <phi>deg <radius>m"
  // (e.g. "519.36deg 71.39deg 1.937m"). When present, the reveal spin lands
  // exactly on this pose so the menu matches what was set in the editor.
  frontView?: string;
  tags?: Array<{
    id: string;
    emoji: string;
    name: string;
    b1: string;
    b2: string;
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    tagPosition?: string;
  }>;
}

// Turn a saved "front view" string from config.json into numbers the viewer can
// use. The string looks like "519.36deg 71.39deg 1.937m" (theta phi radius).
// Returns null when nothing was saved (so callers fall back to default framing).
// parseFloat happily ignores the trailing "deg"/"m", e.g. parseFloat("519.36deg") → 519.36.
function parseFrontView(
  raw: string | undefined,
): { theta: number; phi: number; radius: number } | null {
  if (!raw) return null;
  const parts = String(raw).trim().split(/\s+/);
  const theta = parseFloat(parts[0]);
  const phi = parseFloat(parts[1]);
  const radius = parseFloat(parts[2]);
  // Need all three to be real numbers, otherwise treat as "not set".
  if (isNaN(theta) || isNaN(phi) || isNaN(radius)) return null;
  return { theta, phi, radius };
}

// The 3D viewer component. `folder` tells us which dish's model + config to load.
export default function ViewerClient({ folder }: { folder: string }) {
  // The pieces of memory this screen keeps:
  const [config, setConfig] = useState<PublicConfig | null>(null);  // the loaded config.json
  const [loading, setLoading] = useState(true);          // still loading the config?
  const [error, setError] = useState<string | null>(null); // an error message, if loading failed
  const [barVisible, setBarVisible] = useState(false);   // has the bottom info bar slid in?
  const [loaderVisible, setLoaderVisible] = useState(true); // is the spinner showing?
  const [activeUrl, setActiveUrl] = useState<string | null>(null); // which model file to actually show
  const [showTryAgain, setShowTryAgain] = useState(false); // show the "taking longer" overlay?
  const [menuItem, setMenuItem] = useState<MenuItem | null>(null); // the dish's menu details
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null); // currency for prices
  const [showInfo, setShowInfo] = useState(false);       // is the details sheet open?
  const [hintVisible, setHintVisible] = useState(false); // is the "triple-tap to replay" hint showing?
  // Refs hold values across redraws without triggering one:
  const mvRef = useRef<ModelViewerElement>(null); // a handle to the actual <model-viewer> element
  const startedRef = useRef(false);   // has the reveal animation started yet?
  const requestRef = useRef<number>(0); // id of the running animation loop (so we can stop it)
  const modelSeenRef = useRef(false);  // has the model actually appeared on screen?
  const searchParams = useSearchParams();        // the address's "?..." part
  const fromSlug = searchParams.get("from") || ""; // which dish we came from
  // Where the Back button goes: to that dish if we know it, else the menu.
  const backHref = fromSlug ? `/item/${fromSlug}` : "/menu";

  // The bar's name/stats/price come from the actual MENU item, not config.json
  // (config is only the hotspots/tags). Falls back to config if the item is missing.
  // Runs when we arrive (and if the source dish changes).
  useEffect(() => {
    setCurrency(getCurrency());  // figure out the currency for prices
    // If we know which dish we came from, fetch its menu details for the bar.
    if (fromSlug) getMenuItem(fromSlug).then(setMenuItem).catch(() => {});
  }, [fromSlug]);

  // Open the SAME confirm popup the dish-detail page uses (qty picker + total),
  // handled by the globally-mounted OrderConfirmModal.
  const addToOrder = () => {
    if (!menuItem) return;
    window.dispatchEvent(
      new CustomEvent("lfh:open-order-confirm", {
        detail: {
          item: {
            id: menuItem.id,
            title: menuItem.title,
            price: menuItem.price,
            image: menuItem.image,
          },
          options: menuItem.options,
          allergens: menuItem.allergens,
        },
      })
    );
  };

  // Format a price for the current currency (falls back to $ if not loaded yet).
  const showPrice = (p: string) => (currency ? formatPrice(p, currency) : `$${p}`);

  // The replay hint gently pops in shortly after the dish appears, lingers ~3s,
  // fades, then repeats every 7s — a soft reminder, never forced on screen.
  // Re-runs whenever the bottom bar becomes visible/hidden.
  useEffect(() => {
    if (!barVisible) return;  // only run the hint once the dish is shown
    let hideTimer: ReturnType<typeof setTimeout>;
    // Show the hint, then hide it again after 3 seconds.
    const pop = () => {
      setHintVisible(true);
      hideTimer = setTimeout(() => setHintVisible(false), 3000);
    };
    const first = setTimeout(pop, 1200);  // first pop ~1.2s in
    const loop = setInterval(pop, 7000);  // then repeat every 7s
    // Cleanup: stop all the timers when leaving / when the bar hides.
    return () => {
      clearTimeout(first);
      clearTimeout(hideTimer);
      clearInterval(loop);
    };
  }, [barVisible]);

  // Load this dish folder's config.json (the model URLs + hotspot tags).
  // Re-runs if the folder changes.
  useEffect(() => {
    const normalizedFolder = (folder || "");
    fetch(`/content/items/${normalizedFolder}/config.json`)
      .then((res) => {
        // If the file isn't there, treat it as an error.
        if (!res.ok) {
          throw new Error("Failed to load config");
        }
        return res.json();  // turn the response into a usable object
      })
      .then((data) => {
        setConfig(data);     // store the config
        setLoading(false);   // done loading
      })
      .catch((err) => {
        setError(err.message);  // remember the error to show it
        setLoading(false);
      });
  }, [folder]);

  // Once the config is loaded, decide which model file to actually display:
  // prefer the high-quality "optimized" one, but show the small one first if
  // that's what's ready, and upgrade when the better one finishes loading.
  useEffect(() => {
    if (!config) return;  // wait for the config
    const small = config.smallUrl;       // the fast ~2MB model
    const opt = config.optimizedUrl;     // the high-quality ~9MB model
    // Old-style config with a single URL? Just use it and stop.
    if (!small && !opt) {
      if (config.modelUrl) setActiveUrl(config.modelUrl);
      return;
    }

    // Ask the loader to download these (small first), as a priority.
    const urls: string[] = [];
    if (small) urls.push(small);
    if (opt) urls.push(opt);
    modelLoader.prioritize(urls);

    // If neither model is ready yet, add this dish to the "watchlist" so a
    // toast can notify the guest when it finishes loading.
    const somethingReady =
      (opt && modelLoader.isLoaded(opt)) ||
      (small && modelLoader.isLoaded(small));
    if (!somethingReady) {
      modelWatchlist.watch({
        folder,
        title: config.title || folder,
        slug: fromSlug || undefined,
        smallUrl: small,
        optimizedUrl: opt,
      });
    }

    // Pick the best model that's ready right now (optimized beats small).
    const pick = () => {
      if (opt && modelLoader.isLoaded(opt)) {
        return modelLoader.getCachedUrl(opt) ?? opt;
      }
      if (small && modelLoader.isLoaded(small)) {
        return modelLoader.getCachedUrl(small) ?? small;
      }
      return null;  // nothing ready yet
    };

    // Set the chosen model as the active one (only if it actually changed).
    const apply = () => {
      const best = pick();
      if (best) setActiveUrl((prev) => (prev === best ? prev : best));
    };

    apply();  // try once now
    // ...and re-try every time the loader reports progress, so we upgrade from
    // small to optimized automatically. subscribe returns an "unsubscribe"
    // function, which we return so React stops listening when we leave.
    const unsub = modelLoader.subscribe(apply);
    return unsub;
  }, [config, folder, fromSlug]);

  // Wire up what happens once the 3D model element is on the page: when it
  // finishes loading, hide the spinner, slide in the bar, and play the reveal.
  useEffect(() => {
    if (loading || error || !mvRef.current || !activeUrl) return;  // not ready yet

    const mv = mvRef.current;  // the <model-viewer> element

    // The model finished loading and is now visible.
    const handleLoad = () => {
      modelSeenRef.current = true;             // remember it appeared
      modelWatchlist.unwatchByFolder(folder);  // no need to notify anymore
      setShowTryAgain(false);                  // hide any "taking longer" overlay
      setLoaderVisible(false);                 // hide the spinner
      setTimeout(() => {
        setBarVisible(true);                   // slide in the bottom info bar after 1s
      }, 1000);
      // keep the "triple-tap to replay" hint visible as a persistent cue
      // Play the reveal animation once, shortly after the model appears.
      if (!startedRef.current) {
        startedRef.current = true;
        setTimeout(runFullSequence, 800);
      }
    };

    // When the guest enters AR mode, replay the reveal animation.
    const handleARStatus = (e: any) => {
      if (e.detail?.status === "session-started") {
        runFullSequence();
      }
    };

    // Start listening for those two events on the model element.
    mv.addEventListener("load", handleLoad);
    mv.addEventListener("ar-status", handleARStatus);

    // Safety net: if "load" never fires within 4s, play the reveal anyway.
    const startTimeout = setTimeout(() => {
      if (!startedRef.current) {
        startedRef.current = true;
        runFullSequence();
      }
    }, 4000);

    // Cleanup: stop listening and cancel timers/animation when leaving.
    return () => {
      mv.removeEventListener("load", handleLoad);
      mv.removeEventListener("ar-status", handleARStatus);
      clearTimeout(startTimeout);
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
    // runFullSequence is a stable closure; re-running on its identity would
    // restart the cinematic on every render. Re-run only on these state deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, activeUrl, folder]);

  // A patience timer: if the model still hasn't shown after 15 seconds, show
  // the friendly "still preparing" overlay instead of leaving them guessing.
  useEffect(() => {
    if (loading || error) return;
    // Only fall back to the "taking longer" overlay if the model genuinely
    // hasn't arrived after a generous window. The small GLB (~2 MB) can still
    // be downloading on a cold/slow first visit (the menu only preheats the
    // small model now, not the heavy optimized one), and the InfinityLoader
    // stays on screen meanwhile — so 6 s was too eager and looked like a failure.
    const t = setTimeout(() => {
      if (!modelSeenRef.current) {
        setShowTryAgain(true);
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [loading, error]);

  // Redraws the thin connector line from a hotspot dot to its floating label
  // card, so the line stays attached as the model spins. (One line per tag.)
  const _updateLine = (ing: any) => {
    const line = document.getElementById(`hs-line-${ing.id}`) as SVGLineElement | null;
    const anchorBtn = document.getElementById(`hs-${ing.id}`);   // the dot on the model
    const cardWrap = document.getElementById(`hs-card-${ing.id}`); // the label card
    if (!line || !anchorBtn || !cardWrap) return;
    // Keep the card ON-SCREEN. A hotspot anchored near the model's left/right edge
    // (common on a narrow phone) would otherwise push its card off the viewport and
    // clip it. We nudge the card inward with a left margin so it's never cut off;
    // the connector line below re-reads the card's real position and stays attached.
    const edge = 8;
    const wr = cardWrap.getBoundingClientRect();
    const curM = parseFloat(cardWrap.style.marginLeft || "0");
    let targetM = curM;
    if (wr.right > window.innerWidth - edge) targetM = curM - (wr.right - (window.innerWidth - edge));
    else if (wr.left < edge) targetM = curM + (edge - wr.left);
    if (Math.abs(targetM - curM) > 0.5) cardWrap.style.marginLeft = targetM.toFixed(1) + "px";
    // Work out the card's position relative to the dot and point the line there.
    const aRect = anchorBtn.getBoundingClientRect();
    const cRect = cardWrap.getBoundingClientRect();
    const cx = cRect.left + cRect.width / 2;
    const cy = cRect.top + cRect.height;
    line.setAttribute("x2", (cx - aRect.left).toFixed(1));
    line.setAttribute("y2", (cy - aRect.top).toFixed(1));
  };

  // A continuous loop that keeps every connector line updated, frame by frame.
  const _loop = () => {
    config?.tags?.forEach(ing => _updateLine(ing));
    requestRef.current = requestAnimationFrame(_loop);  // schedule the next frame
  };

  // The opening "cinematic": spins the model a full turn while scaling it up
  // from small to full size over ~2.6s, then calls onComplete when done.
  const animateModelCinematic = (onComplete: () => void) => {
    const model = mvRef.current;
    if (!model) {
      onComplete();  // no model element — just finish immediately
      return;
    }
    const duration = 2600;  // milliseconds
    const startTime = performance.now();
    // An easing curve so the motion starts fast and settles gently.
    function ease(t: number) {
      return 1 - Math.pow(1 - t, 3);
    }

    // Did the editor capture a "front view" for this dish? If so, the reveal
    // spin should ORBIT THE CAMERA and land exactly on that saved pose, so the
    // menu stops where the editor said it should. If not, we keep the original
    // behaviour (spin the MODEL itself, camera stays at the default framing) so
    // existing dishes look exactly as before.
    const fv = parseFrontView(config?.frontView);

    if (fv) {
      // --- frontView path: animate the camera one full lap, ending on the pose.
      const endTheta = fv.theta;          // where the camera should finish (deg)
      const startTheta = endTheta - 360;  // start a full turntable lap behind it
      // Build a camera-orbit string at a given horizontal angle (theta), holding
      // the saved vertical angle (phi) and distance (radius) fixed.
      const orbitStr = (th: number) =>
        `${th.toFixed(2)}deg ${fv.phi.toFixed(2)}deg ${fv.radius.toFixed(3)}m`;
      // Turn OFF model-viewer's own camera smoothing so our easing fully owns the
      // motion; remember the old value to restore it when we're done.
      const prevDecay = (model as any).interpolationDecay;
      (model as any).interpolationDecay = 0;
      (model as any).orientation = "0deg 0deg 0deg";  // keep the model upright/still
      function animate(time: number) {
        const p = Math.min((time - startTime) / duration, 1);  // progress 0→1
        const e = ease(p);                                      // eased progress
        (model as any).cameraOrbit = orbitStr(startTheta + (endTheta - startTheta) * e);
        const scale = (0.3 + e * 0.7).toFixed(4);               // grow 0.3→1
        (model as any).scale = `${scale} ${scale} ${scale}`;
        if (p < 1) {
          requestAnimationFrame(animate);
        } else {
          (model as any).cameraOrbit = orbitStr(endTheta);  // land exactly on the front view
          (model as any).scale = "1 1 1";
          (model as any).interpolationDecay = prevDecay || 50;  // restore smoothing
          onComplete();
        }
      }
      requestAnimationFrame(animate);
      return;
    }

    // --- default path (no frontView saved): original model-orientation spin.
    function animate(time: number) {
      const p = Math.min((time - startTime) / duration, 1);  // progress 0→1
      const e = ease(p);                                      // eased progress
      (model as any).orientation = `0deg 0deg ${(e * 360).toFixed(2)}deg`;  // spin
      const scale = (0.3 + e * 0.7).toFixed(4);               // grow 0.3→1
      (model as any).scale = `${scale} ${scale} ${scale}`;
      if (p < 1) {
        requestAnimationFrame(animate);  // not done — next frame
      } else {
        // Done: snap to the final upright, full-size pose and finish.
        (model as any).orientation = "0deg 0deg 0deg";
        (model as any).scale = "1 1 1";
        onComplete();
      }
    }
    requestAnimationFrame(animate);  // kick off the first frame
  };

  // After the model settles, reveal the hotspot lines and label cards one by
  // one (staggered), each line "drawing" itself then its card fading/scaling in.
  const startTagAnimation = () => {
    config?.tags?.forEach((ing, index) => {
      const delay = index * 400;  // stagger each tag by 0.4s so they appear in turn
      const line = document.getElementById(`hs-line-${ing.id}`) as SVGLineElement | null;
      const card = document.querySelector(`#hs-card-${ing.id} .hs-card`);
      const cardWrap = document.getElementById(`hs-card-${ing.id}`);
      if (!card || !cardWrap) return;

      if (line) {
        setTimeout(() => {
          let len = 300;
          try {
            len = line.getTotalLength();
          } catch {}
          if (!len || len < 1) len = 300;
          line.style.transition = "none";
          line.style.opacity = "0";
          line.style.strokeDasharray = `${len}`;
          line.style.strokeDashoffset = `${len}`;
          line.classList.remove("line-visible");
          void line.getBoundingClientRect();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              line.style.opacity = "1";
              line.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)";
              line.style.strokeDashoffset = "0";
              setTimeout(() => {
                line.style.transition = "";
                line.classList.add("line-visible");
              }, 1300);
            })
          );
        }, delay);
      }
      setTimeout(() => {
        cardWrap!.style.opacity = "1";
        cardWrap!.style.transform = "translate(-50%,-50%) scale(1)";
        card!.classList.add("card-animate");
      }, delay + 900);
      setTimeout(() => card!.classList.add("content-animate"), delay + 1300);
      setTimeout(() => cardWrap!.classList.add("title-animate"), delay + 1700);
    });
  };

  // The whole reveal, start to finish: first RESET every line and card back to
  // hidden, then run the cinematic spin, then play the staggered tag animation
  // and start the line-tracking loop. Called on first load and on triple-tap.
  const runFullSequence = () => {
    // Reset all the connector lines to invisible.
    config?.tags?.forEach(ing => {
      const line = document.getElementById(`hs-line-${ing.id}`) as SVGLineElement | null;
      if (!line) return;
      line.classList.remove("line-visible");
      line.style.transition = "none";
      line.style.opacity = "0";
      if (line.style.strokeDasharray) {
        line.style.strokeDashoffset = line.style.strokeDasharray;
      }
    });
    // Reset all the label cards to their hidden starting state.
    document.querySelectorAll(".hs-card").forEach((el) =>
      (el as HTMLElement).classList.remove("card-animate", "content-animate")
    );
    document.querySelectorAll(".hs-card-wrap").forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.classList.remove("title-animate");
      htmlEl.style.transition = "none";
      htmlEl.style.opacity = "0";
      htmlEl.style.transform = "translate(-50%,-50%) scale(0.8)";
    });
    void document.body.offsetWidth;  // force the browser to apply the reset before animating
    // Now play the cinematic spin; when it's done, reveal the tags + start the loop.
    animateModelCinematic(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          startTagAnimation();
          _loop();
        })
      )
    );
  };

  // The AR (augmented reality) button: place the dish in the real room via the
  // phone camera. Only works on a secure (HTTPS) page, so warn if it can't.
  const handleLaunchAR = () => {
    if (mvRef.current?.canActivateAR && mvRef.current.activateAR) {
      mvRef.current.activateAR();
    } else {
      alert("AR requires HTTPS.\n\nUpload to tiiny.host and open on phone.");
    }
  };

  // Triple-tap / triple-click the model to replay the reveal animation.
  // (AR replays it automatically on entry via the ar-status handler above.)
  useEffect(() => {
    if (loading || error) return;
    const target = mvRef.current;  // the model element to listen on
    if (!target) return;
    let clicks = 0;  // how many taps so far
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTap = () => {
      clicks += 1;
      if (clicks >= 3) {
        // Three taps within the window — replay the reveal.
        clicks = 0;
        if (timer) { clearTimeout(timer); timer = null; }
        runFullSequence();
      } else {
        // Otherwise wait up to 0.6s for more taps, then reset the counter.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { clicks = 0; }, 600);
      }
    };
    target.addEventListener("click", onTap);
    return () => {
      target.removeEventListener("click", onTap);
      if (timer) clearTimeout(timer);
    };
    // runFullSequence is a stable closure (see note above); intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, activeUrl]);

  // While the config is loading, show just the spinner.
  if (loading) {
    return (
      <div className="viewer-wrapper">
        <div id="load">
          <InfinityLoader label="Loading 3D Model" size={110} />
        </div>
      </div>
    );
  }

  // If loading the config failed, show an error message with a Back link.
  if (error) {
    return (
      <div className="viewer-wrapper flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-white mb-2">Failed to load viewer</h2>
        <p className="text-white/50 mb-4">{error}</p>
        <Link href={backHref} className="text-[#6ddc8a] font-semibold hover:underline">
          ← Back
        </Link>
      </div>
    );
  }

  // The main viewer screen.
  return (
    <div className="viewer-wrapper">
      {/* The spinner stays up until the model appears (and not while showing
          the "taking longer" overlay). */}
      {loaderVisible && !showTryAgain && (
        <div id="load">
          <InfinityLoader label="Loading 3D Model" size={110} />
        </div>
      )}

      {/* The friendly "still preparing" overlay (only after the long wait,
          and only if the model still hasn't shown). */}
      {showTryAgain && !modelSeenRef.current && (
        <div id="try-again-overlay">
          <div className="try-again-card">
            <div className="try-again-emoji">⏳</div>
            <div className="try-again-title">Still preparing your 3D view</div>
            <div className="try-again-sub">
              The model is taking longer than usual. We&apos;ll let you know
              as soon as it&apos;s ready.
            </div>
            <Link href={backHref} className="try-again-btn">
              <i className="fas fa-arrow-left"></i> Go back
            </Link>
          </div>
        </div>
      )}

      {/* A small badge used during AR placement. */}
      <div className="placing-badge" id="placing-badge"></div>

      {/* The top bar: Back on the left, the AR button on the right. */}
      <div id="topbar">
        <Link href={backHref} className="tbtn back-btn">
          <i className="fas fa-arrow-left"></i> Back
        </Link>
        <div className="top-btns">
          <button className="tbtn ar-btn" onClick={handleLaunchAR}>
            <i className="fas fa-cube"></i> AR View
          </button>
        </div>
      </div>

      {/* The "triple-tap to replay" hint; the "show" class fades it in/out. */}
      <div id="dbl-hint" className={hintVisible ? "show" : ""}>👆 Triple-tap to replay</div>

      {/* The actual 3D model element — only once we have a config AND a chosen
          model file. We pass the chosen file in as modelUrl. */}
      {config && activeUrl && (
        <PublicModelViewer
          config={{ ...config, modelUrl: activeUrl }}
          mvRef={mvRef}
        />
      )}

      {/* The bottom info bar (name, stats, price, Add to Order). It slides up
          once "on" is added. Values prefer the live menu item, falling back
          to the config. */}
      <div id="bar" className={barVisible ? "on" : ""}>
        <div className="dname" id="dish-title">
          {menuItem?.title || config?.title || ""}
        </div>
        <div className="dsub" id="dish-sub">
          {menuItem?.description || config?.subtitle || ""}
        </div>
        <div className="srow">
          <div>
            <div className="sv" id="stat-cal">{menuItem?.nutrition.calories || config?.stats?.calories || "—"}</div>
            <div className="sl">Calories</div>
          </div>
          <div>
            <div className="sv" id="stat-pro">{menuItem?.nutrition.protein || config?.stats?.protein || "—"}</div>
            <div className="sl">Protein</div>
          </div>
          <div>
            <div className="sv" id="stat-carb">{menuItem?.nutrition.carbs || config?.stats?.carbs || "—"}</div>
            <div className="sl">Carbs</div>
          </div>
          <div>
            <div className="sv" id="stat-price">{menuItem ? showPrice(menuItem.price) : config?.stats?.price || "—"}</div>
            <div className="sl">Price</div>
          </div>
        </div>
        {/* Add-to-order button (disabled until the menu item loads) and the
            "i" button that opens the full details sheet. */}
        <div className="brow">
          <button className="badd" onClick={addToOrder} disabled={!menuItem}>🛒 Add to Order</button>
          <button className="binfo" onClick={() => setShowInfo(true)} aria-label="Dish details">ℹ</button>
        </div>
      </div>

      {/* The slide-up details sheet: description, ingredients, allergens.
          Shown only when the "i" was tapped and we have the menu item. */}
      {showInfo && menuItem && (
        // Tapping the dark backdrop closes the sheet.
        <div className="vinfo-overlay" onClick={() => setShowInfo(false)}>
          {/* stopPropagation here means tapping INSIDE the sheet doesn't close it. */}
          <div className="vinfo-sheet" onClick={(e) => e.stopPropagation()}>
            <button className="vinfo-close" aria-label="Close" onClick={() => setShowInfo(false)}>
              <i className="fas fa-times"></i>
            </button>
            <div className="vinfo-title">{menuItem.title}</div>
            <div className="vinfo-meta">{menuItem.rating} ★ · {showPrice(menuItem.price)}</div>
            {menuItem.longDescription && <p className="vinfo-desc">{menuItem.longDescription}</p>}
            {menuItem.ingredients.length > 0 && (
              <>
                <div className="vinfo-label">Ingredients</div>
                <div className="vinfo-chips">
                  {menuItem.ingredients.map((ing, i) => (
                    <span key={i} className="vinfo-chip">{ing.emoji} {ing.name}</span>
                  ))}
                </div>
              </>
            )}
            {menuItem.allergens.length > 0 && (
              <>
                <div className="vinfo-label">Contains</div>
                <div className="vinfo-chips">
                  {menuItem.allergens.map((a) => (
                    <span key={a} className="vinfo-chip warn">{allergenIcon(a)} {allergenLabel(a)}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
