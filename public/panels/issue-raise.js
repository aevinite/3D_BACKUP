/* issue-raise.js — the shared "Report an issue" widget for the staff panels
 * (manager / kitchen / tablet). One modal, so all three raise tickets the same way:
 *   • Subject + optional details
 *   • Attach a PHOTO (pick from gallery or take one on a phone)
 *   • Record a VOICE NOTE live with the mic (MediaRecorder — not a file upload)
 *
 * Usage from a panel:
 *   LFH_ISSUE.open({ api, rid, notify });
 *     api    — the panel's api(method, path, body) helper (offline-safe; the final
 *              /issue POST goes through it so it queues when offline).
 *     rid    — PANEL_RID string (admin "view as" pin) or "" for a real staff login.
 *     notify — optional (msg) => void to toast after a successful send.
 *
 * Media is uploaded FIRST to /api/issue-media (multipart → public URL), then the
 * /issue POST carries the URLs. Uploads only run while online — offline sends text
 * only (attachments need a connection). Self-contained CSS (lfhir-* classes) so it
 * looks identical whatever each panel's own stylesheet is. Registers with LFH_BACK
 * so the phone hardware Back button closes the modal instead of leaving the panel.
 */
(function () {
  "use strict";

  var MAX_AUDIO_MS = 120000; // auto-stop a voice note at 2 min (keeps the file small)
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  var OK_IMAGE = { "image/png": 1, "image/jpeg": 1, "image/webp": 1 };

  function injectCss() {
    if (document.getElementById("lfhir-css")) return;
    var s = document.createElement("style");
    s.id = "lfhir-css";
    s.textContent = [
      ".lfhir-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;",
      "background:rgba(0,0,0,.5);opacity:0;transition:opacity .18s ease}",
      ".lfhir-ov.show{opacity:1}",
      ".lfhir-box{width:100%;max-width:440px;max-height:92vh;overflow:auto;background:var(--panel,var(--bg,#fff));color:var(--text,#111);",
      "border:1px solid var(--line,rgba(0,0,0,.12));border-radius:16px;padding:18px;box-shadow:0 24px 60px rgba(0,0,0,.35);",
      "transform:translateY(8px) scale(.98);transition:transform .18s ease}",
      ".lfhir-ov.show .lfhir-box{transform:none}",
      ".lfhir-h{font-weight:800;font-size:16px;margin-bottom:3px}",
      ".lfhir-sub{color:var(--muted,#777);font-size:12.5px;margin-bottom:13px}",
      ".lfhir-inp,.lfhir-ta{width:100%;padding:10px 12px;border:1px solid var(--line,rgba(0,0,0,.14));border-radius:10px;",
      "background:var(--panel-2,var(--bg,#fff));color:var(--text,#111);font:inherit;margin-bottom:9px;box-sizing:border-box}",
      ".lfhir-ta{resize:vertical;min-height:64px}",
      ".lfhir-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}",
      ".lfhir-mbtn{flex:1;min-width:130px;display:flex;align-items:center;justify-content:center;gap:7px;padding:11px 10px;",
      "border:1px dashed var(--line,rgba(0,0,0,.28));border-radius:11px;background:transparent;color:var(--text,#111);",
      "font:inherit;font-weight:600;font-size:13px;cursor:pointer}",
      ".lfhir-mbtn:disabled{opacity:.45;cursor:not-allowed}",
      ".lfhir-mbtn.rec{border-style:solid;border-color:#e5484d;color:#e5484d}",
      ".lfhir-prev{margin-bottom:10px;display:flex;align-items:center;gap:10px;background:var(--panel-2,rgba(0,0,0,.04));",
      "border:1px solid var(--line,rgba(0,0,0,.1));border-radius:11px;padding:9px}",
      ".lfhir-prev img{width:54px;height:54px;object-fit:cover;border-radius:8px;flex-shrink:0}",
      ".lfhir-prev audio{height:34px;max-width:100%}",
      ".lfhir-prev .x{margin-left:auto;background:transparent;border:0;color:var(--muted,#888);font-size:18px;cursor:pointer;line-height:1;padding:4px}",
      ".lfhir-note{font-size:11.5px;color:var(--muted,#888);margin:-3px 0 10px}",
      ".lfhir-status{font-size:12.5px;margin-bottom:10px;min-height:16px}",
      ".lfhir-status.err{color:#e5484d}.lfhir-status.ok{color:#2e9e6b}",
      ".lfhir-acts{display:flex;gap:9px;justify-content:flex-end}",
      ".lfhir-b{padding:10px 15px;border-radius:10px;border:1px solid var(--line,rgba(0,0,0,.16));background:transparent;",
      "color:var(--text,#111);font:inherit;font-weight:700;font-size:13.5px;cursor:pointer}",
      ".lfhir-b.pri{background:var(--accent,#2f6df6);border-color:var(--accent,#2f6df6);color:#fff}",
      ".lfhir-b:disabled{opacity:.55;cursor:not-allowed}",
      ".lfhir-dot{width:9px;height:9px;border-radius:50%;background:#e5484d;display:inline-block;animation:lfhirpulse 1s infinite}",
      "@keyframes lfhirpulse{0%,100%{opacity:1}50%{opacity:.25}}",
    ].join("");
    document.head.appendChild(s);
  }

  function open(opts) {
    opts = opts || {};
    var api = opts.api;
    if (typeof api !== "function") { console.warn("LFH_ISSUE.open needs { api }"); return; }
    injectCss();

    var imageFile = null;         // File the user picked
    var audioBlob = null;         // Blob recorded from the mic
    var audioUrlLocal = null;     // object URL for the local <audio> preview
    var imageUrlLocal = null;     // object URL for the local <img> preview
    var rec = null, recStream = null, recChunks = [], recTimer = null, recStop = null;

    var ov = document.createElement("div");
    ov.className = "lfhir-ov";
    ov.innerHTML =
      '<div class="lfhir-box" role="dialog" aria-modal="true" aria-label="Report an issue">' +
        '<div class="lfhir-h">🚩 Report an issue</div>' +
        '<div class="lfhir-sub">Flag a problem (equipment, stock, staffing…). The owner and Aevidine see it.</div>' +
        '<input class="lfhir-inp" id="lfhirSubj" placeholder="Subject — e.g. Fridge not cooling" maxlength="120" />' +
        '<textarea class="lfhir-ta" id="lfhirBody" placeholder="Details (optional)" rows="3"></textarea>' +
        '<div class="lfhir-row">' +
          '<button type="button" class="lfhir-mbtn" id="lfhirPhoto"><span>📷</span> Add photo</button>' +
          '<button type="button" class="lfhir-mbtn" id="lfhirRec"><span>🎙️</span> Record voice note</button>' +
        '</div>' +
        '<input type="file" id="lfhirFile" accept="image/png,image/jpeg,image/webp" style="display:none" />' +
        '<div id="lfhirPrevs"></div>' +
        '<div class="lfhir-note" id="lfhirOffline" style="display:none">You’re offline — the ticket will send when you reconnect, but a photo or voice note needs a connection.</div>' +
        '<div class="lfhir-status" id="lfhirStatus"></div>' +
        '<div class="lfhir-acts">' +
          '<button type="button" class="lfhir-b" id="lfhirCancel">Cancel</button>' +
          '<button type="button" class="lfhir-b pri" id="lfhirSend">Send</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add("show"); });

    var $ = function (id) { return ov.querySelector("#" + id); };
    var subj = $("lfhirSubj"), bodyEl = $("lfhirBody"), status = $("lfhirStatus"),
        prevs = $("lfhirPrevs"), fileInp = $("lfhirFile"),
        photoBtn = $("lfhirPhoto"), recBtn = $("lfhirRec"), sendBtn = $("lfhirSend");

    function setStatus(msg, cls) { status.textContent = msg || ""; status.className = "lfhir-status" + (cls ? " " + cls : ""); }
    function online() { return navigator.onLine !== false; }

    function reflectOffline() {
      var off = !online();
      $("lfhirOffline").style.display = off ? "" : "none";
      // Only disable the media buttons when NOTHING is attached yet — keep them usable
      // to remove an existing attachment. (Attachments simply won't upload offline.)
      // NEVER disable the record button while a recording is in progress — the user
      // must always be able to press Stop even if the network drops mid-recording.
      photoBtn.disabled = off && !imageFile;
      recBtn.disabled = !rec && ((off && !audioBlob) || !MR_SUPPORTED);
    }

    // ── Photo ────────────────────────────────────────────────────────────────
    photoBtn.onclick = function () { if (imageFile) { clearImage(); } else { fileInp.click(); } };
    fileInp.onchange = function () {
      var f = fileInp.files && fileInp.files[0];
      fileInp.value = ""; // allow re-picking the same file later
      if (!f) return;
      if (!OK_IMAGE[f.type]) { setStatus("Photo must be a PNG, JPG or WEBP.", "err"); return; }
      if (f.size > MAX_IMAGE_BYTES) { setStatus("Photo must be 5 MB or smaller.", "err"); return; }
      setStatus("");
      imageFile = f;
      imageUrlLocal = URL.createObjectURL(f);
      renderPrevs();
    };
    function clearImage() {
      imageFile = null;
      if (imageUrlLocal) { URL.revokeObjectURL(imageUrlLocal); imageUrlLocal = null; }
      renderPrevs();
    }

    // ── Voice note (MediaRecorder) ─────────────────────────────────────────────
    var MR_SUPPORTED = typeof MediaRecorder !== "undefined" &&
      navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
    if (!MR_SUPPORTED) { recBtn.disabled = true; recBtn.title = "This device can't record audio"; }

    function pickMime() {
      var types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      for (var i = 0; i < types.length; i++) {
        try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
      }
      return "";
    }

    recBtn.onclick = async function () {
      if (audioBlob) { clearAudio(); return; }     // button doubles as "remove" once recorded
      if (rec) { stopRecording(); return; }         // currently recording → stop
      try {
        recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        setStatus("Couldn't use the microphone — allow mic access and try again.", "err");
        return;
      }
      var mime = pickMime();
      try { rec = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream); }
      catch (e) { rec = new MediaRecorder(recStream); }
      recChunks = [];
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
      rec.onstop = function () {
        var type = (rec && rec.mimeType ? rec.mimeType : "audio/webm").split(";")[0];
        audioBlob = new Blob(recChunks, { type: type });
        audioUrlLocal = URL.createObjectURL(audioBlob);
        // release the mic
        if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; }
        rec = null;
        renderPrevs();
        renderRecBtn();
      };
      setStatus("");
      rec.start();
      var t0 = Date.now();
      renderRecBtn(t0);
      recTimer = setInterval(function () { renderRecBtn(t0); }, 250);
      recStop = setTimeout(stopRecording, MAX_AUDIO_MS); // hard cap
    };

    function stopRecording() {
      if (recStop) { clearTimeout(recStop); recStop = null; }
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      if (rec && rec.state !== "inactive") { try { rec.stop(); } catch (e) {} }
    }
    function clearAudio() {
      audioBlob = null;
      if (audioUrlLocal) { URL.revokeObjectURL(audioUrlLocal); audioUrlLocal = null; }
      renderPrevs();
      renderRecBtn();
    }
    function renderRecBtn(t0) {
      if (rec && rec.state === "recording") {
        var s = Math.floor((Date.now() - t0) / 1000);
        recBtn.classList.add("rec");
        recBtn.innerHTML = '<span class="lfhir-dot"></span> Stop · ' +
          Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
      } else if (audioBlob) {
        recBtn.classList.remove("rec");
        recBtn.innerHTML = '<span>✖</span> Remove voice note';
      } else {
        recBtn.classList.remove("rec");
        recBtn.innerHTML = '<span>🎙️</span> Record voice note';
      }
    }

    // ── Previews ────────────────────────────────────────────────────────────────
    function renderPrevs() {
      prevs.innerHTML = "";
      if (imageUrlLocal) {
        var p = document.createElement("div"); p.className = "lfhir-prev";
        p.innerHTML = '<img src="' + imageUrlLocal + '" alt="attached photo" />' +
          '<span style="font-size:12.5px">Photo attached</span>' +
          '<button type="button" class="x" aria-label="Remove photo">×</button>';
        p.querySelector(".x").onclick = clearImage;
        prevs.appendChild(p);
      }
      if (audioUrlLocal) {
        var a = document.createElement("div"); a.className = "lfhir-prev";
        a.innerHTML = '<span style="font-size:18px">🎙️</span>' +
          '<audio controls src="' + audioUrlLocal + '"></audio>' +
          '<button type="button" class="x" aria-label="Remove voice note">×</button>';
        a.querySelector(".x").onclick = clearAudio;
        prevs.appendChild(a);
      }
      photoBtn.innerHTML = imageFile ? '<span>✖</span> Remove photo' : '<span>📷</span> Add photo';
    }

    // ── Upload one attachment → public URL ──────────────────────────────────────
    // EVERY WRITE ON THIS SCREEN NOW HAS A CEILING (T9 sweep, 2026-08-17).
    //
    // The ticket itself goes through the panel's api() → the shared queue, which has carried a
    // 15-second deadline since the busy-server work. This upload was the one write left with
    // none: on a database that is up but answering nothing (measured at 30–90s on 2026-07-31)
    // the modal sat on "Uploading photo…" with Send greyed out and no end to it, and the issue —
    // often the very thing being reported — never got raised. 30s rather than 15: a photo on a
    // restaurant's wifi is a genuinely slower request than a JSON write, and cutting one off
    // that was about to land would be its own fault.
    //
    // Reading AbortSignal.timeout is wrapped because it THROWS on some older phones, and staff
    // tablets are the oldest devices in the building (the same guard outbox.js carries).
    var UPLOAD_TIMEOUT_MS = 30000;
    function uploadDeadline() {
      try {
        return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(UPLOAD_TIMEOUT_MS) : undefined;
      } catch (e) { return undefined; }
    }
    async function uploadMedia(file, kind) {
      var fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      var url = "/api/issue-media" + (opts.rid ? "?rid=" + encodeURIComponent(opts.rid) : "");
      var res;
      try {
        res = await fetch(url, { method: "POST", body: fd, signal: uploadDeadline() });
      } catch (e) {
        // Name the part that failed, so "Couldn't send" doesn't read as if the whole ticket is
        // impossible — the ticket can go without the attachment, and the person can choose that.
        var slow = e && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new Error(slow
          ? "the " + (kind === "audio" ? "voice note" : "photo") + " is taking too long to upload. Remove it and send the ticket, or try again when the signal is better."
          : "the " + (kind === "audio" ? "voice note" : "photo") + " couldn't be uploaded.");
      }
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(j.error || "Upload failed");
      return j.url;
    }

    // ── Send ────────────────────────────────────────────────────────────────────
    sendBtn.onclick = async function () {
      var subject = subj.value.trim();
      if (!subject) { setStatus("Please add a subject.", "err"); subj.focus(); return; }
      sendBtn.disabled = true; photoBtn.disabled = true; recBtn.disabled = true;
      var imageUrl = null, audioUrl = null;
      try {
        if (online()) {
          if (imageFile) { setStatus("Uploading photo…"); imageUrl = await uploadMedia(imageFile, "image"); }
          if (audioBlob) {
            setStatus("Uploading voice note…");
            var ext = (audioBlob.type.indexOf("mp4") >= 0) ? "m4a" : (audioBlob.type.indexOf("ogg") >= 0 ? "ogg" : "webm");
            audioUrl = await uploadMedia(new File([audioBlob], "voice." + ext, { type: audioBlob.type }), "audio");
          }
        }
        setStatus("Sending…");
        var r = await api("POST", "/issue", { subject: subject, body: bodyEl.value.trim(), image_url: imageUrl, audio_url: audioUrl });
        var queued = r && r.queued;
        setStatus(queued ? "Saved — will send when you reconnect ✓" : "Sent ✓", "ok");
        if (opts.notify) { try { opts.notify(queued ? "Issue saved — will send when back online" : "Issue sent ✓"); } catch (e) {} }
        setTimeout(close, 650);
      } catch (e) {
        setStatus((e && e.message) ? "Couldn't send: " + e.message : "Couldn't send.", "err");
        sendBtn.disabled = false; reflectOffline();
      }
    };

    // ── Close / teardown ──────────────────────────────────────────────────────
    var offBack = (window.LFH_BACK && window.LFH_BACK.layer) ? window.LFH_BACK.layer("issue-raise", doClose) : null;
    function doClose() { close(true); }
    function close(fromBack) {
      stopRecording();
      if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; }
      if (imageUrlLocal) URL.revokeObjectURL(imageUrlLocal);
      if (audioUrlLocal) URL.revokeObjectURL(audioUrlLocal);
      if (offBack && !fromBack) { try { offBack(); } catch (e) {} }
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("online", reflectOffline);
      window.removeEventListener("offline", reflectOffline);
      ov.classList.remove("show");
      setTimeout(function () { ov.remove(); }, 200);
    }
    // A STRAY TAP MUST NOT THROW AWAY A RECORDING (T9 sweep, 2026-08-17).
    //
    // The backdrop and Escape both closed the modal outright, and close() stops the recorder and
    // drops the blob — so two minutes of a manager describing a broken fridge went, on one
    // mis-tap beside the card, with nothing said. Recording is the one state in here that holds
    // work the person cannot get back, so while it is running the two ACCIDENTAL exits refuse and
    // say why. Cancel still closes: that one is a deliberate "throw this away".
    function guardedClose() {
      if (rec && rec.state === "recording") {
        setStatus("Still recording — tap Stop first, or Cancel to throw it away.", "err");
        return;
      }
      close();
    }
    function onKey(e) { if (e.key === "Escape") guardedClose(); }

    $("lfhirCancel").onclick = function () { close(); };
    ov.onclick = function (e) { if (e.target === ov) guardedClose(); };
    document.addEventListener("keydown", onKey);
    window.addEventListener("online", reflectOffline);
    window.addEventListener("offline", reflectOffline);
    reflectOffline();
    renderPrevs();
    setTimeout(function () { subj.focus(); }, 60);
  }

  window.LFH_ISSUE = { open: open };
})();
