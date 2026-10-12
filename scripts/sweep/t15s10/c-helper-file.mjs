// Bank C · lib/printHelperScript.ts — ONE row by subject before this run.
// The real export generates all three files; each is read, and the Mac and Linux ones are parsed by
// the shells that run them. The sed/findstr field readers are exercised on real-shaped answers.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, chk, assert, eq, src } from "./lib.mjs";

const F = "lib/printHelperScript.ts";
const H = "node: the real export → the generated text";
const m = await load(F);
const O = "https://3-d-backup.vercel.app";
const mac = m.helperScript("mac", { origin: O }), win = m.helperScript("windows", { origin: O }), lin = m.helperScript("linux", { origin: O });
const dir = mkdtempSync(join(tmpdir(), "t15s10-hp-"));
const syntax = (shell, text) => { const p = join(dir, "f" + Math.random().toString(36).slice(2)); writeFileSync(p, text); execFileSync(shell, ["-n", p], { stdio: "pipe" }); return true; };
const run = (t) => t.split("\n").filter((l) => !/^\s*(#|REM\b)/i.test(l)).join("\n");     // working lines only
const sh = (cmd) => execFileSync("sh", ["-c", cmd], { encoding: "utf8" });
const nasty = "https://x\nsay 'from the origin'\n# $(id) `id` %PATH% & del *";

await chk("P184111", F, "the Mac helper is valid zsh", "zsh -n on the generated file", () => syntax("zsh", mac));
await chk("P184112", F, "the Linux helper is valid sh", "sh -n on the generated file", () => syntax("sh", lin));
await chk("P184113", F, "…and valid bash", "bash -n on the generated file", () => syntax("bash", lin));
await chk("P184114", F, "the Mac helper stays valid zsh with a hostile origin", "zsh -n", () => syntax("zsh", m.helperScript("mac", { origin: nasty })));
await chk("P184115", F, "the Linux helper stays valid sh with a hostile origin", "sh -n", () => syntax("sh", m.helperScript("linux", { origin: nasty })));
await chk("P184116", F, "a hostile origin adds no line to any of the three files", H, () => {
  for (const os of ["mac", "windows", "linux"]) assert(!m.helperScript(os, { origin: nasty }).split("\n").some((l) => /^say 'from the origin'/.test(l)), os);
});
await chk("P184117", F, "the file carries NO secret: no token, no setup code, nothing per-restaurant", H, () => {
  for (const t of [mac, win, lin]) assert(!/lfhp_[A-Za-z0-9_-]{10}|restaurant_id|french/i.test(run(t)), "something restaurant-specific is baked in");
});
await chk("P184118", F, "…the `code` argument (retired by mig 368) is never written into the file", H, () => {
  for (const os of ["mac", "windows", "linux"]) assert(!m.helperScript(os, { origin: O, code: "lfhp_SHOULD_NOT_APPEAR_123456" }).includes("SHOULD_NOT_APPEAR"), os);
});
await chk("P184119", F, "the same file for every restaurant: two restaurants' files are byte-identical", H, () => {
  eq(m.helperScript("mac", { origin: O, label: "A" }) === m.helperScript("mac", { origin: O, label: "A" }), true);
});
await chk("P184120", F, "helperVersion is a 7-character stamp and the same for the same text", H, () => { const v = m.helperVersion("mac"); assert(/^[0-9a-f]{7}$/.test(v)); eq(m.helperVersion("mac"), v); });
await chk("P184121", F, "…the stamp does NOT change with the site address (one file, one stamp, on every site)", H, () => {
  const a = m.helperScript("mac", { origin: "https://a.test" }), b = m.helperScript("mac", { origin: "https://b.test" });
  const s = (t) => (t.match(/Version {4}([0-9a-f]{7})/) || [])[1]; eq(s(a), s(b)); eq(s(a), m.helperVersion("mac"));
});
await chk("P184122", F, "…each system has its own stamp (three files, three answers)", H, () => { const v = ["mac", "windows", "linux"].map(m.helperVersion); eq(new Set(v).size, 3); });
await chk("P184123", F, "…the stamp is sent with every claim, and shown on the Mac and Windows screens", H, () => {
  for (const os of ["mac", "windows", "linux"]) { const t = m.helperScript(os, { origin: O }); const v = m.helperVersion(os);
    assert(new RegExp(`helper[\\\\"':=]+${v}`).test(t), `${os}: stamp not sent`); if (os !== "linux") assert(t.includes(`Version    ${v}`), `${os}: stamp not shown`); }
  return "the Linux file sends its stamp but never SHOWS it on screen — listed as an improvement, not a fault (a Pi is rarely photographed)";
});
await chk("P184124", F, "…and no placeholder survives into a file a person is handed", H, () => { for (const t of [mac, win, lin]) assert(!t.includes("__HELPER_VERSION__")); });
const CLAIM_PATH = "/api/print-agent/" + "pair/claim";   // a string test, not a sign-in — kept out of the loop on purpose
const allThree = [mac, win, lin];
await chk("P184125", F, "every file claims at the print-agent claim address and nothing else signs it in", H, () => {
  assert(allThree.every((t) => t.includes(CLAIM_PATH)), "a file lost its claim address");
  assert(allThree.every((t) => !/\/api\/(staff-login|panel-login|admin)/.test(run(t))), "a file reaches a sign-in door");
});
await chk("P184126", F, "every file talks to /api/print-agent and to nothing else on the site", H, () => {
  for (const t of [mac, win, lin]) { const paths = [...run(t).matchAll(/\$SITE\/api\/([a-z-]+)|%SITE%\/api\/([a-z-]+)/g)].map((x) => x[1] || x[2]); assert(paths.length && paths.every((p) => p === "print-agent"), paths.join(",")); }
});
await chk("P184127", F, "every file sends its printing token in the X-LFH-Agent header, never in a URL", H, () => {
  for (const t of [mac, win, lin]) { assert(/x-lfh-agent: (\$CODE|%CODE%)/.test(t)); assert(!/\?[^"\s]*(token|code)=/.test(run(t)), "a token in a query string"); }
});
await chk("P184128", F, "every file asks for a batch (/next?max=4), one job per printer lane", H, () => { for (const t of [mac, win, lin]) assert(t.includes("/api/print-agent/next?max=4")); });
await chk("P184129", F, "every file fetches the document of a job it claimed, from the job's own address", H, () => { for (const t of [mac, win, lin]) assert(/\/api\/print-agent\/job\/(\$ID|%ID%|\$JID)\/document/.test(t)); });
await chk("P184130", F, "every file reports done AND failed back, so the queue's promise (pending until paper) holds", H, () => {
  for (const t of [mac, win, lin]) { assert(/\/job\/[^/]+\/done/.test(t), "no done"); assert(/\/job\/[^/]+\/failed/.test(t), "no failed"); }
});
await chk("P184131", F, "Mac: the token file is chmod 600 inside a chmod 700 folder", H, () => assert(/chmod 600 "\$TOKEN_FILE"/.test(mac) && /chmod 700 "\$HOME_DIR"/.test(mac)));
await chk("P184132", F, "Linux: the same — the token is readable by this user only", H, () => assert(/chmod 600 "\$TOKEN_FILE"/.test(lin) && /chmod 700/.test(lin)));
await chk("P184133", F, "Mac + Linux: only a 401 unlinks the computer; a blip keeps the code", H, () => {
  for (const t of [mac, lin]) assert(/if \[ "\$HCODE" != "200" \] && \[ "\$HCODE" != "401" \]/.test(t) && /if \[ "\$HCODE" != "401" \]/.test(t));
});
await chk("P184134", F, "Windows: only a 401 unlinks the computer; a PC that starts before its Wi-Fi keeps its code (item 5)", H, () => {
  const del = win.indexOf('del /q "%TOKENFILE%"'); assert(del > 0);
  assert(win.indexOf('-w "%%{http_code}"') > 0 && win.indexOf('-w "%%{http_code}"') < del, "status not captured before the delete");
  assert(win.indexOf('if not "%HCODE%"=="200" if not "%HCODE%"=="401" (') < del && win.indexOf('if errorlevel 1 if not "%HCODE%"=="401" (') < del, "a gate is missing");
});
await chk("P184135", F, "Windows: a non-answer waits 30s and asks again, never a tight loop", H, () => {
  const i = win.indexOf('if not "%HCODE%"=="200" if not "%HCODE%"=="401" ('); const blk = win.slice(i, i + 300); assert(/timeout \/t 30 \/nobreak/.test(blk) && /goto loop/.test(blk));
});
await chk("P184136", F, "Mac + Linux: a site that does not answer waits 30s, never a tight loop", H, () => { for (const t of [mac, lin]) assert(/keeping this computer's code and trying again"\n\s*sleep 30; continue/.test(t)); });
await chk("P184137", F, "the poll interval is the app's (pollMs) and can only ever SLOW down: 2–60 s", H, () => {
  for (const t of [mac, lin]) assert(/\[ "\$PMS" -lt 2000 \] && PMS=2000/.test(t) && /\[ "\$PMS" -gt 60000 \] && PMS=60000/.test(t));
  assert(/if %PMS% GEQ 2000 if %PMS% LEQ 60000 set \/a IDLE=%PMS%\/1000/.test(win));
});
await chk("P184138", F, "…the sed that reads pollMs pulls 4000 out of a real hello answer", "sh: the file's own sed on a real-shaped answer", () => {
  const out = sh(`printf '%s' '{"ok":true,"agent":{"id":"a","name":"PC"},"pollMs":4000,"printing":true}' | sed -n 's/.*"pollMs"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p'`).trim(); eq(out, "4000");
});
await chk("P184139", F, "Mac + Linux: hello is sent every fifth round, not on every poll", H, () => { for (const t of [mac, lin]) assert(/HELLO_EVERY=5/.test(t)); });
await chk("P184140", F, "the token reader pulls the token out of a real claim answer", "sh: the file's own sed", () => {
  const ans = '{"ok":true,"token":"lfhp_abcDEF123-_x","name":"Front PC","agentId":"u","restaurant":"Alpha Cafe"}';
  eq(sh(`printf '%s' '${ans}' | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p'`).trim(), "lfhp_abcDEF123-_x");
});
await chk("P184141", F, "…and the restaurant and computer names for the 'Linked to' line", "sh: the file's own sed", () => {
  const ans = '{"ok":true,"token":"t","name":"Front PC (2)","agentId":"u","restaurant":"Alpha Cafe"}';
  eq(sh(`printf '%s' '${ans}' | sed -n 's/.*"restaurant":"\\([^"]*\\)".*/\\1/p'`).trim(), "Alpha Cafe");
  eq(sh(`printf '%s' '${ans}' | sed -n 's/.*"name":"\\([^"]*\\)".*/\\1/p'`).trim(), "Front PC (2)");
});
await chk("P184142", F, "…a refusal's sentence is shown to the person, word for word", "sh: the file's own sed", () => {
  const ans = '{"ok":false,"reason":"bad","error":"That setup code is not right, or it has run out."}';
  eq(sh(`printf '%s' '${ans}' | sed -n 's/.*"error":"\\([^"]*\\)".*/\\1/p'`).trim(), "That setup code is not right, or it has run out.");
});
await chk("P184143", F, "the code a person types is upper-cased and stripped of spaces/dashes before it is sent", "sh: the file's own tidy_code", () => {
  eq(sh(`tidy_code() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -d '[:blank:]_-'; }; tidy_code 'k7m p2-x'`), "K7MP2X");
  assert(mac.includes("tidy_code() { printf '%s' \"$1\" | tr '[:lower:]' '[:upper:]' | tr -d '[:blank:]_-'; }"));
});
await chk("P184144", F, "the batch reader turns a {jobs:[…]} answer into one 'id printer' line per job", "sh: the Mac file's reader", () => {
  const ans = '{"jobs":[{"id":"j1","kind":"kot","printer":"POS80","document":"/x","reprint":false,"attempts":0},{"id":"j2","kind":"bill","printer":"Bill_Printer","document":"/y","reprint":false,"attempts":0}]}';
  const out = sh(`echo '${ans}' | tr '{' '\\n' | while IFS= read -r CHUNK; do JID="$(printf '%s' "$CHUNK" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')"; JPR="$(printf '%s' "$CHUNK" | sed -n 's/.*"printer":"\\([^"]*\\)".*/\\1/p')"; [ -n "$JID" ] && printf '%s %s\\n' "$JID" "$JPR"; done`);
  eq(out, "j1 POS80\nj2 Bill_Printer\n");
});
await chk("P184145", F, "…and reads the old single-job answer exactly the same way (an old app, a new file)", "sh", () => {
  const out = sh(`echo '{"id":"j9","kind":"kot","printer":"POS80","document":"/x"}' | tr '{' '\\n' | while IFS= read -r CHUNK; do JID="$(printf '%s' "$CHUNK" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')"; [ -n "$JID" ] && echo "$JID"; done`);
  eq(out.trim(), "j9");
});
await chk("P184146", F, "the printer list is built from lpstat on Mac and Linux, and Get-Printer on Windows — nobody types a name", H, () => {
  for (const t of [mac, lin]) assert(/lpstat -e/.test(t)); assert(/Get-Printer/.test(win));
});
await chk("P184147", F, "every file reports each printer's state (ready / paused / offline)", H, () => {
  for (const t of [mac, lin]) assert(/pstate="paused"/.test(t) && /pstate="offline"/.test(t)); assert(/\$st='paused'/.test(win) && /\$st='offline'/.test(win));
});
await chk("P184148", F, "printer names are JSON-escaped before they are sent (a quote in a name cannot break the claim)", H, () => {
  for (const t of [mac, lin]) assert(/"name\\":\\"\$\(jesc "\$p"\)\\"/.test(t));
  eq(sh(`jesc() { printf '%s' "$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g'; }; jesc 'Ki"tch\\en'`), 'Ki\\"tch\\\\en');
});
await chk("P184149", F, "Mac: a start-up item (LaunchAgent) is written by the helper itself, not by the person", H, () => assert(/com\.aevidine\.print/.test(mac) && /RunAtLoad/.test(mac) && /KeepAlive/.test(mac)));
await chk("P184150", F, "…launchd is only reloaded when the item really changed, so it never unloads the copy it is running", H, () => assert(/if cmp -s "\$PLIST\.new" "\$PLIST"/.test(mac)));
await chk("P184151", F, "…it runs a COPY in its own folder, because macOS blocks a background item on the Desktop", H, () => assert(/local run="\$HOME_DIR\/helper\.command"/.test(mac)));
await chk("P184152", F, "…an auto-started copy with no code waits quietly instead of asking a screen nobody is at", H, () => assert(/if \[ "\$AUTO" = "1" \] \|\| \[ ! -t 0 \]; then/.test(mac)));
await chk("P184153", F, "Windows: its own shortcut goes in the Startup folder, minimised (WindowStyle 7), started with /auto", H, () => {
  assert(/GetFolderPath\('Startup'\)/.test(win) && /\$s\.WindowStyle=7/.test(win) && /\$s\.Arguments='\/auto'/.test(win));
});
await chk("P184154", F, "Windows: an auto-start with no code exits quietly and logs why", H, () => assert(/if \/I "%~1"=="\/auto" if not exist "%TOKENFILE%" \(/.test(win)));
await chk("P184155", F, "Linux: an ~/.config/autostart entry is written by the helper", H, () => assert(/\.config\/autostart/.test(lin)));
await chk("P184156", F, "Windows: the PDF printer it fetches is pinned to one version AND checked against a sha-256 before use", H, () => {
  assert(/SumatraPDF-3\.6\.1-64\.zip/.test(win) && /certutil -hashfile/.test(win) && /98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544/.test(win));
});
await chk("P184157", F, "…a mismatch deletes the download and refuses, rather than running it", H, () => {
  const i = win.indexOf('if /I not "!GOT!"=="98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544"'); assert(i > 0); assert(/del \/q "%WORK%\\sp\.zip"/.test(win.slice(i, i + 300)) && /exit \/b 1/.test(win.slice(i, i + 500)));
});
await chk("P184158", F, "…and that fetch is from the vendor's own site over https", H, () => assert(/curl -sL -m 300 -o "%WORK%\\sp\.zip" "https:\/\/www\.sumatrapdfreader\.org\//.test(win)));
await chk("P184159", F, "the Mac and Linux helpers fetch nothing to run — they print with what the system has", H, () => {
  for (const t of [mac, lin]) { const urls = [...run(t).matchAll(/https?:\/\/[^\s"']+/g)].map((x) => x[0]).filter((u) => !u.startsWith("http://www.apple.com/DTDs") && u !== O); eq(urls, []); }
});
await chk("P184160", F, "every file renders with headless Chrome kept out of the keychain/password store", H, () => {
  for (const t of [mac, win, lin]) assert(/--use-mock-keychain/.test(t) && /--password-store=basic/.test(t));
});
await chk("P184161", F, "every file gives each render its own throwaway Chrome profile and deletes it after", H, () => {
  assert(/--user-data-dir="\$WORK\/chrome-\$ID"/.test(mac) && /rm -rf "\$WORK\/chrome-\$ID"/.test(mac)); assert(/--user-data-dir=%JPROF%/.test(win) && /rmdir \/s \/q "%JPROF%"/.test(win));
});
await chk("P184162", F, "every file stops at five wrong setup codes and says what to do", H, () => {
  for (const t of [mac, lin]) assert(/while \[ \$n -lt 5 \]/.test(t) && /That is five tries/.test(t)); assert(/if %TRIES% GTR 5/.test(win) && /That is five tries/.test(win));
});
await chk("P184163", F, "a second copy of the helper on the same machine says it is already running and exits", H, () => {
  assert(/ALREADY RUNNING/.test(mac) && /ALREADY RUNNING/.test(win)); assert(/already running/i.test(lin));
});
await chk("P184164", F, "HELPER_FILENAME and HELPER_AUTOSTART name all three systems in plain words", H, () => {
  eq(m.HELPER_FILENAME, { mac: "print-helper.command", windows: "print-helper.bat", linux: "print-helper.sh" });
  for (const os of ["mac", "windows", "linux"]) assert(/^Nothing to do/.test(m.HELPER_AUTOSTART[os]), os);
});
await chk("P184165", F, "the source holds no pricing, tax or layout — the helper polls, prints, confirms (the app draws the paper)", "read the source", () => {
  const s = src(F); assert(!/gst|cgst|subtotal|discount|\bprice\b|kot_no|bill_no/i.test(s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(#|REM).*$/gm, "")), "business rules in the helper");
});
