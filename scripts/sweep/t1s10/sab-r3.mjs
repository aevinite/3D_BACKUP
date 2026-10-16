// scripts/sweep/t1s10/sab-r3.mjs — the round-3 sabotage rows that need the APP REBUILT with the sabotage in.
//   node scripts/sweep/t1s10/sab-r3.mjs <out.json>
// Part 1 (no rebuild): middleware.ts deleted / made permanent / widened — verify:notfound reads that file itself.
// Part 2 (one rebuild): five 404 sabotages applied together, the app rebuilt and served on :4401 by THIS script,
// verify:notfound run against it, each failure matched to the sabotage that caused it. Every file is put back in a
// `finally` and on SIGINT/SIGTERM; the script refuses to start if any target file already differs from HEAD.
// It leaves NO server running — the caller rebuilds and restarts the real one afterwards.
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { ROOT } from "./lib.mjs";

const OUT = process.argv[2]; if (!OUT) { console.error("usage: sab-r3.mjs <out.json>"); process.exit(2); }
const MID = "middleware.ts", NF = "app/not-found.tsx", GNF = "components/GuestNotFound.tsx";
const dirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", MID, NF, GNF], { encoding: "utf8" }).trim();
if (dirty) { console.error("refusing: a target file already differs from HEAD:\n" + dirty); process.exit(2); }
const orig = Object.fromEntries([MID, NF, GNF].map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
const restore = () => { for (const [f, t] of Object.entries(orig)) writeFileSync(join(ROOT, f), t); };
let server = null;
const stop = () => { try { server?.kill("SIGTERM"); } catch { /* gone */ } };
for (const s of ["SIGINT", "SIGTERM"]) process.once(s, () => { stop(); restore(); process.exit(130); });
const guard = (args) => { try { return { code: 0, out: execFileSync("node", [join(ROOT, "scripts/verify-notfound-audience.mjs"), ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900000 }) }; } catch (e) { return { code: e.status || 1, out: String(e.stdout || "") + String(e.stderr || "") }; } };
const sub = (f, a, b) => { const t = readFileSync(join(ROOT, f), "utf8"); if (!t.includes(a)) throw new Error(`sabotage target not found in ${f}: ${a.slice(0, 50)}`); writeFileSync(join(ROOT, f), t.replace(a, b)); };
const res = {};
try {
  // ── Part 1: the middleware, read by the guard straight off the disk ──
  rmSync(join(ROOT, MID));
  let g = guard(["--base", "http://localhost:4401"]); restore();
  res.P97768 = { code: g.code, hit: /middleware\.ts is gone/.test(g.out) };
  res.P97778 = { code: g.code, hit: /middleware\.ts is gone/.test(g.out) };
  sub(MID, "NextResponse.redirect(new URL(to, req.nextUrl.origin), 307)", "NextResponse.redirect(new URL(to, req.nextUrl.origin), 308)");
  g = guard(["--base", "http://localhost:4401"]); restore();
  res.P97769 = { code: g.code, hit: /hop is not temporary/.test(g.out) };
  sub(MID, 'matcher: ["/r/:path*", "/q/:path*"]', 'matcher: ["/:path*"]');
  g = guard(["--base", "http://localhost:4401"]); restore();
  res.P97770 = { code: g.code, hit: /no longer scoped to the two guest doors/.test(g.out) };
  // ── Part 2: five sabotages, one rebuild ──
  sub(GNF, ".gnf .stamp { position: absolute; right: -6px; top: 34px;", ".gnf .stamp { position: absolute; right: -6px; bottom: 10px;");            // P97739 CLOSED back over the words
  sub(NF, ".nf-g .stamp { position: absolute; right: -6px; top: 34px;", ".nf-g .stamp { position: absolute; right: -6px; bottom: 10px;");          // P97740 VOID back over the words
  sub(NF, "@keyframes nfDrop", ".nf-s .again .slice { animation: none }\n@keyframes nfDrop");                                                      // P97741 a dead rule back in
  sub(NF, 'if (STAFF_WORDS.test(p)) return { aud: "staff", slug: "", href: "/", label: "Go to the home screen" };', "");                         // P97737 staff now gets the guest screen
  sub(NF, 'if (/^\\/(menu|item)(\\/|$)/.test(p)) return { aud: "guest", slug: "", href: "/menu", label: "Go to the menu" };', 'if (/^\\/(menu|item)(\\/|$)/.test(p)) return { aud: "guest", slug: "", href: "/", label: "Go to the menu" };'); // P97738 the diner's way out → the staff door
  try { execFileSync("lsof", ["-nP", "-iTCP:4401", "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).forEach((pid) => { const cwd = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8" }); if (cwd.includes(ROOT)) process.kill(Number(pid), "SIGTERM"); }); } catch { /* nothing listening */ }
  execFileSync("npx", ["next", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 1200000 });
  server = spawn("npx", ["next", "start", "-p", "4401"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { await new Promise((s) => setTimeout(s, 1000)); try { const r = await fetch("http://localhost:4401/login"); if (r.ok) break; } catch { /* not yet */ } }
  g = guard(["--base", "http://localhost:4401"]);
  res.P97737 = { code: g.code, hit: /converged on the same screen|shows the guest screen, not the staff one|shows the guest screen/.test(g.out) };
  res.P97738 = { code: g.code, hit: /way out points at \/,|offers a way out that is not a menu/.test(g.out) };
  res.P97739 = { code: g.code, hit: /stamp covers words on the docket/.test(g.out) && /(wrong|unknown|MENU|restaurant)/i.test(g.out) };
  res.P97740 = { code: g.code, hit: /stamp covers words on the docket/.test(g.out) };
  res.P97741 = { code: g.code, hit: /rule\(s\) in the 404's stylesheet match nothing at all/.test(g.out) };
  res.part2 = g.out.split("\n").filter((l) => /❌|✗|FAIL|failed/.test(l)).slice(0, 20);
} finally {
  stop(); restore();
  const left = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", MID, NF, GNF], { encoding: "utf8" }).trim();
  res.restored = left === "";
  writeFileSync(OUT, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
}
