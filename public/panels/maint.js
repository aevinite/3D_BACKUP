// maint.js — the shared staff control injected into every panel
// (manager/editor/kitchen/tablet) top bar.
//
// For a LOGGED-IN USER it shows a "⚙️ Settings" button that opens a profile
// drawer: edit name/phone, change your own password (if your admin allows it),
// set/change a PIN, take the guest menu offline, and log out. On a user's FIRST
// login it force-opens and requires name + phone before you can continue.
//
// For the ADMIN (super-access, no per-user profile) it shows the original
// "🟢 Menu live" toggle only — the admin manages everything from /admin.
//
// Pure vanilla JS, served statically (no build step). Talks to /api/panel-profile,
// /api/panel-logout and /api/maintenance.
// ── ONE in-flight read of /api/panel-profile, shared by every module in the page ─────────────
// TWO different scripts in the SAME document read this endpoint at boot: this file's init() (to
// build the ⚙️ Settings button and force first-login capture) and myprofile.js's available() (to
// decide whether the "My profile & pay" button exists at all). Neither knew about the other, so a
// panel open cost TWO identical requests — measured on the manager panel, 2026-08-04 sweep.
// This is the same single-flight the editor's own api() already uses for its GETs: concurrent
// callers share ONE request, and the entry is dropped the instant it settles, so nothing is ever
// served stale — a later read (after a save, say) still goes to the server. Defined before
// myprofile.js loads, and that file falls back to a plain fetch if this ever isn't there.
// It resolves the PARSED body, never the Response: a body can only be read once, so handing the
// same Response to two callers would let whichever parsed first starve the other.
// Shape: { ok, status, json }.
window.LFH_PROFILE_GET = window.LFH_PROFILE_GET || (function () {
  var inflight = null;
  return function profileGet() {
    if (inflight) return inflight;
    inflight = (async function () {
      var r = await fetch("/api/panel-profile", { cache: "no-store" });
      var j = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, json: j };
    })();
    var drop = function () { inflight = null; };
    inflight.then(drop, drop);
    return inflight;
  };
})();

// ── ONE WAY TO SAVE A PROFILE — through the offline queue (sweep 2026-08-05) ──────────────────
// Every write on this endpoint was a raw fetch(). outbox.js does NOT patch window.fetch — it
// exposes LFH_OUTBOX.send(), reached only through a panel's api() — so a raw fetch carries no
// X-LFH-Action-Id and is never saved on the device. The result: /api/panel-profile is in
// public/sw.js DATA_PATHS, so the screen READS offline perfectly and then simply could not SAVE,
// with nothing kept and nothing replayed. That is the opposite of the offline rule.
//
// `expect` rides along so the server's clash gate can answer "someone else changed this while you
// had it open" — the admin's twin of this screen has had that since 2026-08-04.
//
// THE PASSWORD BOX DELIBERATELY DOES NOT USE THIS. A password change must re-verify the CURRENT
// password against the live row and it bumps token_version (ending every session), so queueing it
// would mean replaying a credential check against a row that has since moved. It stays on the live
// path and says so on screen. Everything else — name, phone, PIN, personal details — is a plain
// value that is perfectly safe to deliver late.
window.LFH_PROFILE_SAVE = window.LFH_PROFILE_SAVE || async function profileSave(body, opts) {
  var expect = opts && opts.expect ? opts.expect : null;
  // The queue is loaded after this file, so resolve it at CALL time, not parse time.
  if (window.LFH_OUTBOX && window.LFH_OUTBOX.send) {
    // send() throws on a 4xx (a clash, a refused value — a person must see those) and resolves
    // { ok:true, queued:true } when it has kept the change for later. Same contract as api().
    var j = await window.LFH_OUTBOX.send({
      method: "POST", path: "/api/panel-profile", body: body,
      panel: "panel-profile", label: (opts && opts.label) || "save your profile",
      expect: expect,
    });
    return { ok: true, json: j || {}, queued: !!(j && j.queued) };
  }
  var headers = { "Content-Type": "application/json" };
  if (expect) headers["X-LFH-Expect"] = JSON.stringify(expect);
  var r = await fetch("/api/panel-profile", { method: "POST", headers: headers, body: JSON.stringify(body) });
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) { var e = new Error(d.error || "Couldn't save."); e.status = r.status; e.data = d; throw e; }
  return { ok: true, json: d, queued: false };
};

