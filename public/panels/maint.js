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
    .lfh-ov{position:fixed;inset:0;background:rgba(4,8,18,.6);backdrop-filter:blur(4px);z-index:99998;display:flex;justify-content:flex-end}
    .lfh-dw{width:min(92vw,430px);height:100%;overflow:auto;background:var(--panel,#0f1830);color:var(--text,#e7eefc);box-shadow:-20px 0 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif;animation:lfhslide .2s cubic-bezier(.16,1,.3,1)}
    @keyframes lfhslide{from{transform:translateX(40px);opacity:.2}to{transform:none;opacity:1}}
    .lfh-dw h2{font-size:16px;margin:0;font-weight:800}
    .lfh-sec{padding:16px 18px;border-bottom:1px solid var(--line,#1d2944)}
    .lfh-sec h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#7e93bd);margin:0 0 10px}
    .lfh-lab{display:block;font-size:12px;color:var(--muted,#8aa0c9);margin:0 0 4px}
    .lfh-in{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid var(--line,#2a3a5f);background:var(--bg,#0a1326);color:var(--text,#eaf1ff);font-size:14px;margin:0 0 10px;outline:none;transition:border-color .15s,box-shadow .15s}
    .lfh-in:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.22)}
    .lfh-bt{padding:11px 14px;border:0;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;color:#fff;transition:filter .15s,opacity .15s}
    .lfh-bt:hover{filter:brightness(1.08)}
    .lfh-bt:disabled{opacity:.6;cursor:default}
    .lfh-msg{font-size:12px;margin:2px 0 8px}
    .lfh-note{font-size:12px;color:var(--muted,#8aa0c9)}
    .lfh-av{width:46px;height:46px;border-radius:999px;display:grid;place-items:center;font-weight:800;font-size:20px;color:#0b1220;flex-shrink:0}
    .lfh-chip{display:inline-block;font-size:11px;font-weight:700;color:#0b1220;padding:2px 9px;border-radius:999px}
    .lfh-welcome{margin:14px 18px 0;padding:15px 16px;border-radius:14px;background:var(--panel-2,var(--bg,#0e1830));border:1px solid var(--line,#2a4474)}
    .lfh-welcome .wt{font-size:15.5px;font-weight:800;color:var(--text,#eaf1ff);margin:0 0 5px}
    .lfh-welcome .wd{font-size:12.5px;color:var(--muted,#a8bce0);line-height:1.5}`;
    document.head.appendChild(el("style", { id: "lfh-set-style", html: css }));
  }

  let profile = null; // {username, role, name, phone, hasPin, needsProfile, canSelfReset}
  let overlay = null;

  function closeDrawer() {
    // Block closing during the one-time setup until name + phone are confirmed.
    if (profile && profile.needsProfile) { alert("Please confirm your name and phone to continue."); return; }
    if (overlay) { overlay.remove(); overlay = null; }
  }

  // Role → accent colour for the avatar + chip (matches the admin Users palette).
  const ROLE_COLOR = { manager: "#d4a574", editor: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa" };

  function setMsg(node, text, good) { node.textContent = text || ""; node.style.color = good ? "#86efac" : "#fca5a5"; }

  function openDrawer() {
    injectStyles();
    if (overlay) overlay.remove();
    const roleLabel = { manager: "Manager", editor: "Manager", kitchen: "Kitchen", tablet: "Tablet (waiter)" }[profile.role] || profile.role;
    const accent = ROLE_COLOR[profile.role] || "#9ca3af";
    const displayName = profile.name || profile.username;
    // PINs are a MANAGER concept (they unlock the tablet's gated actions). The
    // maintenance switch is manager-only too. A manager who is allowed to self-set
    // a PIN and doesn't have one yet must set it during first-login setup.
    const isManager = profile.role === "manager" || profile.role === "editor";
    const pinRequiredAtSetup = !!(profile.needsProfile && isManager && profile.canSelfSetPin && !profile.hasPin);

    // — header: avatar + name + role chip (no "username" shown anywhere) —
    const closeBtn = el("button", { class: "lfh-bt", style: { background: "var(--line,#243049)", padding: "8px 12px" }, onClick: closeDrawer, "aria-label": "Close", html: "✕" });
    const header = el("div", { class: "lfh-sec", style: { display: "flex", alignItems: "center", gap: "12px", position: "sticky", top: "0", background: "var(--panel,#0f1830)", zIndex: "1" } }, [
      el("div", { class: "lfh-av", style: { background: accent } }, [(displayName || "?").charAt(0).toUpperCase()]),
      el("div", { style: { flex: "1", minWidth: "0" } }, [
        el("h2", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [displayName]),
        el("div", { style: { marginTop: "5px" } }, [el("span", { class: "lfh-chip", style: { background: accent } }, [roleLabel])]),
      ]),
      closeBtn,
    ]);

    const sections = [header];

    // — first-login welcome card (one-time; polished, not a thin strip) —
    if (profile.needsProfile) {
      const hasBoth = !!(profile.name && profile.phone);
      sections.push(el("div", { class: "lfh-welcome" }, [
        el("div", { class: "wt" }, ["👋 Welcome" + (profile.name ? ", " + profile.name : "") + "!"]),
        el("div", { class: "wd" }, [hasBoth
          ? "Please take a second to confirm your details below — you'll only do this once."
          : "Please add your phone number below to finish setting up your account. You'll only do this once."]),
      ]));
    }

    // — details (name / phone) — name doubles as the sign-in name —
    const nameIn = el("input", { class: "lfh-in", value: profile.name || "", placeholder: "Your name" });
    const phoneIn = el("input", { class: "lfh-in", value: profile.phone || "", placeholder: "Your phone number", inputmode: "tel" });
    // Managers set their PIN as part of first-login setup (only when required).
    const setupPinIn = pinRequiredAtSetup
      ? el("input", { class: "lfh-in", type: "password", placeholder: "4–8 digit manager PIN", inputmode: "numeric", maxlength: "8" })
      : null;
    const detMsg = el("div", { class: "lfh-msg" });
    const saveDet = el("button", { class: "lfh-bt", style: { background: "#22c55e", width: "100%" }, onClick: async () => {
      const name = nameIn.value.trim(), phone = phoneIn.value.trim();
      if (!name || !phone) { setMsg(detMsg, "Both your name and phone are required.", false); return; }
      const payload = { name, phone };
      if (setupPinIn) {
        const pin = setupPinIn.value.trim();
        if (!/^\d{4,8}$/.test(pin)) { setMsg(detMsg, "Set a 4–8 digit manager PIN to continue.", false); return; }
        payload.pin = pin;
      }
      saveDet.disabled = true;
      try {
        const r = await fetch("/api/panel-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const j = await r.json();
        if (!r.ok) { setMsg(detMsg, j.error || "Could not save.", false); return; }
        const wasSetup = profile.needsProfile;
        profile.name = name; profile.phone = phone; profile.needsProfile = false;
        if (setupPinIn) profile.hasPin = true;
        setMsg(detMsg, wasSetup ? "All set — welcome aboard! 🎉" : "Saved.", true);
        const sb = document.getElementById("staffSettingsBtn"); if (sb) sb.textContent = "👤 Profile";
        // Refresh the header (name/avatar) and drop the welcome card after setup.
        if (wasSetup) setTimeout(openDrawer, 700);
      } catch { setMsg(detMsg, "Network error.", false); }
      finally { saveDet.disabled = false; }
    } }, [profile.needsProfile ? "Save & continue" : "Save details"]);
    sections.push(el("div", { class: "lfh-sec" }, [
      el("h3", null, ["Your details"]),
      el("label", { class: "lfh-lab" }, ["Name (this is also your sign-in name)"]), nameIn,
      el("label", { class: "lfh-lab" }, ["Phone"]), phoneIn,
      ...(setupPinIn ? [el("label", { class: "lfh-lab" }, ["Manager PIN (unlocks sensitive tablet actions)"]), setupPinIn] : []),
      detMsg, saveDet,
    ]));

    // — password (only if allowed) —
    if (profile.canSelfReset) {
      const curIn = el("input", { class: "lfh-in", type: "password", placeholder: "Current password", autocomplete: "current-password" });
      const newIn = el("input", { class: "lfh-in", type: "password", placeholder: "New password (min 6)", autocomplete: "new-password" });
      const pwMsg = el("div", { class: "lfh-msg" });
      const savePw = el("button", { class: "lfh-bt", style: { background: "#3b82f6" }, onClick: async () => {
        if (!curIn.value || !newIn.value) { setMsg(pwMsg, "Fill both fields.", false); return; }
        savePw.disabled = true;
        try {
          const r = await fetch("/api/panel-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: curIn.value, newPassword: newIn.value }) });
          const j = await r.json();
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

    // — PIN (MANAGERS only; the PIN unlocks the tablet's gated actions). Hidden
    //   during first-login setup, where the inline field above captures it. —
    if (isManager && !profile.needsProfile) {
      if (profile.canSelfSetPin) {
        const pinIn = el("input", { class: "lfh-in", type: "password", placeholder: "4–8 digit PIN", inputmode: "numeric", maxlength: "8" });
        const pinMsg = el("div", { class: "lfh-msg" });
        const savePin = el("button", { class: "lfh-bt", style: { background: "#8b5cf6" }, onClick: async () => {
          if (!/^\d{4,8}$/.test(pinIn.value)) { setMsg(pinMsg, "PIN must be 4–8 digits.", false); return; }
          savePin.disabled = true;
          try {
            const r = await fetch("/api/panel-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pinIn.value }) });
            const j = await r.json();
            if (!r.ok) { setMsg(pinMsg, j.error || "Could not save.", false); return; }
            profile.hasPin = true; pinIn.value = ""; setMsg(pinMsg, "PIN saved.", true);
          } catch { setMsg(pinMsg, "Network error.", false); }
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
      const maintBtn = el("button", { class: "lfh-bt", style: { background: "var(--line,#243049)" } }, ["…"]);
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
      el("button", { class: "lfh-bt", style: { background: "#991b1b", width: "100%" }, onClick: () => { location.href = "/api/panel-logout"; } }, ["Log out"]),
    ]));

    const drawer = el("div", { class: "lfh-dw" }, sections);
    overlay = el("div", { class: "lfh-ov", onClick: (e) => { if (e.target === overlay) closeDrawer(); } }, [drawer]);
    document.body.appendChild(overlay);
  }

  // ── user: the ⚙️ Settings button in the top bar ────────────────────────────
  function buildSettingsButton() {
    const bar = topbar();
    if (!bar || document.getElementById("staffSettingsBtn")) return;
    const btn = el("button", { id: "staffSettingsBtn", class: "btn", style: { marginLeft: "auto" }, onClick: openDrawer },
      [profile && profile.needsProfile ? "👋 Finish setup" : "👤 Profile"]);
    bar.appendChild(btn);
  }

  async function init() {
    let res = null;
    try { res = await fetch("/api/panel-profile", { cache: "no-store" }); } catch {}
    if (res && res.ok) {
      profile = await res.json();
      buildSettingsButton();
      if (profile.needsProfile) openDrawer(); // force first-login capture
    }
    // 401 → admin super-access (no per-user profile): nothing in the panel top bar.
    // The floating "Menu live/offline" button was removed — the admin manages
    // maintenance from the /aevinite admin panel, and managers from their profile.
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
