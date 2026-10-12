// Bank B · lib/printStationScript.ts — 0 ledger rows by subject before this run.
// The three generated files are produced by the real export and then READ and SYNTAX-CHECKED with the
// shells that will run them (zsh for the Mac file, sh and bash for Linux). Nothing is executed.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, chk, assert, eq } from "./lib.mjs";

const F = "lib/printStationScript.ts";
const H = "node: the real export → the generated text";
const m = await load(F);
const ORIGIN = "https://3-d-backup.vercel.app";
const gen = (os, a = {}) => m.stationScript(os, { origin: ORIGIN, panel: "kitchen", label: "French House", ...a });
const mac = gen("mac"), win = gen("windows"), lin = gen("linux");
const dir = mkdtempSync(join(tmpdir(), "t15s10-st-"));
const syntax = (shell, text) => { const p = join(dir, "f" + Math.random().toString(36).slice(2)); writeFileSync(p, text); execFileSync(shell, ["-n", p], { stdio: "pipe" }); return true; };
const nasty = "https://x\nsay 'added from an origin'\n# $(rm -rf ~) `id` %PATH% & del *";

await chk("P184062", F, "the Mac file starts with the zsh line its double-click needs", H, () => assert(mac.startsWith("#!/bin/zsh\n")));
await chk("P184063", F, "the Linux file starts with a POSIX sh line", H, () => assert(lin.startsWith("#!/bin/sh\n")));
await chk("P184064", F, "the Windows file starts with @echo off", H, () => assert(win.startsWith("@echo off")));
await chk("P184065", F, "the Mac file is valid zsh (zsh -n)", "zsh -n on the generated file", () => syntax("zsh", mac));
await chk("P184066", F, "the Linux file is valid sh (sh -n)", "sh -n on the generated file", () => syntax("sh", lin));
await chk("P184067", F, "…and valid bash too (a Pi often runs it with bash)", "bash -n on the generated file", () => syntax("bash", lin));
await chk("P184068", F, "the Mac file stays valid zsh with the kitchen panel AND the manager panel", "zsh -n twice", () => { syntax("zsh", gen("mac", { panel: "manager" })); syntax("zsh", gen("mac", { panel: "kitchen" })); });
await chk("P184069", F, "every file names the site it was made for, once, on the SITE line", H, () => {
  for (const t of [mac, lin]) assert(t.includes(`SITE="${ORIGIN}"`), "no SITE line"); assert(win.includes(`set "SITE=${ORIGIN}"`), "no Windows SITE line");
});
await chk("P184070", F, "PANEL is kitchen when asked for kitchen", H, () => { for (const t of [mac, lin]) assert(t.includes('PANEL="kitchen"')); assert(win.includes('set "PANEL=kitchen"')); });
await chk("P184071", F, "PANEL falls back to manager for anything that is not kitchen (never an arbitrary value)", H, () => {
  const t = m.stationScript("linux", { origin: ORIGIN, panel: "owner; rm -rf ~" }); assert(t.includes('PANEL="manager"') && !t.includes("rm -rf ~"));
});
await chk("P184072", F, "an origin carrying line breaks cannot add a line to the Mac file", H, () => {
  const t = gen("mac", { origin: nasty }); assert(!t.split("\n").some((l) => /^say 'added/.test(l)), "a line came from the origin"); syntax("zsh", t);
});
await chk("P184073", F, "…nor to the Linux file", H, () => { const t = gen("linux", { origin: nasty }); assert(!t.split("\n").some((l) => /^say 'added/.test(l))); syntax("sh", t); });
await chk("P184074", F, "…nor to the Windows file", H, () => { const t = gen("windows", { origin: nasty }); assert(!t.split("\n").some((l) => /^say 'added/.test(l))); });
await chk("P184075", F, "$( ), backticks and $ are stripped from a typed value, so nothing in it runs", H, () => {
  const t = gen("mac", { origin: nasty }); const site = t.split("\n").find((l) => l.startsWith("SITE=")); assert(!/[`$]/.test(site.slice(5)), site);
});
await chk("P184076", F, "% & | < > ^ ; are stripped, so a Windows value cannot expand a variable or chain a command", H, () => {
  const t = gen("windows", { origin: nasty }); const site = t.split("\n").find((l) => l.startsWith('set "SITE=')); assert(!/[%&|<>^;]/.test(site.slice(10, -1)), site);
});
await chk("P184077", F, "a label with line breaks cannot add a line either (it lives in a comment)", H, () => {
  for (const os of ["mac", "linux", "windows"]) { const t = gen(os, { label: "Cafe\nrm -rf ~\n" }); assert(!t.split("\n").some((l) => /^rm -rf/.test(l)), os); }
});
await chk("P184078", F, "a value is capped at 200 characters", H, () => {
  const t = gen("linux", { origin: "https://" + "a".repeat(1000) }); const site = t.split("\n").find((l) => l.startsWith("SITE=")); assert(site.length <= 210, String(site.length));
});
await chk("P184079", F, "no file carries a password, a token, a cookie or a setup code — the person signs in once", H, () => {
  for (const t of [mac, win, lin]) assert(!/password=|token=|lfhp_|x-lfh-agent|cookie/i.test(t), "a credential-shaped string is in the file");
});
await chk("P184080", F, "every file opens Chrome with --kiosk-printing (silent print, no dialog)", H, () => { for (const t of [mac, win, lin]) assert(t.includes("--kiosk-printing")); });
await chk("P184081", F, "…and never with --kiosk (fullscreen — the opposite of what he asked for)", H, () => { for (const t of [mac, win, lin]) assert(!/--kiosk(?!-printing)/.test(t)); });
await chk("P184082", F, "every file carries the three no-throttling flags, so a hidden Chrome keeps polling", H, () => {
  for (const t of [mac, win, lin]) for (const f of ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"]) assert(t.includes(f), f);
});
await chk("P184083", F, "every file uses its OWN --user-data-dir, so the person's own Chrome, tabs and logins are untouched", H, () => { for (const t of [mac, win, lin]) assert(/--user-data-dir="?(\$PROFILE|%PROFILE%)/.test(t)); });
await chk("P184084", F, "the Mac file starts Chrome with open -g -j -n (no raise, hidden, its own instance)", H, () => assert(/open -g -j -n -a "Google Chrome"/.test(mac)));
await chk("P184085", F, "…and hides THIS Chrome by process id, never every Chrome by name", H, () => {
  const run = mac.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");   // the comment QUOTES the wrong way, on purpose
  assert(/first process whose unix id is \$CPID/.test(run) && !/set visible of process "Google Chrome"/.test(run));
});
await chk("P184086", F, "…the re-hide never fights a person who has the station in front", H, () => assert(/\[ "\$FRONT" = "Google Chrome" \] && continue/.test(mac)));
await chk("P184087", F, "…and caffeinate keeps the Mac awake while the window lives", H, () => assert(/\ncaffeinate -dimsu\n/.test(mac)));
await chk("P184088", F, "the Windows file starts Chrome minimised (start /min)", H, () => assert(/start "Aevidine print station" \/min "%CHROME%"/.test(win)));
await chk("P184089", F, "…and switches standby off on mains power, so the PC does not sleep the night away", H, () => assert(/powercfg \/change standby-timeout-ac 0/.test(win)));
await chk("P184090", F, "…finds Chrome under Program Files OR Program Files (x86)", H, () => assert(/%ProgramFiles%\\Google\\Chrome/.test(win) && /%ProgramFiles\(x86\)%\\Google\\Chrome/.test(win)));
await chk("P184091", F, "…its profile and log folders are under LOCALAPPDATA, with a backslash before each name", H, () => {
  assert(win.includes('set "PROFILE=%LOCALAPPDATA%\\AevidinePrintStation"') && win.includes('set "LOGDIR=%LOCALAPPDATA%\\AevidinePrintHelper"'));
});
await chk("P184092", F, "…its start-up line is written INTO the log folder, not beside it (item 1)", H, () => assert(win.includes('>>"%LOGDIR%\\station.log"'), "still writes AevidinePrintHelperstation.log"));
await chk("P184093", F, "…no %VAR% in a working line is glued straight onto a name", H, () => {
  const glued = win.split("\n").filter((l) => !/^\s*REM\b/i.test(l) && /%[A-Z_]+%[A-Za-z]/.test(l)); eq(glued, []);
});
await chk("P184094", F, "…every line continued with ^ is followed by a real next line (a dangling ^ eats the next command)", H, () => {
  const L = win.split("\n"); L.forEach((l, i) => { if (/\^\s*$/.test(l)) assert(L[i + 1] && L[i + 1].trim().length, `line ${i + 1} continues into nothing`); });
});
await chk("P184095", F, "the Linux file finds google-chrome, chrome-stable or chromium, and says how to install one if none", H, () => {
  assert(/for c in google-chrome google-chrome-stable chromium chromium-browser/.test(lin) && /Install Chromium/.test(lin));
});
await chk("P184096", F, "Mac AND Linux refuse to start a second copy (one Chrome per profile — a second would raise the window)", H, () => {
  for (const t of [mac, lin]) assert(/kill -0 "\$\(cat "\$LOCK"/.test(t) && /trap 'rm -f "\$LOCK"' EXIT INT TERM/.test(t));
});
await chk("P184097", F, "…and the lock is removed on exit, so a crash does not lock the station out for ever", H, () => {
  // `kill -0` on a pid that no longer exists fails, so a stale lock file is ignored rather than obeyed.
  for (const t of [mac, lin]) assert(/\[ -f "\$LOCK" \] && kill -0/.test(t));
});
await chk("P184098", F, "every file opens the panel at SITE/PANEL — the restaurant is decided by who signs in, never by the file", H, () => {
  for (const t of [mac, lin]) assert(t.includes('"$SITE/$PANEL"')); assert(win.includes('"%SITE%/%PANEL%"')); for (const t of [mac, win, lin]) assert(!/\/r\/|restaurant_id|rid=/.test(t));
});
await chk("P184099", F, "STATION_FILENAME names the three files the board tells people to save", H, () => eq(m.STATION_FILENAME, { mac: "print-station.command", windows: "print-station.bat", linux: "print-station.sh" }));
await chk("P184100", F, "STATION_FIRST_RUN has one plain sentence per system, each about signing in ONCE", H, () => {
  for (const os of ["mac", "windows", "linux"]) assert(/sign in once/i.test(m.STATION_FIRST_RUN[os]), os);
});
await chk("P184101", F, "an unknown system name gets the Mac file, not a crash", H, () => assert(m.stationScript("plan9", { origin: ORIGIN }).startsWith("#!/bin/zsh")));
await chk("P184102", F, "a missing origin still produces a file (an empty SITE the person can fill in), not a throw", H, () => assert(m.stationScript("linux", {}).includes('SITE=""')));
await chk("P184103", F, "the 'two lines you may change' box is in all three files and names only SITE and PANEL", H, () => {
  for (const t of [mac, win, lin]) assert(/THE TWO LINES YOU MAY CHANGE/.test(t) && /SITE {3}the web address/.test(t) && /PANEL {2}which screen/.test(t));
});
await chk("P184104", F, "the Windows file writes no Unicode box-drawing characters to the console (cmd's code page shows them as junk)", H, () => {
  const echoes = win.split("\n").filter((l) => /^\s*echo\b/i.test(l)); assert(!echoes.some((l) => /[─│┌┐└┘═]/.test(l)), "a box character is echoed");
});
await chk("P184105", F, "the Mac file never asks for sudo or an admin password", H, () => assert(!/\bsudo\b/.test(mac)));
await chk("P184106", F, "the Windows file never asks for elevation (runas, a UAC prompt)", H, () => assert(!/runas|-Verb RunAs/i.test(win)));
await chk("P184107", F, "every file is small enough to paste into Notepad in one go (under 16 KB)", H, () => { for (const t of [mac, win, lin]) assert(t.length < 16_000, String(t.length)); });
await chk("P184108", F, "none of the three files downloads anything (the station is Chrome and nothing else)", H, () => { for (const t of [mac, win, lin]) assert(!/\bcurl\b|\bwget\b|Invoke-WebRequest/.test(t)); });
await chk("P184109", F, "the window size is the same small 520×360 everywhere", H, () => { for (const t of [mac, win, lin]) assert(t.includes("--window-size=520,360")); });
await chk("P184110", F, "the CHROME_FLAGS list reaches every file identically (one list, three files)", H, () => {
  const flags = ["--no-first-run", "--no-default-browser-check", "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required"];
  for (const t of [mac, win, lin]) for (const f of flags) assert(t.includes(f), f);
});