(function () {
  // ── per-device id (unchanged): rides on every request so the Operation log
  //    can name which physical device acted. Cookie "lfh_panel_device". ──────
  (function ensureDeviceId() {
    try {
      if (!/(?:^|;\s*)lfh_panel_device=/.test(document.cookie)) {
        const rand = (self.crypto && self.crypto.randomUUID)
          ? self.crypto.randomUUID().replace(/-/g, "").slice(0, 8)
          : Math.random().toString(16).slice(2, 10);
        document.cookie = "lfh_panel_device=" + rand + "; path=/; max-age=31536000; samesite=lax";
      }
    } catch { /* cookies blocked — log just won't show a device id */ }
  })();

  // ── shared maintenance (menu live/offline) state + actions ─────────────────
  let maintOn = false;
  async function fetchMaint() {
    try { const r = await fetch("/api/maintenance", { cache: "no-store" }); maintOn = (await r.json()).maintenance === true; } catch {}
    return maintOn;
  }
  async function setMaint(turnOn) {
    await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: turnOn }) });
    maintOn = turnOn;
  }

  // SIGN OUT — a POST, then go to /login (T9 improvement 13, 2026-08-06).
  //
  // /api/panel-logout is POST-only now: as a GET it ended a session from anything that merely
  // POINTED at the URL, so a waiter could be dropped out mid-service. These two buttons used to be
  // `location.href = "/api/panel-logout"`.
  //
  // A TAP MUST NEVER VANISH (CLAUDE.md). So this does not depend on the request succeeding: whatever
  // happens — offline, 500, a timeout — the browser still ends up at /login, which is the thing the
  // person asked for, and where a stale cookie is answered anyway. A form would be simpler but these
  // are buttons built by el() inside a drawer, and one of them sits behind a confirm().
  async function signOut() {
    // A hard ceiling so a hung request cannot leave the person staring at a button that did nothing.
    const stop = setTimeout(() => { location.href = "/login"; }, 4000);
    try {
      await fetch("/api/panel-logout", { method: "POST", cache: "no-store", redirect: "manual" });
    } catch { /* offline / refused — we go to /login regardless */ }
    clearTimeout(stop);
    location.href = "/login";
  }

  // ── small DOM helpers ──────────────────────────────────────────────────────
  const topbar = () => document.querySelector(".topbar .top-actions") || document.querySelector(".topbar");
  function el(tag, props, kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === "style") Object.assign(n.style, props[k]);
      else if (k.startsWith("on") && typeof props[k] === "function") n.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (k === "html") n.innerHTML = props[k];
      else n.setAttribute(k, props[k]);
    }
    (kids || []).forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }

  // ── styles for the drawer (scoped class names so they can't clash) ─────────
  function injectStyles() {
    if (document.getElementById("lfh-set-style")) return;
    const css = `
    /* centred popup: overlay scrim + dialog card (was a right-side drawer) */
    .lfh-ov{position:fixed;inset:0;background:rgba(4,8,18,.72);backdrop-filter:blur(6px);z-index:99998;display:grid;place-items:center;padding:18px;overflow:auto}
    /* solid panel bg + theme vars so the card adapts to a light OR dark panel */
    .lfh-dw{width:min(94vw,400px);max-height:calc(100dvh - 36px);overflow:auto;background:var(--panel,#0f1830);color:var(--text,#e7eefc);border:1px solid var(--line,#263a63);border-radius:22px;box-shadow:0 30px 90px rgba(0,0,0,.45);font-family:system-ui,sans-serif;animation:lfhpop .24s cubic-bezier(.16,1,.3,1)}
    /* hide the scrollbar (still scrolls) — the owner didn't want the white bar visible */
    .lfh-dw{scrollbar-width:none;-ms-overflow-style:none}
    .lfh-dw::-webkit-scrollbar{width:0;height:0;display:none}
    @keyframes lfhpop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}
    .lfh-dw h2{font-size:16px;margin:0;font-weight:800}
    .lfh-sec{padding:16px 20px;border-bottom:1px solid var(--line,#1d2944)}
    .lfh-sec:last-child{border-bottom:0}
    .lfh-sec h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#7e93bd);margin:0 0 10px}
    .lfh-hd{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line,#1d2944)}
    .lfh-x{margin-left:auto;background:var(--line,#243049);color:#fff;border:0;border-radius:10px;padding:8px 12px;cursor:pointer;font-size:13px}
    .lfh-x:hover{filter:brightness(1.15)}
    .lfh-wrap{padding:26px 22px 4px;text-align:center}
    .lfh-bigav{width:66px;height:66px;border-radius:999px;margin:0 auto 12px;display:grid;place-items:center;font-weight:800;font-size:28px;color:#0b1220;box-shadow:0 0 0 5px rgba(148,163,184,.18)}
    .lfh-h1{font-size:20px;font-weight:800;margin:13px 0 6px}
    .lfh-d{font-size:13px;color:var(--muted,#a8bce0);line-height:1.55;margin:0 auto;max-width:288px}
    .lfh-lab{display:block;font-size:12.5px;color:var(--muted,#9fb2d8);margin:0 0 5px;font-weight:600}
    .lfh-req{color:#f7a8b8;font-weight:800}
    .lfh-in{width:100%;box-sizing:border-box;padding:12px 13px;border-radius:12px;border:1px solid var(--line,#2a3a5f);background:var(--bg,#0a1326);color:var(--text,#eaf1ff);font-size:15px;margin:0 0 10px;outline:none;transition:border-color .15s,box-shadow .15s}
    .lfh-in:focus{border-color:#d4a574;box-shadow:0 0 0 3px rgba(212,165,116,.22)}
    .lfh-help{font-size:11px;color:var(--muted,#6c80a8);margin:-6px 2px 13px;line-height:1.45}
    .lfh-bt{padding:13px 14px;border:0;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;color:#fff;transition:filter .15s,opacity .15s}
    .lfh-bt:hover{filter:brightness(1.08)}
    .lfh-bt:disabled{opacity:.6;cursor:default}
    .lfh-cta{width:100%;background:linear-gradient(180deg,#4ade80,#22c55e);color:#08210f;font-weight:800;font-size:15px;box-shadow:0 8px 22px rgba(34,197,94,.28)}
    .lfh-ghost{display:block;width:100%;background:transparent;border:0;color:var(--muted,#8aa0c9);font-size:12.5px;font-weight:600;cursor:pointer;padding:8px;text-align:center}
    .lfh-ghost:hover{color:#fca5a5}
    .lfh-foot{padding:2px 20px 20px;font-size:11px;color:var(--muted,#6c80a8);text-align:center}
    .lfh-msg{font-size:12px;margin:6px 0 8px}
    .lfh-note{font-size:12px;color:var(--muted,#8aa0c9);line-height:1.5}
    .lfh-av{width:46px;height:46px;border-radius:999px;display:grid;place-items:center;font-weight:800;font-size:20px;color:#0b1220;flex-shrink:0}
    .lfh-chip{display:inline-block;font-size:11px;font-weight:700;color:#0b1220;padding:2px 9px;border-radius:999px}`;
    document.head.appendChild(el("style", { id: "lfh-set-style", html: css }));
  }

  let profile = null; // {username, role, name, phone, hasPin, needsProfile, canSelfReset}
  let overlay = null;

  let backOff = null; // LFH_BACK unregister for the open drawer — hardware BACK closes it (B6)
  // Hardware BACK pressed: backstack has ALREADY popped this layer. During forced first-login setup,
  // swallow it (stay open + re-arm) so Back can neither skip setup nor exit the whole panel; else close.
  function onBackClose() {
    backOff = null;
    if (profile && profile.needsProfile) { armBack(); return; }
    if (overlay) { overlay.remove(); overlay = null; }
  }
  function armBack() { if (window.LFH_BACK && !backOff) backOff = window.LFH_BACK.layer("staff-profile", onBackClose); }
  function closeDrawer() {
    // Block closing (✕ / backdrop) during the one-time setup until name + phone are confirmed.
    if (profile && profile.needsProfile) { alert("Please confirm your username and phone to continue."); return; }
    if (backOff) { backOff(); backOff = null; } // rewind the hardware-Back history entry
    if (overlay) { overlay.remove(); overlay = null; }
  }

  // Role → accent colour for the avatar + chip (matches the admin Users palette).
  const ROLE_COLOR = { manager: "#d4a574", editor: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa" };

  function setMsg(node, text, good) { node.textContent = text || ""; node.style.color = good ? "#86efac" : "#fca5a5"; }

  function openDrawer() {
    injectStyles();
    if (backOff) { backOff(); backOff = null; }
    if (overlay) overlay.remove();
    const roleLabel = { manager: "Manager", editor: "Manager", kitchen: "Kitchen", tablet: "Tablet (waiter)" }[profile.role] || profile.role;
    const accent = ROLE_COLOR[profile.role] || "#9ca3af";
    const displayName = profile.name || profile.username;
    const initial = (displayName || "?").charAt(0).toUpperCase();
    // PINs are a MANAGER concept (they unlock the tablet's gated actions). The
    // maintenance switch is manager-only too. A manager who is allowed to self-set
    // a PIN and doesn't have one yet must set it during first-login setup.
    const isManager = profile.role === "manager" || profile.role === "editor";
    const setup = !!profile.needsProfile;
    const pinRequiredAtSetup = !!(setup && isManager && profile.canSelfSetPin && !profile.hasPin);

    const sections = [];

    // — TOP — onboarding gets a centred welcome (no dismiss); everyday gets a compact header + ✕ —
    if (setup) {
      sections.push(el("div", { class: "lfh-wrap" }, [
        el("div", { class: "lfh-bigav", style: { background: accent } }, [initial]),
        el("div", null, [el("span", { class: "lfh-chip", style: { background: accent } }, [roleLabel])]),
        el("div", { class: "lfh-h1" }, ["Welcome, " + (profile.name || displayName) + " 👋"]),
        el("div", { class: "lfh-d" }, [(profile.name && profile.phone)
          ? "Confirm your details to finish setting up your account. You'll only do this once."
          : "Add your details below to finish setting up your account. You'll only do this once."]),
      ]));
    } else {
      const closeBtn = el("button", { class: "lfh-x", onClick: closeDrawer, "aria-label": "Close", html: "✕" });
      sections.push(el("div", { class: "lfh-hd" }, [
        el("div", { class: "lfh-av", style: { background: accent } }, [initial]),
        el("div", { style: { flex: "1", minWidth: "0" } }, [
          el("h2", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [displayName]),
          el("div", { style: { marginTop: "5px" } }, [el("span", { class: "lfh-chip", style: { background: accent } }, [roleLabel])]),
        ]),
        closeBtn,
      ]));
    }

    // — details (name / phone) — name doubles as the sign-in name —
    const nameIn = el("input", { class: "lfh-in", value: profile.name || "", placeholder: "Your username" });
    const phoneIn = el("input", { class: "lfh-in", value: profile.phone || "", placeholder: "Your phone number", inputmode: "tel" });
    // Managers set their PIN as part of first-login setup (only when required).
    const setupPinIn = pinRequiredAtSetup
      ? el("input", { class: "lfh-in", type: "password", placeholder: "4–8 digit manager PIN", inputmode: "numeric", maxlength: "8" })
      : null;
    const detMsg = el("div", { class: "lfh-msg" });
    const saveDet = el("button", { class: "lfh-bt lfh-cta", onClick: async () => {
      const name = nameIn.value.trim(), phone = phoneIn.value.trim();
      if (!name || !phone) { setMsg(detMsg, "Both your username and phone are required.", false); return; }
      const payload = { name, phone };
      if (setupPinIn) {
        const pin = setupPinIn.value.trim();
        if (!/^\d{4,8}$/.test(pin)) { setMsg(detMsg, "Set a 4–8 digit manager PIN to continue.", false); return; }
        payload.pin = pin;
      }
      saveDet.disabled = true;
      try {
        // Through the queue (sweep 2026-08-05) so a name/phone/PIN taken with no signal is kept on
        // the device and delivered, instead of failing with nothing saved. `expect` names what this
        // form was editing FROM, so if a manager changed the same phone meanwhile, the server says so.
        const res = await window.LFH_PROFILE_SAVE(payload, {
          label: "save your details",
          // Only when we know the row id — an expectation without one is ignored by the server,
          // which would read as "protected" while protecting nothing.
          expect: profile.id ? { table: "staff_users", id: profile.id, fields: { phone: profile.phone ?? null } } : null,
        });
        if (res.queued) { setMsg(detMsg, "Saved on this device — it will sync when you're back online.", true); return; }
        const wasSetup = profile.needsProfile;
        profile.name = name; profile.phone = phone; profile.needsProfile = false;
        if (setupPinIn) profile.hasPin = true;
        setMsg(detMsg, wasSetup ? "All set — welcome aboard! 🎉" : "Saved.", true);
        setSettingsBtnLabel(false);   // setup done → the everyday "👤 Profile" wording
        // Re-render as the everyday profile card after first-login setup.
        if (wasSetup) setTimeout(openDrawer, 700);
      // SAY WHAT WENT WRONG. This used to swallow everything as "Network error." — so a refused
      // value, a taken username, and "someone else changed this while you had it open" all read as
      // an internet problem the person could do nothing about.
      } catch (e) { setMsg(detMsg, (e && e.message) || "Network error.", false); }
      finally { saveDet.disabled = false; }
    } }, [setup ? "Save & continue" : "Save details"]);
    const detailKids = [];
    if (!setup) detailKids.push(el("h3", null, ["Your details"]));
    detailKids.push(el("label", { class: "lfh-lab" }, ["Username ", el("span", { class: "lfh-req" }, ["*"])]));
    detailKids.push(nameIn);
    detailKids.push(el("div", { class: "lfh-help" }, ["This is also your sign-in name."]));
    detailKids.push(el("label", { class: "lfh-lab" }, ["Phone ", ...(setup ? [el("span", { class: "lfh-req" }, ["*"])] : [])]));
    detailKids.push(phoneIn);
    detailKids.push(el("div", { class: "lfh-help" }, ["Used so your team can reach you."]));
    if (setupPinIn) {
      detailKids.push(el("label", { class: "lfh-lab" }, ["Manager PIN ", el("span", { class: "lfh-req" }, ["*"])]));
      detailKids.push(setupPinIn);
      detailKids.push(el("div", { class: "lfh-help" }, ["Unlocks sensitive tablet actions (close a busy table, ban a guest, apply a discount)."]));
    }
    detailKids.push(detMsg);
    detailKids.push(saveDet);
    sections.push(el("div", { class: "lfh-sec" }, detailKids));

    // — everyday-only sections: password / PIN / guest menu / log out (hidden during first-login) —
    if (!setup) {
      // — password (only if allowed) —
      if (profile.canSelfReset) {
        const curIn = el("input", { class: "lfh-in", type: "password", placeholder: "Current password", autocomplete: "current-password" });
        const newIn = el("input", { class: "lfh-in", type: "password", placeholder: "New password (min 6)", autocomplete: "new-password" });
        const pwMsg = el("div", { class: "lfh-msg" });
        const savePw = el("button", { class: "lfh-bt", style: { background: "#3b82f6" }, onClick: async () => {
          if (!curIn.value || !newIn.value) { setMsg(pwMsg, "Fill both fields.", false); return; }
          savePw.disabled = true;
          try {
            // DELIBERATELY A LIVE FETCH, NOT THE QUEUE (sweep 2026-08-05). Every other write on
            // this screen now goes through LFH_PROFILE_SAVE so it survives a dead connection — but a
            // password change must check the CURRENT password against the live row and it bumps
            // token_version, ending every session. Delivering that later would re-check a credential
            // against a row that has since moved. So it stays live, and says so if there's no signal.
            if (navigator.onLine === false) { setMsg(pwMsg, "You're offline — a password change needs a connection. Try again when you're back online.", false); return; }
            const r = await fetch("/api/panel-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: curIn.value, newPassword: newIn.value }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { setMsg(pwMsg, j.error || "Could not change.", false); return; }
            setMsg(pwMsg, "Password changed — signing you out…", true);
            setTimeout(() => { location.href = "/login"; }, 900);
          } catch { setMsg(pwMsg, "Network error.", false); }
          finally { savePw.disabled = false; }
        } }, ["Change password"]);
        sections.push(el("div", { class: "lfh-sec" }, [
          el("h3", null, ["Change password"]),
          curIn, newIn, pwMsg, savePw,
        ]));
      } else {
        sections.push(el("div", { class: "lfh-sec" }, [
          el("h3", null, ["Password"]),
          el("div", { class: "lfh-note" }, ["Your admin manages your password. Ask them to reset it if needed."]),
        ]));
      }

      // — PIN (MANAGERS only; the PIN unlocks the tablet's gated actions) —
      if (isManager) {
        if (profile.canSelfSetPin) {
          const pinIn = el("input", { class: "lfh-in", type: "password", placeholder: "4–8 digit PIN", inputmode: "numeric", maxlength: "8" });
          const pinMsg = el("div", { class: "lfh-msg" });
          const savePin = el("button", { class: "lfh-bt", style: { background: "#8b5cf6" }, onClick: async () => {
            if (!/^\d{4,8}$/.test(pinIn.value)) { setMsg(pinMsg, "PIN must be 4–8 digits.", false); return; }
            savePin.disabled = true;
            try {
              // Queued like the details above (sweep 2026-08-05): a PIN set with no signal is kept
              // and delivered rather than lost. No `expect` — a PIN is write-only (the server never
              // sends the hash back), so there is no previous value to compare against.
              const res = await window.LFH_PROFILE_SAVE({ pin: pinIn.value }, { label: "set your PIN" });
              if (res.queued) { setMsg(pinMsg, "Saved on this device — it will sync when you're back online.", true); return; }
              profile.hasPin = true; pinIn.value = ""; setMsg(pinMsg, "PIN saved.", true);
            } catch (e) { setMsg(pinMsg, (e && e.message) || "Network error.", false); }
            finally { savePin.disabled = false; }
          } }, [profile.hasPin ? "Change PIN" : "Set PIN"]);
          sections.push(el("div", { class: "lfh-sec" }, [
            el("h3", null, [profile.hasPin ? "Change your PIN" : "Set a PIN"]),
            el("div", { class: "lfh-note", style: { margin: "0 0 8px" } }, ["Your manager PIN authorises sensitive actions on the tablet (close/restart a busy table, ban a guest, apply a discount)."]),
            pinIn, pinMsg, savePin,
          ]));
        } else {
          sections.push(el("div", { class: "lfh-sec" }, [
            el("h3", null, ["Your PIN"]),
            el("div", { class: "lfh-note" }, ["Your admin manages your PIN. Ask them to set or change it."]),
          ]));
        }
      }

      // — guest menu live/offline (MANAGERS only; kitchen/tablet never see this) —
      if (isManager) {
        const maintBtn = el("button", { class: "lfh-bt", style: { background: "var(--line,#243049)", width: "100%" } }, ["…"]);
        const renderMaint = () => {
          maintBtn.textContent = maintOn ? "🔴 Bring menu back online" : "🟢 Take guest menu offline";
          maintBtn.style.background = maintOn ? "#7f1d1d" : "var(--line,#243049)";
        };
        maintBtn.addEventListener("click", async () => {
          const turnOn = !maintOn;
          const msg = turnOn ? "Take the guest menu OFFLINE (“we’ll be right back”)? Guests can’t browse or order until it’s back." : "Bring the guest menu back ONLINE?";
          if (!confirm(msg)) return;
          try { await setMaint(turnOn); renderMaint(); } catch (e) { alert("Couldn't change it: " + (e && e.message)); }
        });
        fetchMaint().then(renderMaint);
        sections.push(el("div", { class: "lfh-sec" }, [
          el("h3", null, ["Guest menu"]),
          maintBtn,
        ]));
      }

      // — log out —
      sections.push(el("div", { class: "lfh-sec" }, [
        el("button", { class: "lfh-bt", style: { background: "#991b1b", width: "100%" }, onClick: () => signOut() }, ["Sign out"]),
      ]));
    } else {
      // — first-login: a quiet "not you?" escape + reassuring footer (no full menu) —
      sections.push(el("div", { class: "lfh-sec", style: { paddingTop: "4px" } }, [
        el("button", { class: "lfh-ghost", onClick: () => { if (confirm("Sign out and sign in as someone else?")) signOut(); } }, ["Not you? Sign out"]),
      ]));
      sections.push(el("div", { class: "lfh-foot" }, ["🔒 Visible only to you and your team"]));
    }

    const drawer = el("div", { class: "lfh-dw" }, sections);
    overlay = el("div", { class: "lfh-ov", onClick: (e) => { if (e.target === overlay) closeDrawer(); } }, [drawer]);
    document.body.appendChild(overlay);
    armBack(); // hardware BACK now closes this popup instead of exiting the whole panel (B6)
  }

  // Paint the top-bar button's label. The glyph and the WORD are separate spans so a narrow phone
  // can drop just the word (each panel's CSS targets `[data-mode="profile"] .ssb-t`): the manager
  // top bar wanted 373px of a 348px row at 360px and this button, being last in the row, was the
  // one clipped — to "Profil" (T12 phone sweep, 2026-08-05). aria-label carries the full wording so
  // hiding the word never hides it from a screen reader, and data-mode keeps the one-time
  // "👋 Finish setup" state fully worded — that one is an invitation, not a utility. Called on
  // build AND after first-login setup, so the spans are never wiped by a bare textContent assign.
  function setSettingsBtnLabel(setup) {
    const b = document.getElementById("staffSettingsBtn");
    if (!b) return;
    const word = setup ? "Finish setup" : "Profile";
    b.setAttribute("data-mode", setup ? "setup" : "profile");
    b.setAttribute("aria-label", word);
    b.textContent = "";
    b.appendChild(el("span", { class: "ssb-i", "aria-hidden": "true" }, [setup ? "👋" : "👤"]));
    b.appendChild(el("span", { class: "ssb-t" }, [" " + word]));
  }

  // ── user: the ⚙️ Settings button in the top bar ────────────────────────────
  function buildSettingsButton() {
    const bar = topbar();
    if (!bar || document.getElementById("staffSettingsBtn")) return;
    // #9: a panel with its OWN profile menu (the tablet's ☰ hamburger) sets
    // window.LFH_SUPPRESS_SETTINGS_BTN so we don't ALSO inject this "👤 Profile" button
    // (two overlapping profile menus crowded the phone top bar). We STILL show the button
    // for the one-time "👋 Finish setup" capture, since that flow lives here, not in the
    // hamburger — once profile is confirmed the everyday button stays hidden on those panels.
    if (window.LFH_SUPPRESS_SETTINGS_BTN && !(profile && profile.needsProfile)) return;
    const btn = el("button", { id: "staffSettingsBtn", class: "btn", style: { marginLeft: "auto" }, onClick: openDrawer });
    bar.appendChild(btn);
    setSettingsBtnLabel(!!(profile && profile.needsProfile));
  }

  async function init() {
    // EVERY OWNER-PANEL EMBED, not just Manager mode (fixed 2026-08-05). This drawer is a
    // STAFF-account thing (first-login name/phone capture, PIN, panel password) and the owner
    // manages their identity in the owner panel, so it has no business inside a cockpit page.
    // Two harms, both real:
    //   • `profile.needsProfile` FORCES the drawer open at boot, and in setup mode it has no ✕
    //     and re-arms the hardware BACK layer on purpose — so an owner whose row was never
    //     "confirmed" met an un-closable "Welcome, finish setting up your account" card sitting
    //     on top of their Menu editor. Every owner created from /aevinite → Owners is in that
    //     state, because that screen stores no phone and mig 064 only backfilled name+phone rows.
    //   • even when not forced, the drawer swallows one BACK press before the page can use it.
    // ownermode was guarded on 2026-08-02; menuonly (owner → Menu) and invonly (owner →
    // Inventory) were missed, which is where the owner actually hit it.
    const embedQ = new URLSearchParams(location.search);
    if (["ownermode", "menuonly", "invonly"].some((k) => embedQ.get(k) === "1")) return;
    let res = null;
    // the shared single-flight (top of this file) — myprofile.js reads the same endpoint at boot
    try { res = await window.LFH_PROFILE_GET(); } catch {}
    if (res && res.ok) {
      profile = res.json;
      // { staff: false } → admin super-access / signed-out tab: there is no per-user
      // profile to show, so leave the top bar alone. (The endpoint answers 200 for this
      // now instead of 401, which used to log a red console error on every panel load.)
      if (!profile || profile.staff === false || profile.error) { profile = null; return; }
      // REJECTED (owner, 2026-07-29 · 2026-08-05 · 2026-08-07 · settled 2026-08-08):
      // a panel may declare it has NO profile of any kind, and then this file adds NOTHING to it —
      // not the everyday "👤 Profile" button and not the one-time first-login capture card. That is
      // stronger than LFH_SUPPRESS_SETTINGS_BTN, which the waiter tablet uses to hide only the
      // everyday button because it DOES have a profile behind its own ☰ menu.
      // The KITCHEN sets this. His words: "Kitchen panel will not have profile or stuff like that."
      // Safe to skip the capture: `needsProfile` is a UI flag only — panel-login returns it but never
      // blocks on it, and nothing outside this card reads `profile_confirmed`. A cook simply never
      // sees it. See docs/REJECTED-IDEAS.md → R7.
      if (window.LFH_NO_PROFILE_AT_ALL) return;
      buildSettingsButton();
      if (profile.needsProfile) openDrawer(); // force first-login capture
    }
    // No staff profile → admin super-access: nothing in the panel top bar.
    // The floating "Menu live/offline" button was removed — the admin manages
    // maintenance from the /aevinite admin panel, and managers from their profile.
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
