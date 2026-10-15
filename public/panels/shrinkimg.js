/* public/panels/shrinkimg.js — ONE place that shrinks a photo BEFORE it is uploaded.
 *
 * WHY THIS EXISTS (owner, 2026-09-17: "compress all images"). Two panels upload pictures — a dish
 * photo from Edit menu, and a photo attached to an issue — and both sent the file exactly as the
 * phone took it. A modern phone camera makes a 3–5 MB JPEG about 4,000 pixels wide. The dish photo
 * is then served to EVERY GUEST who opens the menu, at full size, on mobile data: the guest menu
 * shows it in a card about 300 px wide, so ~95% of those bytes were downloaded to be thrown away.
 *
 * So the browser does the work, once, at the moment of upload:
 *   · the long edge is capped (1280 px — twice the biggest box any screen shows it in, so it still
 *     looks sharp on a retina display);
 *   · it is re-encoded as WebP, which is 25–35% smaller than JPEG at the same quality and is
 *     accepted by every browser this app supports (and by the upload route: PNG/JPG/WEBP) — and
 *     where the browser cannot WRITE WebP (Safari, so every iPhone), as JPEG, or as PNG when the
 *     photo was a PNG; the file is always named and labelled as what it really is (item 26);
 *   · EXIF orientation is honoured (`imageOrientation: "from-image"`), so a portrait photo taken
 *     on a phone does not arrive on its side — the one thing a naive canvas resize gets wrong.
 *
 * FOUR RULES IT NEVER BREAKS, because an upload that fails is worse than a big file:
 *   1. it NEVER throws — any failure (an odd format, a browser that can write none of the three, a huge image
 *      the canvas refuses) returns the ORIGINAL file and the upload proceeds exactly as before;
 *   2. it never makes a file BIGGER — if the re-encode comes out heavier (already-optimised small
 *      images do), the original is kept;
 *   3. a photo that is already small AND already within the size cap is returned untouched — no
 *      pointless second round of lossy encoding on a picture somebody already optimised;
 *   4. it does not touch anything but the bytes being uploaded: no state, no network, no DOM.
 *
 * It is deliberately plain ES5-ish and dependency-free, like every other file in this folder, and
 * loaded by every panel (editor / tablet / kitchen) so one fix reaches all of them.
 */
(function () {
  "use strict";

  var MAX_EDGE = 1280;          // px on the long side
  var QUALITY = 0.82;           // WebP quality — visually indistinguishable at this size
  var SKIP_UNDER = 180 * 1024;  // a photo this small is already fine to send as it is
  var TYPES = { "image/jpeg": 1, "image/png": 1, "image/webp": 1 };
  var EXT = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };   // what we may hand back

  function readable(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";
  }

  // Draw the bitmap at the capped size and hand back a Blob, or null if this browser cannot.
  function encode(bitmap, w, h, type) {
    return new Promise(function (resolve) {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        // A photo scaled down in one step can look gritty; the browser's own smoothing is enough
        // at this ratio and costs nothing.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, w, h);
        if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b || null); }, type, QUALITY);
        else resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  // The bitmap, with the phone's rotation already applied. createImageBitmap is the only door that
  // can do that; an <img> element is the fallback for a browser without it, and there the browser
  // applies EXIF itself when it decodes.
  function toBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return null; });
    }
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  /**
   * shrink(file) → Promise<{ file, changed, from, to, note }>
   * `file` is always something you can upload: the shrunk version, or the original.
   * `note` is a short sentence for the screen ("3.4 MB → 180 KB"), empty when nothing changed.
   */
  async function shrink(file) {
    var out = { file: file, changed: false, from: file && file.size, to: file && file.size, note: "" };
    try {
      if (!file || !file.size || !TYPES[file.type]) return out;
      var bitmap = await toBitmap(file);
      if (!bitmap) return out;
      var iw = bitmap.width || bitmap.naturalWidth;
      var ih = bitmap.height || bitmap.naturalHeight;
      if (!iw || !ih) return out;
      var scale = Math.min(1, MAX_EDGE / Math.max(iw, ih));
      // Rule 3: already small and already within the cap → leave it exactly as it is.
      if (scale === 1 && file.size <= SKIP_UNDER) { if (bitmap.close) bitmap.close(); return out; }
      var w = Math.max(1, Math.round(iw * scale));
      var h = Math.max(1, Math.round(ih * scale));
      var blob = await encode(bitmap, w, h, "image/webp");
      // SAFARI CANNOT WRITE WebP, AND DOES NOT SAY SO (sweep #10 T16 round 3, item 26, 2026-10-16).
      // Asked for "image/webp", WebKit — every browser on an iPhone — quietly hands back a PNG
      // (measured: WebKit 26.6 → blob.type "image/png"). This used to wrap that PNG in a file
      // NAMED .webp and LABELLED image/webp, and the server files a photo by its label — so an
      // iPhone's dish photo was stored as a 1280 px PNG (megabytes, not the ~150 KB WebP meant)
      // under a false name, and every guest downloaded it. So the label now follows what the
      // browser really made: a PNG we were given stays PNG (it may have see-through parts a JPEG
      // would paint black); any other photo is made again as a JPEG, which every browser writes.
      if (blob && blob.type !== "image/webp") {
        if (file.type === "image/png") { if (blob.type !== "image/png") blob = null; }
        else { blob = await encode(bitmap, w, h, "image/jpeg"); if (blob && blob.type !== "image/jpeg") blob = null; }
      }
      if (bitmap.close) bitmap.close();
      // Rule 2: never upload something bigger than what we were given.
      if (!blob || blob.size >= file.size) return out;
      var name = String(file.name || "photo").replace(/\.[^.]+$/, "") + "." + EXT[blob.type];
      var shrunk = new File([blob], name, { type: blob.type, lastModified: Date.now() });
      return { file: shrunk, changed: true, from: file.size, to: shrunk.size, note: readable(file.size) + " → " + readable(shrunk.size) };
    } catch (e) {
      return out;   // Rule 1: the upload goes ahead with the original.
    }
  }

  window.LFH_IMG = { shrink: shrink, MAX_EDGE: MAX_EDGE, readable: readable };
})();
