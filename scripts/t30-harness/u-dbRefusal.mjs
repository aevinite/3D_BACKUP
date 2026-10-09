// lib/dbRefusal.ts — every code, every pattern alternative, every function branch.
import { suite } from "./lib.mjs";
const t = suite("lib/dbRefusal.ts", 168561, 140);
const D = await import("@/lib/dbRefusal.ts");
// our own codes
for (const [c, word] of [["LFH01", /credit note/], ["LFH02", /bill total/], ["LFH03", /reason is required/], ["LFH04", /no sale to reopen/]]) {
  t(`${c}: answers 409 with its own sentence`, D.refusalStatus({ code: c }) === 409 && word.test(D.refusalMessage({ code: c, message: "lfh: …" })));
}
t("LFH03 from the reopen ('another party is sitting') → 'has to be free', not 'say why'", /has to be free/.test(D.refusalMessage({ code: "LFH03", message: "lfh: another party is sitting at that table" })));
t("ownRefusalCode: our codes → the code; anything else → null", D.ownRefusalCode({ code: "LFH02" }) === "LFH02" && D.ownRefusalCode({ code: "23514" }) === null && D.ownRefusalCode(null) === null && D.ownRefusalCode({}) === null);
// data refusals by code
for (const c of ["22001", "22003", "22007", "22P02", "23502", "23503", "23505", "23514", "23P01"]) t(`SQLSTATE ${c} is a refusal of the VALUE → 400`, D.isDataRefusal({ code: c }) && D.refusalStatus({ code: c }) === 400);
// data refusals by prose only
for (const m of ['violates check constraint "x"', 'violates unique constraint "x"', 'violates foreign key constraint "x"', 'violates not-null constraint', 'violates exclusion constraint "x"', 'invalid input syntax for type uuid: "x"', "value too long for type character varying(10)", "integer out of range", "numeric field overflow"]) {
  t(`prose '${m.slice(0, 32)}…' with no code is a refusal → 400`, D.isDataRefusal({ message: m }) && D.refusalStatus({ message: m }) === 400);
}
t("a refusal hidden in .details (not .message) is still seen", D.isDataRefusal({ message: "x", details: "violates check constraint" }));
// missing row
t("isMissingRow: PGRST116 with 'contains 0 rows' → true", D.isMissingRow({ code: "PGRST116", details: "The result contains 0 rows" }));
t("isMissingRow: PGRST116 with 'contain 0 rows' (singular verb) → true", D.isMissingRow({ code: "PGRST116", details: "Results contain 0 rows" }));
t("isMissingRow: PGRST116 with 2 rows → false (a duplicate is a real fault)", !D.isMissingRow({ code: "PGRST116", details: "The result contains 2 rows" }));
t("isMissingRow: PGRST116 with no details → false; another code → false; null → false", !D.isMissingRow({ code: "PGRST116" }) && !D.isMissingRow({ code: "X", details: "contains 0 rows" }) && !D.isMissingRow(null));
t("a missing row → 404, 'That's not there any more…', and NOT worth a crash row", D.refusalStatus({ code: "PGRST116", details: "contains 0 rows" }) === 404 && /not there any more/.test(D.refusalMessage({ code: "PGRST116", details: "contains 0 rows" })) && D.worthLogging({ code: "PGRST116", details: "contains 0 rows" }) === false);
t("a missing row is a data refusal, never 'unreachable'", D.isDataRefusal({ code: "PGRST116", details: "contains 0 rows" }) && !D.isDbUnreachable({ code: "PGRST116", details: "contains 0 rows" }));
// unreachable by code / name / cause / prose
for (const c of ["57014", "08000", "08001", "08003", "08004", "08006", "53100", "53200", "53300", "55P03", "40001", "40P01", "57P01", "57P02", "57P03"]) t(`SQLSTATE ${c} = the database did not answer → 503`, D.isDbUnreachable({ code: c }) && D.refusalStatus({ code: c }) === 503);
for (const n of ["TimeoutError", "AbortError", "ConnectTimeoutError", "HeadersTimeoutError", "BodyTimeoutError"]) t(`an error named ${n} → 503`, D.isDbUnreachable({ name: n }));
t("the reason hidden on .cause.name → 503", D.isDbUnreachable({ message: "x", cause: { name: "TimeoutError" } }));
t("the reason hidden on .cause.code (a SQLSTATE) → 503", D.isDbUnreachable({ message: "x", cause: { code: "57P01" } }));
t("the reason hidden on .cause.code (ECONNRESET) → 503", D.isDbUnreachable({ message: "fetch failed", cause: { code: "ECONNRESET" } }));
t("the reason hidden in .cause.message → 503", D.isDbUnreachable({ message: "x", cause: { message: "socket hang up" } }));
for (const m of ["canceling statement due to statement timeout", "The operation was aborted", "aborted due to timeout", "fetch failed", "socket hang up", "read ECONNRESET", "connect ECONNREFUSED", "ETIMEDOUT", "getaddrinfo ENOTFOUND", "EAI_AGAIN", "write EPIPE", "connection refused", "connection reset by peer", "connection closed", "connection terminated unexpectedly", "connection timed out", "sorry, too many clients already", "too many connections", "server closed the connection unexpectedly", "upstream request timeout", "Gateway Timeout", "gateway time-out", "Service Unavailable", "temporarily unavailable", "Bad Gateway", "Web server is down", "Origin is unreachable", "502: Bad gateway", "504: x", "522: x", "523: x", "524: x"]) {
  t(`'${m}' → the busy reply (503)`, D.isDbUnreachable({ message: m }) && D.refusalStatus({ message: m }) === 503 && D.refusalMessage({ message: m }) === D.BUSY_MESSAGE);
}
t("'500: x' (a server error page) is NOT 'busy' — a bug is never dressed up as busy", !D.isDbUnreachable({ message: "500: internal" }));
t("XX000 internal_error stays a 500 (deliberately not 'busy')", D.refusalStatus({ code: "XX000", message: "internal" }) === 500);
t("an unknown error → the caller's fallback status", D.refusalStatus(new Error("boom")) === 500 && D.refusalStatus(new Error("boom"), 418) === 418);
t("refusalStatus(null / undefined / a string) does not crash", D.refusalStatus(null) === 500 && D.refusalStatus(undefined) === 500 && D.refusalStatus("x") === 500);
t("a value refusal is decided BEFORE unreachable (a constraint error is never retried)", !D.isDbUnreachable({ code: "23514", message: "statement timeout" }));
t("worthLogging is true for everything but the missing row (a busy database IS still logged)", D.worthLogging({ code: "57014" }) && D.worthLogging({ code: "23514" }) && D.worthLogging(new Error("x")) && D.worthLogging(null));
// messages
t("refusalMessage: the named floor constraint gets its own sentence (2 to 30)", /between 2 and 30/.test(D.refusalMessage({ code: "23514", message: 'new row for relation "settings" violates check constraint "settings_floor_per_row_range"' })));
t("refusalMessage: unique → 'Something with that name or number already exists.'", D.refusalMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' }) === "Something with that name or number already exists.");
t("refusalMessage: foreign key → 'That refers to something that no longer exists…'", /no longer exists/.test(D.refusalMessage({ code: "23503", message: 'insert or update violates foreign key constraint "x"' })));
t("refusalMessage: not-null → 'Something required was left empty.'", D.refusalMessage({ code: "23502", message: 'null value violates not-null constraint "x"' }) === "Something required was left empty.");
t("refusalMessage: any other refusal → 'That value isn't allowed here.'", D.refusalMessage({ code: "22P02", message: 'invalid input syntax for type uuid: "x"' }) === "That value isn't allowed here.");
t("refusalMessage: an app bug keeps its own message (the error board reads it)", D.refusalMessage(new Error("boom 42")) === "boom 42" && D.refusalMessage({ message: "plain" }) === "plain");
t("refusalMessage: a non-Error with no message → its text; null → ''", D.refusalMessage("just text") === "just text" && D.refusalMessage(null) === "");
t("BUSY_MESSAGE never blames the person's internet", !/internet|wifi|your connection/i.test(D.BUSY_MESSAGE));
// pgError
{ const e = D.pgError({ message: "m", code: "23514", details: "d", hint: "h" }); t("pgError keeps message, code, details and hint, as a real Error", e instanceof Error && e.message === "m" && e.code === "23514" && e.details === "d" && e.hint === "h"); }
{ const e = D.pgError({ code: "57014" }); t("pgError with no message says 'database error' and keeps the code", e.message === "database error" && e.code === "57014"); }
{ const e = D.pgError({ message: 42 }); t("pgError with a non-text message turns it into text", e.message === "42"); }
{ const e = D.pgError(null); t("pgError(null) is a plain 'database error' with no code", e.message === "database error" && !("code" in e)); }
{ const e = D.pgError({ message: "m" }); t("pgError adds no code/details/hint keys that were not there", !("code" in e) && !("details" in e) && !("hint" in e)); }
t("a rethrown pgError is still classified correctly (the point of keeping the code)", D.refusalStatus(D.pgError({ message: "x", code: "23514" })) === 400 && D.refusalStatus(D.pgError({ message: "x", code: "57014" })) === 503);
// round-2 mutation survivors, closed
t("a cause whose NAME is ordinary ('Error') is not 'busy' — only the timeout names are", D.refusalStatus({ message: "something odd", cause: { name: "Error" } }) === 500);
t("a cause whose CODE is ordinary ('ABC') is not 'busy' — only the listed codes are", D.refusalStatus({ message: "something odd", cause: { code: "ABC" } }) === 500);
