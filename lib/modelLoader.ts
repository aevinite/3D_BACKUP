"use client";

type Listener = () => void;

class ModelLoader {
  private loaded = new Map<string, string>();
  private inFlight: string | null = null;
  private queue: string[] = [];
  private listeners = new Set<Listener>();
  private running = false;
  private attempts = new Map<string, number>();
  private failed = new Set<string>();
  private static MAX_ATTEMPTS = 2;
  private static RETRY_DELAY_MS = 6000;

  isLoaded(url: string | null | undefined): boolean {
    if (!url) return false;
    return this.loaded.has(url);
  }

  getCachedUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    return this.loaded.get(url) ?? null;
  }

  private dispatch(name: string, url: string) {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: { url } }));
    } catch {}
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  }

  setQueue(
    selectedSmalls: string[],
    otherSmalls: string[],
    selectedOptimized: string[],
    otherOptimized: string[]
  ) {
    const all = [
      ...selectedSmalls,
      ...otherSmalls,
      ...selectedOptimized,
      ...otherOptimized,
    ];
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const u of all) {
      if (!u) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      if (this.loaded.has(u)) continue;
      if (this.failed.has(u)) continue;
      if (u === this.inFlight) continue;
      dedup.push(u);
    }
    this.queue = dedup;
    this.start();
  }

  prioritize(urls: string[]) {
    const toPrepend: string[] = [];
    const seen = new Set<string>();
    for (const u of urls) {
      if (!u) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      if (this.loaded.has(u)) continue;
      if (this.failed.has(u)) continue;
      if (u === this.inFlight) continue;
      toPrepend.push(u);
    }
    if (toPrepend.length === 0) {
      this.notify();
      return;
    }
    const prependSet = new Set(toPrepend);
    this.queue = [
      ...toPrepend,
      ...this.queue.filter((u) => !prependSet.has(u)),
    ];
    this.start();
  }

  private start() {
    if (this.running) {
      this.notify();
      return;
    }
    this.running = true;
    this.notify();
    void this.pump();
  }

  private async pump() {
    while (this.queue.length > 0) {
      const url = this.queue.shift()!;
      if (this.loaded.has(url)) continue;
      if (this.failed.has(url)) continue;
      this.inFlight = url;
      this.notify();
      let ok = false;
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          this.loaded.set(url, blobUrl);
          ok = true;
        } else {
          console.warn("Model preload non-OK", url, res.status);
        }
      } catch (e) {
        console.warn("Model preload failed", url, e);
      }
      this.inFlight = null;
      if (ok) {
        this.attempts.delete(url);
        this.dispatch("lfh:model-loaded", url);
      } else {
        const tries = (this.attempts.get(url) || 0) + 1;
        this.attempts.set(url, tries);
        if (tries < ModelLoader.MAX_ATTEMPTS) {
          const failedUrl = url;
          setTimeout(() => {
            if (
              !this.loaded.has(failedUrl) &&
              !this.failed.has(failedUrl) &&
              this.inFlight !== failedUrl &&
              !this.queue.includes(failedUrl)
            ) {
              this.queue.push(failedUrl);
              this.start();
            }
          }, ModelLoader.RETRY_DELAY_MS);
        } else {
          this.failed.add(url);
          this.dispatch("lfh:model-failed", url);
        }
      }
      this.notify();
    }
    this.running = false;
    this.notify();
  }
}

declare global {
  var __lfh_modelLoader: ModelLoader | undefined;
}

function getLoader(): ModelLoader {
  if (typeof window === "undefined") {
    return new ModelLoader();
  }
  if (!globalThis.__lfh_modelLoader) {
    globalThis.__lfh_modelLoader = new ModelLoader();
  }
  return globalThis.__lfh_modelLoader;
}

export const modelLoader = getLoader();
