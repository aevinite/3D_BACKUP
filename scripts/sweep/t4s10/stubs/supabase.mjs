// Stand-in for lib/supabase.ts (the browser's public-key client). W.rpc[fn] is an answer object
// ({ data, error }), a function (args) => answer, or a Promise; absent = { data: { ok: true } }.
// .abortSignal(signal) is honoured: an already-aborted signal answers like a real aborted fetch.
import { W } from "./world.mjs";
function answer(fn, args, signal) {
  W.rpcLog.push({ fn, args: JSON.parse(JSON.stringify(args || {})), signal: !!signal });
  if (signal && signal.aborted) return Promise.resolve({ data: null, error: { message: "AbortError: signal is aborted without reason" } });
  const a = W.rpc[fn];
  const v = typeof a === "function" ? a(args, signal) : a;
  if (v === undefined) return Promise.resolve({ data: { ok: true }, error: null });
  return Promise.resolve(v);
}
export const supabase = {
  rpc(fn, args) {
    let sig;
    const p = { abortSignal(s) { sig = s; return p; }, then(res, rej) { return answer(fn, args, sig).then(res, rej); } };
    return p;
  },
  from() { throw new Error("stand-in: the guest client must not read a table directly"); },
  channel() { return { on() { return this; }, subscribe() { return this; } }; },
  removeChannel() {},
};
