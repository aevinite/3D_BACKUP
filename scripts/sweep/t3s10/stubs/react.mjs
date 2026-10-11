// Stand-in for React's one hook lib/guestOutbox.ts uses, so the queue's PUBLIC snapshot (what the
// badge and the saved-orders chip render from) can be read outside a component: subscribe, then
// hand back exactly what getSnapshot returns.
export function useSyncExternalStore(subscribe, getSnapshot) { subscribe(() => {}); return getSnapshot(); }
const React = { useSyncExternalStore };
export default React;
