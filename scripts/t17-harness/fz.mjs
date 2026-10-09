// Tiny seeded fuzz kit (deterministic: the same seed gives the same inputs on every run).
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const POOL = ["/", "\\", "a", "Z", "0", ".", "..", "?", "#", "&", "=", "%", "%2f", "%5c", " ", "\t", "\n", "\u0000", "\u007f", "é", "न", "😀", ":", "@", "//", "http:", "https://x.example", "javascript:", "\r", "+", "-", "_", "~", ";", ",", "'", "\"", "<", ">"];
export function str(r, max = 24) { let s = ""; const n = Math.floor(r() * max); for (let i = 0; i < n; i++) s += POOL[Math.floor(r() * POOL.length)]; return s; }
export function ascii(r, max = 40) { let s = ""; const n = Math.floor(r() * max); for (let i = 0; i < n; i++) s += String.fromCharCode(32 + Math.floor(r() * 95)); return s; }
export function uni(r, max = 30) { let s = ""; const n = Math.floor(r() * max); for (let i = 0; i < n; i++) { const c = Math.floor(r() * 0x2fff); if (c >= 0xd800 && c <= 0xdfff) continue; s += String.fromCharCode(c); } return s; }
