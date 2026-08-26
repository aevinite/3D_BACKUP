// swVersion.ts — WHAT VERSION OF THE OFFLINE LAYER IS CURRENTLY SHIPPED?
//
// public/sw.js declares `const VERSION = "vN"`, and every cache name it uses interpolates it.
// A device that has not picked up a new copy keeps the old one, so to say "this tablet is behind"
// something has to know what CURRENT is. That is this file.
//
// It reads the shipped file rather than duplicating the number, because a second copy of a version
// number is a second thing to forget: the whole reason this check exists is that a missed bump ships
// a fix nobody receives, and a hard-coded constant here would fail in exactly that case.
//
// Read once and cached for the life of the server process — the file cannot change under a running
// deployment, and this is called from an admin screen that refreshes every minute.
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null | undefined;

/** The VERSION public/sw.js declares, or null if it cannot be read (never throws). */
export function shippedSwVersion(): string | null {
  if (cached !== undefined) return cached;
  try {
    const src = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
    const m = src.match(/const VERSION = "(v\d{1,4})"/);
    cached = m ? m[1] : null;
  } catch {
    // A packaged deployment that cannot read the file gets null, and the screen says "unknown"
    // rather than declaring every device behind. Never guess in the direction of an alarm.
    cached = null;
  }
  return cached;
}
