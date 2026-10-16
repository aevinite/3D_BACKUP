// scripts/sweep/t4s10/lab/nav.mjs — next/navigation for the screen lab. The screens only read the path;
// it is the page's own address, exactly what Next would report.
// …and it CHANGES on an in-app move, as Next's does: window.__labGo(path) pushes the address and every
// screen reading it re-renders (2026-10-16 — needed to see a context leave "ready" on a client-side move).
import { useSyncExternalStore } from "react";
const subscribe = (cb) => { window.addEventListener("lab:nav", cb); return () => window.removeEventListener("lab:nav", cb); };
window.__labGo = (path) => { history.pushState(null, "", path); window.dispatchEvent(new Event("lab:nav")); };
export const usePathname = () => useSyncExternalStore(subscribe, () => location.pathname, () => location.pathname);
export const useSearchParams = () => new URLSearchParams(location.search);
export const useParams = () => ({});
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} });
export const redirect = () => {};
export const notFound = () => {};
