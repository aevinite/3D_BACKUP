// scripts/sweep/t4s10/lab/nav.mjs — next/navigation for the screen lab. The screens only read the path;
// it is the page's own address, exactly what Next would report.
export const usePathname = () => location.pathname;
export const useSearchParams = () => new URLSearchParams(location.search);
export const useParams = () => ({});
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} });
export const redirect = () => {};
export const notFound = () => {};
