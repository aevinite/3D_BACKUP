// scripts/t30-harness/lib.mjs — the check collector. Each suite takes a fixed id base and numbers its
// checks in the order they are written (APPEND ONLY inside a suite — never reorder, ids are permanent).
export const ROWS = [];
export function suite(file, base, max) {
  let n = base;
  const t = (what, cond, note = "") => {
    if (n > base + max - 1) throw new Error(`${file}: id range P${base}–P${base + max - 1} exhausted`);
    ROWS.push({ id: `P${n++}`, file, what, ok: !!cond, note: String(note ?? "").slice(0, 200) });
  };
  return t;
}
export const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
export const req = (headers = {}, cookies = {}) => {
  const h = new Headers(headers);
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) h.set("cookie", cookie);
  return { headers: h, cookies: { get: (k) => (k in cookies ? { name: k, value: cookies[k] } : undefined) }, clone() { return this; } };
};
