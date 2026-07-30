// verify-avlive-offline-complete.mjs — is the CLIENT stack (AV live) carrying the WHOLE
// offline feature, or only part of it?
//
// WHY THIS EXISTS. The client deployment runs several releases behind, so the offline layer
// went there as a surgical patch (hunk-by-hunk content match) rather than a file copy. One
// file's hunks silently failed to apply and NOTHING was written for that file — so Aangan
// ran with the offline layer everywhere EXCEPT the manager panel's "don't die to a dead
// shell" fix, which is the headline of the whole feature. Byte-comparing the copied files
// did not catch it, because that file was a patched one, not a copied one.
//
// Run this after ANY release of offline work to the client stack:
//   node scripts/verify-avlive-offline-complete.mjs
//
// Wholesale-copied files must be byte-identical; surgically-patched files must contain every
// marker of the change. Read-only — it touches no database and no deployment.
import fs from "node:fs";
import crypto from "node:crypto";

const AV = "/Users/aevinite/Documents/LIVE_PROJECTS/3D_Menu_Av";
const HERE = process.cwd();
const md5 = (p) => { try { return crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex"); } catch { return null; } };

// Files with no local drift on the client stack — they must match this repo exactly.
const identical = [
  "public/sw.js", "public/offline.html", "public/panels/offline.js", "public/panels/swreg.js",
  "public/panels/outbox.js", "public/panels/kitchen/app.js", "lib/clash.ts", "lib/tableOfAction.ts",
  "components/OfflineShell.tsx", "components/OfflineNotice.tsx", "app/layout.tsx",
  "app/login/LoginForm.tsx", "lib/guestOutbox.ts", "app/api/guest/place-order/route.ts", "vercel.json",
];

// Files that DO differ there for unrelated reasons (that stack is behind), so we check that
// each piece of THIS change is present rather than comparing whole files.
const markers = {
  "public/panels/editor/app.js": ["LFH_OFF.noteResponse", "netErr.offline = true", "const errText", "const bootPaint", "isOfflineErr"],
  "public/panels/tablet/app.js": ["LFH_OFF.noteResponse", "unsentBox", "canReadOffline", "lfh:outbox-changed", "netErr.offline = true"],
  "public/panels/editor/index.html": ["panels/offline.js", "panels/swreg.js"],
  "public/panels/kitchen/index.html": ["panels/offline.js", "panels/swreg.js"],
  "public/panels/tablet/index.html": ["panels/offline.js", "panels/swreg.js"],
  "app/api/editor/[...path]/route.ts": ['from "@/lib/clash"', "await replayClash("],
  "app/api/kitchen/[...path]/route.ts": ['from "@/lib/clash"', "await replayClash("],
  "app/api/tablet/[...path]/route.ts": ['from "@/lib/clash"', "await replayClash("],
  "public/panels/editor/style.css": ["--offbar-h"],
};

let bad = 0;
console.log("── files that must be byte-identical ──");
for (const f of identical) {
  const a = md5(`${AV}/${f}`), b = md5(`${HERE}/${f}`);
  const ok = a && a === b;
  if (!ok) bad++;
  console.log(`  ${ok ? "OK  " : "DIFF"} ${f}${a ? "" : "  (MISSING on the client stack)"}`);
}
console.log("── surgically patched files: every piece present? ──");
for (const [f, ms] of Object.entries(markers)) {
  let txt = null;
  try { txt = fs.readFileSync(`${AV}/${f}`, "utf8"); } catch { /* missing */ }
  if (txt === null) { console.log(`  MISSING ${f}`); bad++; continue; }
  const miss = ms.filter((m) => !txt.includes(m));
  if (miss.length) { bad++; console.log(`  INCOMPLETE ${f} → missing ${JSON.stringify(miss)}`); }
  else console.log(`  OK   ${f} (${ms.length} pieces)`);
}
console.log(bad === 0 ? "\n✅ the client stack has the COMPLETE feature" : `\n❌ ${bad} file(s) incomplete — do NOT call the release done`);
process.exit(bad === 0 ? 0 : 1);
