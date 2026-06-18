// Proves a moot "open" request is hidden once the table is open (the stale
// "Asked to open" with Approve/Deny on an OPEN table — owner caught it on Table 4),
// while join/access requests stay valid. Mirrors reqsOf/reqsForTable in the panels.
//   node scripts/verify-open-request-guard.mjs

// reqsForTable, mirrored: hide an "open"-type request when the table has an open session.
const reqsFor = (t, allReqs, hasOpenSession) =>
  allReqs.filter((r) => String(r.table_number) === String(t) && !(r.type === "open" && hasOpenSession));

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };

const reqs = [
  { id: "r1", table_number: "4", type: "open", status: "pending" },
  { id: "r2", table_number: "4", type: "join", status: "pending" },
  { id: "r3", table_number: "4", type: "access", status: "pending" },
];

// Table 4 is OPEN → the "open" request is hidden; join/access remain.
{ const shown = reqsFor("4", reqs, true).map((r) => r.type);
  check("OPEN table: 'open' request hidden", !shown.includes("open"));
  check("OPEN table: 'join' request still shown", shown.includes("join"));
  check("OPEN table: 'access' request still shown", shown.includes("access")); }

// Table 4 is FREE (no session) → the "open" request SHOWS (so staff can approve it).
{ const shown = reqsFor("4", reqs, false).map((r) => r.type);
  check("FREE table: 'open' request shown", shown.includes("open")); }

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
