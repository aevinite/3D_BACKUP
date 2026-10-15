// scripts/sweep/t3s10/phone.mjs — a fake PHONE for the guest's saved-work queue (lib/guestOutbox.ts).
//
// The real file is bundled and loaded FRESH per scenario, so its module-level queue starts empty. It
// sees: window (events), location, localStorage, sessionStorage, navigator.onLine, a tiny IndexedDB,
// a scripted fetch, and a setTimeout that RECORDS long waits instead of firing them — so a check can
// say "there is a retry timer behind this queue, and it waits N ms" without waiting N ms.
import { fresh } from "./lib.mjs";

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
// Everything the fake phone replaces, so restore() can put the REAL ones back — a live block running
// after this one must get Node's own fetch and timers, not a fake that is still installed.
const REAL = {};
for (const k of ["fetch", "window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator"]) REAL[k] = Object.getOwnPropertyDescriptor(globalThis, k);

function memStorage(failSet = false) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failSet) throw new Error("QuotaExceeded"); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _map: m,
  };
}

/** A minimal IndexedDB: one database of object stores, keyPath "id", async like the real thing. */
function fakeIDB({ failWrites = false, noDatabases = false, preload = null, dbName = "lfh_guest_outbox", failReads = false, databasesThrow = false, failOpen = false } = {}) {
  const dbs = new Map();
  if (preload) dbs.set(dbName, new Map([["orders", new Map(preload.map((r) => [r.id, JSON.parse(JSON.stringify(r))]))]]));
  const opened = [];
  const later = (fn) => realSetTimeout(fn, 0);
  const api = {
    opened,
    _dump: (name = dbName) => [...((dbs.get(name) || new Map()).get("orders") || new Map()).values()],
    open(name, version) {
      opened.push(name); (api.versions ||= []).push(version);
      const req = {};
      later(() => {
        if (failOpen) { req.error = new Error("open failed"); req.onerror && req.onerror(); return; }
        let created = false;
        if (!dbs.has(name)) { dbs.set(name, new Map()); created = true; }
        const stores = dbs.get(name);
        const db = {
          createObjectStore(s) { if (!stores.has(s)) stores.set(s, new Map()); return {}; },
          transaction(s) {
            const tx = {};
            const store = stores.get(s) || new Map();
            const ops = [];
            tx.objectStore = () => ({
              put: (v) => { ops.push(() => store.set(v.id, JSON.parse(JSON.stringify(v)))); },
              delete: (k) => { ops.push(() => store.delete(k)); },
              getAll: () => { const r = {}; later(() => { if (failReads) { r.error = new Error("read failed"); r.onerror && r.onerror(); return; } r.result = [...store.values()].map((x) => JSON.parse(JSON.stringify(x))); r.onsuccess && r.onsuccess(); }); return r; },
            });
            later(() => {
              if (failWrites && ops.length) { tx.error = new Error("QuotaExceededError"); tx.onerror && tx.onerror(); return; }
              for (const o of ops) o();
              tx.oncomplete && tx.oncomplete();
            });
            return tx;
          },
        };
        req.result = db;
        if (created && req.onupgradeneeded) req.onupgradeneeded();
        if (created) stores.set("orders", stores.get("orders") || new Map());
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
  if (!noDatabases) api.databases = async () => { if (databasesThrow) throw new Error("databases() refused"); return [...dbs.keys()].map((name) => ({ name })); };
  return api;
}

/**
 * phone(opts) — install a fresh fake phone and a FRESH copy of lib/guestOutbox.ts.
 *   opts.path        the page the tab is on (default /r/french-house/menu)
 *   opts.online      navigator.onLine (default true)
 *   opts.idb         options for the fake IndexedDB (failWrites, noDatabases, preload — and, round 3,
 *                    failReads, failOpen, databasesThrow)
 *   opts.respond     (url, init, n) => { status, json } | throws — the network
 *   opts.lsFail      localStorage.setItem throws
 *   opts.load        async () => module — load the queue some other way (round 3: the real .ts file)
 */
export async function phone(opts = {}) {
  const listeners = new Map();
  const events = [];
  const win = {
    Worker: class {},   // the realtime client (pulled in through lib/tenant.ts) refuses to load without one
    location: { pathname: opts.path || "/r/french-house/menu" },
    addEventListener: (t, fn) => { (listeners.get(t) || listeners.set(t, new Set()).get(t)).add(fn); },
    removeEventListener: (t, fn) => { listeners.get(t)?.delete(fn); },
    dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); for (const fn of listeners.get(e.type) || []) fn(e); return true; },
  };
  const timers = [];
  globalThis.setTimeout = (fn, ms, ...a) => {
    // unref/ref/refresh: Node's own fetch keeps its connection timers through setTimeout too, and calls
    // these on what it gets back; a recorded timer must look enough like a real one not to break it.
    if ((ms || 0) >= 1000) { const t = { fn, ms, fired: false, cleared: false, unref() { return t; }, ref() { return t; }, refresh() { return t; }, hasRef() { return false; } }; timers.push(t); return t; }
    return realSetTimeout(fn, ms, ...a);
  };
  globalThis.clearTimeout = (t) => { if (t && typeof t === "object" && "ms" in t) t.cleared = true; else realClearTimeout(t); };
  const fetches = [];
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), init, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null, signal: init.signal };
    fetches.push(call);
    const r = opts.respond ? await opts.respond(String(url), init, n++, call) : { status: 200, json: { ok: true, order_id: "ord-" + n } };
    if (r instanceof Error) throw r;
    return new Response(r.raw !== undefined ? r.raw : JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
  globalThis.window = win;
  globalThis.document = { visibilityState: "visible", body: { setAttribute() {}, removeAttribute() {} } };
  globalThis.localStorage = memStorage(!!opts.lsFail);
  globalThis.sessionStorage = memStorage();
  const nav = { onLine: opts.online !== false };
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
  const idb = fakeIDB(opts.idb || {});
  globalThis.indexedDB = idb;
  // opts.load — round 3 hands in a loader for the REAL lib/guestOutbox.ts (./r3/hooks.mjs, so coverage
  // and mutation point at the file itself); without one, the bundle the earlier rounds used.
  const M = opts.load ? await opts.load() : fresh("lib/guestOutbox.ts", "client");
  const settle = (ms = 30) => new Promise((r) => realSetTimeout(r, ms));
  const pending = () => timers.filter((t) => !t.fired && !t.cleared);
  /** Fire the soonest pending long timer (the queue's retry), then let the flush finish. */
  const tick = async () => { const p = pending().sort((a, b) => a.ms - b.ms)[0]; if (!p) return false; p.fired = true; p.fn(); await settle(40); return true; };
  const emit = (type) => { for (const fn of listeners.get(type) || []) fn({ type }); };
  return {
    M, win, events, timers, pending, tick, settle, fetches, idb, nav, emit, listeners,
    ls: globalThis.localStorage,
    setOnline: (v) => { nav.onLine = v; },
    restore() {
      globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
      for (const [k, d] of Object.entries(REAL)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    },
  };
}

/** The queue as the screen reads it — the same snapshot the badge and the saved-orders chip render. */
export const lists = (P) => P.M.useGuestOutbox();
