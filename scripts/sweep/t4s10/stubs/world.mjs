// The stand-in world every bundle shares. Each bundle carries its own copy of these stub modules, so
// the state they read is held on globalThis — scripts/sweep/t4s10/lib.mjs resets it between checks.
export const W = (globalThis.__t4s10 ||= { rpc: {}, rpcLog: [], from: {}, fromLog: [], auth: {}, misc: {} });
