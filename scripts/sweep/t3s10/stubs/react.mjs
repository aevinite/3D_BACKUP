// Stand-in for React's one hook lib/guestOutbox.ts uses, so the queue's PUBLIC snapshot (what the
// badge and the saved-orders chip render from) can be read outside a component: subscribe, then
// hand back exactly what getSnapshot returns.
// Round 3: `globalThis.__T3_SSR = true` answers as React does while rendering on the SERVER — the third
// argument, getServerSnapshot, and no subscription.
export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) { if (globalThis.__T3_SSR && getServerSnapshot) return getServerSnapshot(); subscribe(() => {}); return getSnapshot(); }
const React = { useSyncExternalStore };
export default React;
