"use client";

interface WatchEntry {
  folder: string;
  title: string;
  slug?: string;
  smallUrl?: string;
  optimizedUrl?: string;
}

class ModelWatchlist {
  private byFolder = new Map<string, WatchEntry>();

  watch(entry: WatchEntry) {
    this.byFolder.set(entry.folder, entry);
  }

  unwatchByFolder(folder: string) {
    this.byFolder.delete(folder);
  }

  findByUrl(url: string): WatchEntry | null {
    for (const e of this.byFolder.values()) {
      if (e.smallUrl === url || e.optimizedUrl === url) return e;
    }
    return null;
  }
}

declare global {
  var __lfh_modelWatchlist: ModelWatchlist | undefined;
}

function getWatchlist(): ModelWatchlist {
  if (typeof window === "undefined") return new ModelWatchlist();
  if (!globalThis.__lfh_modelWatchlist) {
    globalThis.__lfh_modelWatchlist = new ModelWatchlist();
  }
  return globalThis.__lfh_modelWatchlist;
}

export const modelWatchlist = getWatchlist();
