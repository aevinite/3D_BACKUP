"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PublicModelViewer from "@/components/PublicModelViewer";
import InfinityLoader from "@/components/InfinityLoader";
import { modelLoader } from "@/lib/modelLoader";
import { modelWatchlist } from "@/lib/modelWatchlist";
import { getMenuItem, type MenuItem } from "@/lib/menu";
import { allergenIcon, allergenLabel } from "@/lib/allergens";
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format";

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

export default function ViewerClient({ folder }: { folder: string }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [barVisible, setBarVisible] = useState(false);
  const [loaderVisible, setLoaderVisible] = useState(true);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [showTryAgain, setShowTryAgain] = useState(false);
  const [menuItem, setMenuItem] = useState<MenuItem | null>(null);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const mvRef = useRef<ModelViewerElement>(null);
  const startedRef = useRef(false);
  const requestRef = useRef<number>(0);
  const modelSeenRef = useRef(false);
  const searchParams = useSearchParams();
  const fromSlug = searchParams.get("from") || "";
  const backHref = fromSlug ? `/item/${fromSlug}` : "/menu";

  // The bar's name/stats/price come from the actual MENU item, not config.json
  // (config is only the hotspots/tags). Falls back to config if the item is missing.
  useEffect(() => {
    setCurrency(getCurrency());
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

  const showPrice = (p: string) => (currency ? formatPrice(p, currency) : `$${p}`);

  // The replay hint gently pops in shortly after the dish appears, lingers ~3s,
  // fades, then repeats every 7s — a soft reminder, never forced on screen.
  useEffect(() => {
    if (!barVisible) return;
    let hideTimer: ReturnType<typeof setTimeout>;
    const pop = () => {
      setHintVisible(true);
      hideTimer = setTimeout(() => setHintVisible(false), 3000);
    };
    const first = setTimeout(pop, 1200);
    const loop = setInterval(pop, 7000);
    return () => {
      clearTimeout(first);
      clearTimeout(hideTimer);
      clearInterval(loop);
    };
  }, [barVisible]);

  useEffect(() => {
    const normalizedFolder = (folder || "");
    fetch(`/content/items/${normalizedFolder}/config.json`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load config");
        }
        return res.json();
      })
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [folder]);

  useEffect(() => {
    if (!config) return;
    const small = config.smallUrl;
    const opt = config.optimizedUrl;
    if (!small && !opt) {
      if (config.modelUrl) setActiveUrl(config.modelUrl);
      return;
    }

    const urls: string[] = [];
    if (small) urls.push(small);
    if (opt) urls.push(opt);
    modelLoader.prioritize(urls);

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

    const pick = () => {
      if (opt && modelLoader.isLoaded(opt)) {
        return modelLoader.getCachedUrl(opt) ?? opt;
      }
      if (small && modelLoader.isLoaded(small)) {
        return modelLoader.getCachedUrl(small) ?? small;
      }
      return null;
    };

    const apply = () => {
      const best = pick();
      if (best) setActiveUrl((prev) => (prev === best ? prev : best));
    };

    apply();
    const unsub = modelLoader.subscribe(apply);
    return unsub;
  }, [config, folder, fromSlug]);

  useEffect(() => {
    if (loading || error || !mvRef.current || !activeUrl) return;

    const mv = mvRef.current;

    const handleLoad = () => {
      modelSeenRef.current = true;
      modelWatchlist.unwatchByFolder(folder);
      setShowTryAgain(false);
      setLoaderVisible(false);
      setTimeout(() => {
        setBarVisible(true);
      }, 1000);
      // keep the "triple-tap to replay" hint visible as a persistent cue
      if (!startedRef.current) {
        startedRef.current = true;
        setTimeout(runFullSequence, 800);
      }
    };

    const handleARStatus = (e: any) => {
      if (e.detail?.status === "session-started") {
        runFullSequence();
      }
    };

    mv.addEventListener("load", handleLoad);
    mv.addEventListener("ar-status", handleARStatus);

    const startTimeout = setTimeout(() => {
      if (!startedRef.current) {
        startedRef.current = true;
        runFullSequence();
      }
    }, 4000);

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

  const _updateLine = (ing: any) => {
    const line = document.getElementById(`hs-line-${ing.id}`) as SVGLineElement | null;
    const anchorBtn = document.getElementById(`hs-${ing.id}`);
    const cardWrap = document.getElementById(`hs-card-${ing.id}`);
    if (!line || !anchorBtn || !cardWrap) return;
    const aRect = anchorBtn.getBoundingClientRect();
    const cRect = cardWrap.getBoundingClientRect();
    const cx = cRect.left + cRect.width / 2;
    const cy = cRect.top + cRect.height;
    line.setAttribute("x2", (cx - aRect.left).toFixed(1));
    line.setAttribute("y2", (cy - aRect.top).toFixed(1));
  };

  const _loop = () => {
    config?.tags?.forEach(ing => _updateLine(ing));
    requestRef.current = requestAnimationFrame(_loop);
  };

  const animateModelCinematic = (onComplete: () => void) => {
    const model = mvRef.current;
    if (!model) {
      onComplete();
      return;
    }
    const duration = 2600;
    const startTime = performance.now();
    function ease(t: number) {
      return 1 - Math.pow(1 - t, 3);
    }
    function animate(time: number) {
      const p = Math.min((time - startTime) / duration, 1);
      const e = ease(p);
      (model as any).orientation = `0deg 0deg ${(e * 360).toFixed(2)}deg`;
      const scale = (0.3 + e * 0.7).toFixed(4);
      (model as any).scale = `${scale} ${scale} ${scale}`;
      if (p < 1) {
        requestAnimationFrame(animate);
      } else {
        (model as any).orientation = "0deg 0deg 0deg";
        (model as any).scale = "1 1 1";
        onComplete();
      }
    }
    requestAnimationFrame(animate);
  };

  const startTagAnimation = () => {
    config?.tags?.forEach((ing, index) => {
      const delay = index * 400;
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

  const runFullSequence = () => {
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
    void document.body.offsetWidth;
    animateModelCinematic(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          startTagAnimation();
          _loop();
        })
      )
    );
  };

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
    const target = mvRef.current;
    if (!target) return;
    let clicks = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTap = () => {
      clicks += 1;
      if (clicks >= 3) {
        clicks = 0;
        if (timer) { clearTimeout(timer); timer = null; }
        runFullSequence();
      } else {
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

  if (loading) {
    return (
      <div className="viewer-wrapper">
        <div id="load">
          <InfinityLoader label="Loading 3D Model" size={110} />
        </div>
      </div>
    );
  }

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

  return (
    <div className="viewer-wrapper">
      {loaderVisible && !showTryAgain && (
        <div id="load">
          <InfinityLoader label="Loading 3D Model" size={110} />
        </div>
      )}

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

      <div className="placing-badge" id="placing-badge"></div>

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

      <div id="dbl-hint" className={hintVisible ? "show" : ""}>👆 Triple-tap to replay</div>

      {config && activeUrl && (
        <PublicModelViewer
          config={{ ...config, modelUrl: activeUrl }}
          mvRef={mvRef}
        />
      )}

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
        <div className="brow">
          <button className="badd" onClick={addToOrder} disabled={!menuItem}>🛒 Add to Order</button>
          <button className="binfo" onClick={() => setShowInfo(true)} aria-label="Dish details">ℹ</button>
        </div>
      </div>

      {showInfo && menuItem && (
        <div className="vinfo-overlay" onClick={() => setShowInfo(false)}>
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
