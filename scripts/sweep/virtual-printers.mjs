// A VIRTUAL PRINT SHOP for verify:printing-sweep.
//
// Three CUPS queues (ZZ-Virt-Kitchen/Counter/Banquet) point at these three ports with the REAL ZJ-80
// driver, so what arrives here is byte-for-byte what a thermal printer would receive. Each job is
// saved raw AND rendered to a PNG, so a print can be LOOKED AT instead of guessed about — no paper,
// no printer, and every alignment fault visible.
//
// IT LIVES IN THE REPO NOW (2026-08-31). It used to be written straight into /tmp/virtual-prints/,
// and /tmp is swept: the file went, the PROCESS kept running and printing, and the sweep's own gate
// — which asked whether the FILE existed — declared "no virtual printers" and skipped sixteen
// phases that were working perfectly. A skip is supposed to mean the coverage is unavailable, not
// that the harness lost track of itself. The gate asks the PORTS now (see verify-printing-sweep.mjs).
//
// Start it:  node scripts/sweep/virtual-printers.mjs
// Stop it:   pkill -f virtual-printers.mjs
// Output:    /tmp/virtual-prints/out/NNN-<which>.{bin,png,json}   (throwaway; the .json is measured)
import { createServer } from "node:net";
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const DIR = "/tmp/virtual-prints/out";
mkdirSync(DIR, { recursive: true });
const PORTS = { 9101: "kitchen", 9102: "counter", 9103: "banquet" };
const DOT = 25.4 / 203;                                  // one printer dot, in mm (203 dpi head)
let n = 0;

// ── PNG, hand-rolled (no dependency in a tool that must run anywhere) ─────────────────────────
const crcTable = (() => { const t = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(width, height, rows) {                       // rows: Uint8Array per row, 1 = black
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit greyscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = rows[y] && rows[y][x] ? 0 : 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ── decode what a thermal printer is being told to do ────────────────────────────────────────
function render(buf) {
  const rows = []; let width = 0, i = 0, cuts = 0, feedMm = 0, inkMm = 0;
  const blank = (mm) => { const px = Math.max(0, Math.round(mm / DOT)); for (let k = 0; k < px; k++) rows.push(null); };
  while (i < buf.length) {
    if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {       // GS v 0 — a raster band
      const wBytes = buf[i + 4] | (buf[i + 5] << 8), h = buf[i + 6] | (buf[i + 7] << 8), start = i + 8;
      width = Math.max(width, wBytes * 8);
      for (let y = 0; y < h; y++) {
        const row = new Uint8Array(wBytes * 8);
        for (let xb = 0; xb < wBytes; xb++) { const byte = buf[start + y * wBytes + xb]; for (let bit = 0; bit < 8; bit++) row[xb * 8 + bit] = (byte >> (7 - bit)) & 1; }
        rows.push(row);
      }
      inkMm += h * DOT; i = start + wBytes * h;
    } else if (buf[i] === 0x1b && buf[i + 1] === 0x4a) { blank(buf[i + 2] * DOT); feedMm += buf[i + 2] * DOT; i += 3; }
    else if (buf[i] === 0x1b && buf[i + 1] === 0x64) { blank(buf[i + 2] * 24 * DOT); feedMm += buf[i + 2] * 24 * DOT; i += 3; }
    else if (buf[i] === 0x1d && buf[i + 1] === 0x56) { cuts++; i += buf[i + 2] === 0x42 ? 4 : 3; }
    else i++;
  }
  // the LEFT-MOST and RIGHT-MOST ink columns — the alignment answer, in millimetres
  let minX = Infinity, maxX = -1;
  for (const r of rows) if (r) for (let x = 0; x < r.length; x++) if (r[x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  return { rows, width: width || 1, cuts, feedMm, inkMm,
    leftMm: minX === Infinity ? null : +(minX * DOT).toFixed(1),
    rightMm: maxX < 0 ? null : +((maxX + 1) * DOT).toFixed(1),
    lengthMm: +(rows.length * DOT).toFixed(1) };
}

for (const [port, name] of Object.entries(PORTS)) {
  createServer((sock) => {
    const chunks = [];
    sock.on("data", (d) => chunks.push(d));
    sock.on("end", () => {
      const buf = Buffer.concat(chunks);
      const id = String(++n).padStart(3, "0");
      const base = `${DIR}/${id}-${name}`;
      writeFileSync(base + ".bin", buf);
      let note = "";
      try {
        const r = render(buf);
        if (r.rows.length) writeFileSync(base + ".png", png(r.width, r.rows.length, r.rows));
        note = ` · ${r.lengthMm}mm long · ink ${r.leftMm}–${r.rightMm}mm · ${r.cuts} cut${r.cuts === 1 ? "" : "s"} · feed ${r.feedMm.toFixed(1)}mm`;
        writeFileSync(base + ".json", JSON.stringify({ bytes: buf.length, ...r, rows: undefined }, null, 1));
      } catch (e) { note = " · (not thermal raster: " + e.message.slice(0, 40) + ")"; }
      console.log(`[${new Date().toLocaleTimeString("en-IN")}] ${name} ← ${buf.length} bytes${note}  →  ${id}-${name}.png`);
    });
    sock.on("error", () => {});
  }).listen(Number(port), "127.0.0.1", () => console.log("virtual printer listening: " + name + " on " + port));
}
