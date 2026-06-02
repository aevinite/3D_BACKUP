"use client"; // this code runs in the browser, not on the server

// This file is the "download manager" for the 3D dish models (.glb files).
// It downloads each model ONCE, keeps it in memory, and hands out a fast local
// link so navigating around the app never re-downloads the same big file.

// A Listener is just a function with no arguments — something to call when
// "things changed" so the UI can refresh (e.g. show a spinner or hide it).
type Listener = () => void;

// A "class" is a self-contained worker that bundles data + the actions on it.
// There is only ever ONE of these in the whole app (see getLoader at the bottom).
class ModelLoader {
  // "loaded" remembers, for each original model URL, the local blob: link we made
  // after downloading it. A Map is a labelled lookup table (original URL -> local URL).
  private loaded = new Map<string, string>();
  // The one URL we are downloading right this moment (or null if idle).
  private inFlight: string | null = null;
  // The waiting line of URLs still to download, in order.
  private queue: string[] = [];
  // Everyone who asked to be told when something changes (so they can re-render).
  private listeners = new Set<Listener>();
  // Are we currently working through the queue? Stops us starting twice.
  private running = false;
  // How many times we've tried each URL (so we can retry a couple of times).
  private attempts = new Map<string, number>();
  // URLs we've given up on after too many failed tries.
  private failed = new Set<string>();
  // Try a failing download at most twice before declaring it failed for good.
  private static MAX_ATTEMPTS = 2;
  // Wait 6 seconds (6000 ms) before retrying a failed download.
  private static RETRY_DELAY_MS = 6000;

  // Has this model already finished downloading? (true/false)
  isLoaded(url: string | null | undefined): boolean {
    if (!url) return false;
    return this.loaded.has(url);
  }

  // Give back the ready-to-use local blob: link for a model, or null if we don't
  // have it yet. The viewer uses this instead of re-downloading the big file.
  getCachedUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    return this.loaded.get(url) ?? null; // ?? means "or null if not found"
  }

  // Fire a browser-wide announcement (a CustomEvent) about a model. The "name"
  // is the event others listen for: "lfh:model-loaded" or "lfh:model-failed".
  private dispatch(name: string, url: string) {
    if (typeof window === "undefined") return; // no window = on the server, skip
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: { url } }));
    } catch {}
  }

  // Let a component register a callback to be notified of changes. It returns an
  // "unsubscribe" function — call that later to stop listening (avoids leaks).
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // Call every registered listener so the UI can refresh. Wrapped in try/catch so
  // one misbehaving listener can't break the others.
  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  }

  // Set up the whole download waiting-line. The caller hands in four groups in
  // priority order: the small (quick) versions of dishes the guest is likely to
  // look at first, then everyone else's small versions, then the high-quality
  // ("optimized") versions in the same order. We download in that order.
  setQueue(
    selectedSmalls: string[],
    otherSmalls: string[],
    selectedOptimized: string[],
    otherOptimized: string[]
  ) {
    // The "..." spreads each list out and joins them into one big ordered list.
    const all = [
      ...selectedSmalls,
      ...otherSmalls,
      ...selectedOptimized,
      ...otherOptimized,
    ];
    // Walk the list and build a clean version with no duplicates and nothing we
    // already have, already gave up on, or are downloading right now.
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const u of all) {
      if (!u) continue;                 // skip blanks
      if (seen.has(u)) continue;        // skip ones we already added
      seen.add(u);
      if (this.loaded.has(u)) continue; // skip ones already downloaded
      if (this.failed.has(u)) continue; // skip ones we gave up on
      if (u === this.inFlight) continue;// skip the one downloading now
      dedup.push(u);
    }
    this.queue = dedup;
    this.start(); // kick off downloading if we aren't already
  }

  // Jump certain models to the FRONT of the line — e.g. when a guest opens a
  // specific dish, we want its model first. Same de-duplicating rules as above.
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
    // Nothing new to bump forward — just refresh the UI and leave.
    if (toPrepend.length === 0) {
      this.notify();
      return;
    }
    // Rebuild the queue as [the bumped ones first] + [the rest, minus any we just
    // moved to the front so they don't appear twice].
    const prependSet = new Set(toPrepend);
    this.queue = [
      ...toPrepend,
      ...this.queue.filter((u) => !prependSet.has(u)),
    ];
    this.start();
  }

  // Begin working through the queue — but only if we're not already doing so.
  // The "running" flag is what stops two download loops running at the same time.
  private start() {
    if (this.running) {
      this.notify();
      return;
    }
    this.running = true;
    this.notify();
    void this.pump(); // "void" = start it but don't wait here for it to finish
  }

  // The actual download loop. "async" means it can pause (await) for slow network
  // without freezing the page. It downloads queued models one at a time.
  private async pump() {
    while (this.queue.length > 0) {
      // .shift() takes the first URL off the front of the line. "!" tells
      // TypeScript "trust me, the queue isn't empty here".
      const url = this.queue.shift()!;
      if (this.loaded.has(url)) continue; // someone else already grabbed it
      if (this.failed.has(url)) continue; // already given up on this one
      this.inFlight = url; // mark this as the one currently downloading
      this.notify();
      let ok = false; // did this download succeed?
      try {
        // Actually fetch the file. "cors"/"omit" = cross-site read, no cookies sent.
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (res.ok) {
          // Turn the downloaded bytes into a blob, then a local blob: URL the
          // <model-viewer> can read instantly — this is the "download once" magic.
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          this.loaded.set(url, blobUrl);
          ok = true;
        } else {
          // Server answered, but with an error code (e.g. 404). Log a gentle warning.
          console.warn("Model preload non-OK", url, res.status);
        }
      } catch (e) {
        // Network blew up entirely (offline, blocked, etc.).
        console.warn("Model preload failed", url, e);
      }
      this.inFlight = null; // we're no longer downloading this one
      if (ok) {
        // Success: forget any past failed attempts and announce it loaded.
        this.attempts.delete(url);
        this.dispatch("lfh:model-loaded", url);
      } else {
        // Failure: count this attempt.
        const tries = (this.attempts.get(url) || 0) + 1;
        this.attempts.set(url, tries);
        if (tries < ModelLoader.MAX_ATTEMPTS) {
          // Still have a retry left: after a delay, slip it back into the queue
          // — but only if it hasn't since loaded, failed, or been re-queued.
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
          // Out of retries: mark it failed for good and announce it failed.
          this.failed.add(url);
          this.dispatch("lfh:model-failed", url);
        }
      }
      this.notify();
    }
    // Queue is empty — we're done for now. Reset the flag so a future setQueue
    // can start the loop again.
    this.running = false;
    this.notify();
  }
}

// Tell TypeScript that a single shared ModelLoader may live on the global object
// (globalThis) under this name. This is how we keep ONE loader for the whole app.
declare global {
  var __lfh_modelLoader: ModelLoader | undefined;
}

// Return the one-and-only loader (the "singleton"). On the server we just make a
// throwaway one. In the browser we stash it on globalThis the first time and
// reuse it forever after — so navigating between pages keeps the same downloads.
function getLoader(): ModelLoader {
  if (typeof window === "undefined") {
    return new ModelLoader();
  }
  if (!globalThis.__lfh_modelLoader) {
    globalThis.__lfh_modelLoader = new ModelLoader();
  }
  return globalThis.__lfh_modelLoader;
}

// This is what the rest of the app imports and uses.
export const modelLoader = getLoader();
