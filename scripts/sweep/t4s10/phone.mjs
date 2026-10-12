// scripts/sweep/t4s10/phone.mjs — a stand-in browser for the guest-side libraries: localStorage and
// sessionStorage (each can be switched off to throw, as private mode does), the address bar, window
// events, document visibility, navigator.onLine and a geolocation that answers what it is told.
export const phone = {
  ls: new Map(), ss: new Map(), lsBlocked: false, ssBlocked: false,
  events: [], path: "/menu", hidden: false, online: true, geo: null,
};
function store(map, blockedKey) {
  return {
    getItem: (k) => { if (phone[blockedKey]) throw new Error("SecurityError: storage disabled"); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (phone[blockedKey]) throw new Error("QuotaExceededError"); map.set(k, String(v)); },
    removeItem: (k) => { if (phone[blockedKey]) throw new Error("SecurityError: storage disabled"); map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    clear: () => map.clear(),
  };
}
const listeners = new Map();
export function install() {
  const win = {
    addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); },
    removeEventListener: (t, fn) => { listeners.get(t)?.delete(fn); },
    dispatchEvent: (e) => { phone.events.push({ type: e.type, detail: e.detail }); for (const fn of [...(listeners.get(e.type) || [])]) fn(e); return true; },
    get location() { return { pathname: phone.path, origin: "http://localhost:4404", href: "http://localhost:4404" + phone.path }; },
  };
  globalThis.window = win;
  globalThis.localStorage = store(phone.ls, "lsBlocked");
  globalThis.sessionStorage = store(phone.ss, "ssBlocked");
  globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  if (typeof globalThis.Event === "undefined") globalThis.Event = class Event { constructor(type) { this.type = type; } };
  globalThis.document = { get hidden() { return phone.hidden; }, addEventListener: win.addEventListener, removeEventListener: win.removeEventListener, getElementById: () => null };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    get onLine() { return phone.online; },
    get geolocation() { return phone.geo; },
  } });
}
export function reset({ path = "/menu" } = {}) {
  phone.ls.clear(); phone.ss.clear(); phone.lsBlocked = false; phone.ssBlocked = false;
  phone.events = []; phone.path = path; phone.hidden = false; phone.online = true; phone.geo = null;
  listeners.clear();
}
export const listenerCount = (t) => (listeners.get(t) ? listeners.get(t).size : 0);
export function uninstall() {
  for (const k of ["window", "localStorage", "sessionStorage", "document", "CustomEvent"]) delete globalThis[k];
}
