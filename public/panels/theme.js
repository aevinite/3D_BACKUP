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
