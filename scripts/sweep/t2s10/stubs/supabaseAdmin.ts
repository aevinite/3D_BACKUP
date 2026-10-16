// Test stand-in for lib/supabaseAdmin: whatever the check installs on globalThis.__t2FakeSb.
export const supabaseAdmin: any = new Proxy({}, { get: (_t, k) => (globalThis as any).__t2FakeSb[k] });
