// THE THREE ADMIN DOORS RETIRED ON 2026-10-12 (sweep #10 T29 round 2, item 13) — one list, read by every guard that
// still names them so their phase ids never move. Each of those guards SKIPS a phase while the file is gone and
// verify:admin-routes-t29 asserts they STAY gone. Written as an explained list (`paths: [ … ], why:` on one line) so
// verify:guards-alive reads it as an obituary, not as a script pointing at a file that has rotted away.
export const RETIRED_ADMIN_DOORS = { paths: ["app/api/admin/restaurants/google-review/route.ts", "app/api/admin/restaurants/platform-channels/route.ts", "app/api/admin/restaurants/staff-features/route.ts"], why: "retired 2026-10-12 — Access & permissions does all three jobs (a new way replaces the old one)" };
export const [GOOGLE_REVIEW_DOOR, PLATFORM_CHANNELS_DOOR, STAFF_FEATURES_DOOR] = RETIRED_ADMIN_DOORS.paths;
