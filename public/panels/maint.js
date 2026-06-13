// maint.js — a tiny shared control included by every staff panel
// (editor/kitchen/tablet). It drops a "Menu live / offline" toggle into the
// panel's top bar so any staff member can take the GUEST MENU offline (the
// "we'll be right back" screen) without going to the admin. Talks to the shared
// /api/maintenance endpoint and re-syncs every few seconds.
(function () {
  function init() {
    // Prefer a dedicated actions area (kitchen), else the top bar itself.
    const bar = document.querySelector(".topbar .top-actions") || document.querySelector(".topbar");
    if (!bar || document.getElementById("maintToggle")) return;

    const btn = document.createElement("button");
    btn.id = "maintToggle";
    btn.className = "btn"; // each panel already styles .btn
    btn.style.marginLeft = "auto"; // push to the right when it's the only extra
    btn.textContent = "…";
    bar.appendChild(btn);

    let on = false;
    const render = () => {
      btn.textContent = on ? "🔴 Menu offline" : "🟢 Menu live";
      btn.style.borderColor = on ? "#ef4444" : "";
      btn.style.color = on ? "#ef4444" : "";
      btn.title = on ? "Guest menu is OFFLINE — click to bring it back" : "Guest menu is live — click to take it offline";
    };
    const load = async () => {
      try {
        const r = await fetch("/api/maintenance", { cache: "no-store" });
        const j = await r.json();
        on = j.maintenance === true;
        render();
      } catch { /* transient — retry next tick */ }
    };
    btn.onclick = async () => {
      const turningOn = !on;
      const msg = turningOn
        ? "Take the guest menu OFFLINE (“we’ll be right back”)? Guests can’t browse or order until you turn it back on."
        : "Bring the guest menu back ONLINE?";
      if (!window.confirm(msg)) return;
      try {
        await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: turningOn }) });
        on = turningOn;
        render();
      } catch (e) { alert("Couldn't change it: " + (e && e.message)); }
    };

    load();
    setInterval(load, 5000);
  }
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
