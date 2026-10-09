const R = (globalThis.__R4 ||= { cookies: {}, headers: {} });
const jar = (o) => ({ get: (n) => (o[n] !== undefined ? { name: n, value: o[n] } : undefined), getAll: () => Object.entries(o).map(([name, value]) => ({ name, value })), has: (n) => o[n] !== undefined });
export async function cookies() { return jar(R.cookies); }
export async function headers() { return { get: (n) => R.headers[n.toLowerCase()] ?? null }; }
