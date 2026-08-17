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
  // original URL -> { the local blob: link we made, and how many BYTES it cost }.
  // The size rides along because the cache is budgeted in bytes, not in entries — see MAX_BYTES.
  private loaded = new Map<string, { blob: string; size: number }>();
  // The one URL we are downloading right this moment (or null if idle).
  private inFlight: string | null = null;
  // A handle on that download so it can be CALLED OFF. Clearing the queue was never
  // enough on its own: a restaurant with 3D switched off still finished whichever GLB
  // had already started, because the menu can only learn the real switch value one beat
  // after mount (guest sweep 2026-08-04). ~2 MB per fresh page load, for a feature the
  // restaurant does not have.
  private inFlightAbort: AbortController | null = null;
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
  // HOW MUCH MEMORY THE CACHE MAY HOLD — in BYTES, not in entries.
  //
  // This used to be "at most 10 models". The cap exists to stop a guest browsing many 3D dishes
  // from piling up blobs until a cheaper phone kills the tab — and counting files cannot do that
  // job, because the models are not the same size: a small one is ~2 MB and an optimized one up to
  // ~9 MB, so ten entries was anywhere between ~20 MB and ~90 MB. The budget below is the number
  // that actually matters to the phone. (T1 improvement 11, 2026-08-07.)
  //
  // 40 MB is deliberately roomy: the two tiers of the dish on screen (~2 MB + ~9 MB) plus a
  // handful of neighbours the guest may go back to. `blob.size` is exact — no estimating.
  private static MAX_BYTES = 40 * 1024 * 1024;
  // A SECOND, much looser guard on the COUNT, so a menu of unusually tiny models can't grow the
  // Map (and its LRU bookkeeping) without limit while staying under the byte budget.
  private static MAX_CACHED = 24;
  // Running total of the sizes in `loaded`, so evicting never has to add them all up again.
  private bytes = 0;
  // WHAT SOMEBODY ACTUALLY ASKED FOR, last time they asked. Written by setQueue/prioritize and
  // CLEARED by stopAll() — see retryFailedOnReconnect() below for why that clearing is the whole
  // safety of this. It is a list of URLs, not a promise to download them.
  private wanted: string[] = [];
  // A reconnect must not turn into a retry storm: at most one sweep per this many ms. `focus` and
  // `visibilitychange` both fire on an ordinary phone unlock, and a model that is genuinely missing
  // would otherwise be re-requested on every one of them.
  private static RECONNECT_COOLDOWN_MS = 60_000;
  private lastReconnectTry = 0;

  // Has this model already finished downloading? (true/false)
  isLoaded(url: string | null | undefined): boolean {
    if (!url) return false;
    return this.loaded.has(url);
  }

  // Give back the ready-to-use local blob: link for a model, or null if we don't
  // have it yet. The viewer uses this instead of re-downloading the big file.
  getCachedUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const hit = this.loaded.get(url);
    if (hit === undefined) return null; // not downloaded yet
    // Mark as most-recently-used (delete + re-add moves it to the end of the Map)
    // so the model on screen is never the one the LRU evicts.
    this.loaded.delete(url);
    this.loaded.set(url, hit);
    return hit.blob;
  }

  // Drop the least-recently-used models once we're over the cap, freeing their
  // blob memory (revokeObjectURL) so long browsing sessions don't grow forever.
  private evictIfNeeded() {
    // Over the memory budget OR over the loose entry guard → drop the least-recently-used until
    // both are satisfied. ALWAYS keep at least one entry: the model on screen is the most recent,
    // and evicting it would make the viewer re-download the file it is currently displaying.
    while (
      this.loaded.size > 1 &&
      (this.bytes > ModelLoader.MAX_BYTES || this.loaded.size > ModelLoader.MAX_CACHED)
    ) {
      const oldest = this.loaded.keys().next().value as string | undefined; // first = LRU
      if (!oldest) break;
      const hit = this.loaded.get(oldest);
      this.loaded.delete(oldest);
      this.attempts.delete(oldest);
      if (hit) {
        this.bytes -= hit.size;
        try { URL.revokeObjectURL(hit.blob); } catch {}
      }
    }
    if (this.bytes < 0) this.bytes = 0; // belt and braces; a negative budget would disable eviction
  }

  // Have we permanently given up on this model (out of retries)? The viewer uses
  // this to swap its "still preparing…" overlay for a real "3D unavailable"
  // message instead of promising a load that will never come (audit fix bug #10).
  hasFailed(url: string | null | undefined): boolean {
    if (!url) return false;
    return this.failed.has(url);
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
    this.wanted = all.filter(Boolean); // remember the ask, so a reconnect can revive a write-off
    this.start(); // kick off downloading if we aren't already
  }

  /**
   * A DROPPED SIGNAL IS NOT A BROKEN DISH (guest sweep T1, 2026-08-16 — improvement I1).
   *
   * A model gets MAX_ATTEMPTS (2) goes, RETRY_DELAY_MS (6s) apart, and then lands in `failed`,
   * which nothing ever cleared for the life of the tab. So a phone handing over between Wi-Fi and
   * mobile data inside those few seconds wrote the dish off permanently: the viewer switched to
   * "3D view isn't ready for this dish" (it asks hasFailed()) and kept saying it after the
   * connection was perfect again. The only cure was reloading the page, which a diner has no
   * reason to think of — and the 3D dish is the one thing this product is sold on.
   *
   * WHY THIS RE-QUEUES `wanted` AND NOT `failed`. Re-queueing everything ever given up on would
   * spend model bytes for a restaurant that has 3D switched OFF: that path calls stopAll(), which
   * empties the queue and calls off the download in flight. So stopAll() clears `wanted` too, and
   * this only ever revives what the CURRENT page last asked for. A 3D-off restaurant asks for
   * nothing, so nothing is revived — the switch stays honest.
   *
   * Throttled (RECONNECT_COOLDOWN_MS) because `online`, `focus` and `visibilitychange` all fire on
   * one phone unlock, and a model that is genuinely missing from storage 404s instantly — cheap,
   * but not something to repeat on every glance at the screen.
   */
  retryFailedOnReconnect() {
    if (!this.failed.size || !this.wanted.length) return;
    const now = Date.now();
    if (now - this.lastReconnectTry < ModelLoader.RECONNECT_COOLDOWN_MS) return;
    this.lastReconnectTry = now;
    let revived = 0;
    for (const u of this.wanted) {
      if (!this.failed.has(u)) continue;
      this.failed.delete(u);      // hasFailed() goes back to false → the viewer stops saying "not ready"
      this.attempts.delete(u);    // a fresh go really is a fresh go, not one last attempt
      if (this.loaded.has(u) || u === this.inFlight || this.queue.includes(u)) continue;
      this.queue.push(u);
      revived++;
    }
    if (revived) this.start();
    else this.notify(); // nothing to fetch, but the "unavailable" message may still need to clear
  }

  // STOP EVERYTHING — used when a restaurant turns out to have 3D switched off. Empties
  // the waiting line and calls off the download already in flight, so no model bytes are
  // spent on a feature that is not enabled.
  //
  // An aborted fetch lands in pump()'s catch, which recognises the AbortError and records
  // NOTHING against the model — no attempt, no failure. That correction matters: while the abort
  // was counted as an attempt, two aborts in one tab (bounce between a 3D restaurant and a non-3D
  // one twice) marked the model permanently `failed` and it never loaded again until a reload.
  // See the long note at that catch.
  stopAll() {
    this.queue = [];
    // …and forget what was asked for, so retryFailedOnReconnect() can never revive a download for a
    // restaurant that has just told us it does not have this feature.
    this.wanted = [];
    if (this.inFlightAbort) {
      try { this.inFlightAbort.abort(); } catch {}
      this.inFlightAbort = null;
    }
    this.notify();
  }

  // Jump certain models to the FRONT of the line — e.g. when a guest opens a
  // specific dish, we want its model first. Same de-duplicating rules as above.
  prioritize(urls: string[]) {
    const toPrepend: string[] = [];
    const seen = new Set<string>();
    // The dish page is ASKING for these, whether or not they are downloadable right now — so they
    // join `wanted` even when the loop below skips them for being already loaded or written off.
    // That is what lets a reconnect revive the model of the dish the diner is actually looking at.
    for (const u of urls) if (u && !this.wanted.includes(u)) this.wanted.push(u);
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
      // A fresh controller per download, so stopAll() can call off exactly this one.
      // AbortController is guarded the same way the order deadline is (lib/menu.ts):
      // reading it on an old phone must never break a download that would have worked.
      let ac: AbortController | null = null;
      try { ac = typeof AbortController !== "undefined" ? new AbortController() : null; } catch { ac = null; }
      this.inFlightAbort = ac;
      this.notify();
      let ok = false; // did this download succeed?
      // WAS THIS DOWNLOAD CALLED OFF BY US, or did it genuinely fail? The two must not be
      // counted together — see the note at the `catch` below.
      let calledOff = false;
      try {
        // Actually fetch the file. "cors"/"omit" = cross-site read, no cookies sent.
        const res = await fetch(url, { mode: "cors", credentials: "omit", ...(ac ? { signal: ac.signal } : {}) });
        if (res.ok) {
          // Turn the downloaded bytes into a blob, then a local blob: URL the
          // <model-viewer> can read instantly — this is the "download once" magic.
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          this.loaded.set(url, { blob: blobUrl, size: blob.size });
          this.bytes += blob.size;
          this.evictIfNeeded(); // keep memory bounded on long browsing sessions
          ok = true;
        } else {
          // Server answered, but with an error code (e.g. 404). Log a gentle warning.
          console.warn("Model preload non-OK", url, res.status);
        }
      } catch (e) {
        // CALLING A DOWNLOAD OFF IS NOT THE SAME AS IT FAILING (guest sweep T1, 2026-08-12).
        //
        // stopAll() aborts the fetch in flight, and that abort lands right here. It used to be
        // counted as one failed ATTEMPT, exactly like a dead network — and with MAX_ATTEMPTS = 2
        // that meant the SECOND abort moved the model into `failed`, which nothing ever clears for
        // the life of the tab. The comment on stopAll() promised the opposite ("if 3D is on again
        // later the retry path is unchanged"); it was unchanged after one abort, not two.
        //
        // Measured with a mocked fetch: queue → stopAll → re-queue loaded fine; queue → stopAll →
        // queue → stopAll → re-queue never fetched again. Reachable by moving between a restaurant
        // with 3D on and one with it off in the same tab twice: the first restaurant's 3D dish then
        // showed "3D view isn't ready for this dish" until a reload.
        //
        // We asked for it to stop, so it owes us nothing: leave `attempts` alone and let whoever
        // re-queues it try again with a clean slate. A genuine network failure still counts.
        const aborted = !!(e && typeof e === "object" && (e as { name?: string }).name === "AbortError");
        if (aborted) {
          calledOff = true;
        } else {
          // Network blew up entirely (offline, blocked, etc.).
          console.warn("Model preload failed", url, e);
        }
      }
      this.inFlight = null; // we're no longer downloading this one
      this.inFlightAbort = null;
      if (ok) {
        // Success: forget any past failed attempts and announce it loaded.
        this.attempts.delete(url);
        this.dispatch("lfh:model-loaded", url);
      } else if (calledOff) {
        // WE stopped it. Not a failure, not an attempt, and nothing to announce — the queue is
        // already empty (stopAll cleared it) and the switch that stopped us decides what happens
        // next. Deliberately no retry timer either: re-queueing behind a switch that is OFF is
        // exactly the wasted download stopAll() exists to prevent.
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
    const loader = new ModelLoader();
    globalThis.__lfh_modelLoader = loader;
    // THE THREE MOMENTS A PHONE COMES BACK. `online` is the browser admitting it; `focus` is the
    // diner unlocking the phone with this tab already open (which does NOT fire visibilitychange);
    // `visibilitychange` is them switching back to the tab. The same three the guest order queue
    // listens to (lib/guestOutbox.ts) — a saved order and a written-off model are the same story:
    // something the connection took away and the connection can give back.
    //
    // Wired ONCE here, on the singleton, rather than in a component: the loader outlives every page
    // (that is the point of keeping it on globalThis), and a per-component listener would be added
    // and removed on every navigation.
    const wake = () => loader.retryFailedOnReconnect();
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  }
  return globalThis.__lfh_modelLoader;
}

// This is what the rest of the app imports and uses.
export const modelLoader = getLoader();
