const S = (globalThis.__R4SENTRY ||= { inits: [] });
export function init(o) { S.inits.push(o); }
export const captureRequestError = function captureRequestError() {};
export const captureRouterTransitionStart = function captureRouterTransitionStart() {};
