"use client"; // runs in the browser

// This is the small companion to modelLoader. Its job: remember which dishes a
// guest actually tried to view in 3D BEFORE the model finished downloading. That
// way, when a model finally loads or fails, we only pop a toast for those guests
// — not for everyone whose model quietly preloaded in the background.

// What we remember about one dish on the watchlist: which folder/dish it is, its
// name, and the two model URLs (small + optimized) so we can match either one.
// The "?" means the field is optional.
interface WatchEntry {
  folder: string;
  title: string;
  slug?: string;
  smallUrl?: string;
  optimizedUrl?: string;
}

// The worker that holds the watchlist. Like modelLoader, there's only one shared
// instance for the whole app (see getWatchlist at the bottom).
class ModelWatchlist {
  // Lookup table keyed by folder name -> what we know about that dish.
  private byFolder = new Map<string, WatchEntry>();

  // Add (or update) a dish on the watchlist — call this when a guest taps "View in 3D".
  watch(entry: WatchEntry) {
    this.byFolder.set(entry.folder, entry);
  }

  // Remove a dish from the watchlist (e.g. once we've shown its toast).
  unwatchByFolder(folder: string) {
    this.byFolder.delete(folder);
  }

  // Given a model URL that just loaded/failed, find which watched dish it belongs
  // to (matching either the small or optimized link). Returns null if nobody's waiting.
  findByUrl(url: string): WatchEntry | null {
    for (const e of this.byFolder.values()) {
      if (e.smallUrl === url || e.optimizedUrl === url) return e;
    }
    return null;
  }
}

// Tell TypeScript a single shared watchlist may live on the global object.
declare global {
  var __lfh_modelWatchlist: ModelWatchlist | undefined;
}

// Return the one-and-only watchlist (the "singleton"), same pattern as the loader:
// a throwaway on the server, a reused-forever one stashed on globalThis in the browser.
function getWatchlist(): ModelWatchlist {
  if (typeof window === "undefined") return new ModelWatchlist();
  if (!globalThis.__lfh_modelWatchlist) {
    globalThis.__lfh_modelWatchlist = new ModelWatchlist();
  }
  return globalThis.__lfh_modelWatchlist;
}

// This is what the rest of the app imports and uses.
export const modelWatchlist = getWatchlist();
