// public/panels/theme.js — light/dark theme for the staff panels (manager /
// kitchen / tablet), the panel-side echo of the guest menu's theme toggle.
//
// DEFAULT is LIGHT for every panel (owner 2026-06-26: "default mode should be the
// light one for every"). Staff who explicitly chose dark keep it via the saved
// localStorage("lfh_panel_theme") pref; only a brand-new browser with no saved
// choice now starts light. The choice is expressed as data-theme on the
// <html> element; each panel's style.css defines its light palette under
//   html[data-theme="light"] { … }
// so the hundreds of var(--token) references re-colour automatically.
//
// Loaded in <head> (before the stylesheet) so the attribute is set BEFORE first
// paint — no dark-then-light flash. The toggle button is wired once the DOM is
// ready. Icons are plain emoji (☀️/🌙) so this works even on the kitchen/tablet
// panels, which don't load Font Awesome.
(function () {
  var KEY = "lfh_panel_theme";
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  function paintButton(t) {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    var dark = t === "dark";
    // Show the thing you'd switch TO: a sun while dark, a moon while light.
    btn.textContent = dark ? "☀️" : "🌙";
    var label = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function apply(t) {
    var theme = t === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    paintButton(theme);
  }

  // Set the theme synchronously, before CSS paints, to avoid a flash. Default LIGHT;
  // only an explicit saved "dark" stays dark.
  apply(saved() === "dark" ? "dark" : "light");

  window.LFH_THEME = {
    get: function () { return document.documentElement.getAttribute("data-theme") || "light"; },
    set: apply,
    toggle: function () { apply(window.LFH_THEME.get() === "dark" ? "light" : "dark"); },
  };

  // ── ONE CHOICE, EVERY TAB OF THIS PANEL (owner, 2026-08-18) ───────────────────────────────────
  //
  // A staff member with the panel open twice used to switch to dark in one tab and find the other
  // still light until it was reloaded. The browser's `storage` event fires in the OTHER tabs when
  // this key changes, so the second tab can simply follow.
  //
  // BUT NEVER UNDER SOMEBODY'S FINGER. Re-colouring the whole board mid-tap is exactly the thing
  // that makes a panel feel unsafe during service — a cook halfway through pressing Ready should not
  // have the screen change under them. So a change that arrives while a pointer is down is HELD and
  // applied the moment the finger lifts. This is the one risk in the feature and it is the reason it
  // was parked before he asked for it; holding it is what makes it safe rather than merely quick.
  var held = null, down = false;
  window.addEventListener("pointerdown", function () { down = true; }, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  function release() {
    down = false;
    if (held) { var t = held; held = null; paint(t); }
  }
  // Apply WITHOUT writing back: the other tab already saved it, and re-saving the same value only
  // risks a write loop between two tabs agreeing with each other.
  function paint(t) {
    document.documentElement.setAttribute("data-theme", t);
    paintButton(t);
  }
  window.addEventListener("storage", function (e) {
    try {
      if (!e || e.key !== KEY || !e.newValue) return;
      var t = e.newValue === "dark" ? "dark" : "light";
      if (t === window.LFH_THEME.get()) return;
      if (down) { held = t; return; }     // a finger is on the screen — wait for it to lift
      paint(t);
    } catch (err) { /* a cosmetic sync; never let it break the panel */ }
  });

  function wire() {
    var btn = document.getElementById("themeToggle");
    if (btn && !btn.__themeWired) {
      btn.__themeWired = true;
      btn.addEventListener("click", function () { window.LFH_THEME.toggle(); });
    }
    paintButton(window.LFH_THEME.get()); // refresh the icon now the button exists
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
