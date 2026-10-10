export const AUTH_COOKIE = "lfh_staff_auth";
export async function tokenIsValid(t) { return globalThis.__t18.tokenOk ? globalThis.__t18.tokenOk(t) : false; }
