export class R4Redirect extends Error { constructor(url) { super("redirect " + url); this.url = url; } }
export class R4NotFound extends Error { constructor() { super("notFound"); } }
export function redirect(url) { throw new R4Redirect(url); }
export function permanentRedirect(url) { throw new R4Redirect(url); }
export function notFound() { throw new R4NotFound(); }
export const useRouter = () => ({ push() {}, replace() {}, prefetch() {} });
export const usePathname = () => "/";
export const useSearchParams = () => new URLSearchParams();
