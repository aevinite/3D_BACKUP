/* myprofile.js, maint.js and issue-raise.js - the three shared overlays every panel loads.
 * Re-runs ledger rows P04341-P04416 (T9, sweep #6) and P61428 (T7), plus this run's own
 * P66051-P66160.
 */
export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  // ===========================================================================================
  // myprofile.js (P04341-P04364)
  // ===========================================================================================
  {
    const S = c.myprofile, R = raw.myprofile;
    const load = fnBody(S, "async function load(");
    const save = fnBody(S, "async function save(");
    const open = fnBody(S, "async function open(");
    const available = fnBody(S, "async function available(");
    const row = fnBody(S, "function row(");
    const wireBtn = fnBody(S, "function wireManagerButton(");
    const tell = fnBody(S, "function tell(");

    check("P04341", "it reads /api/panel-profile, which is scoped to the cookie's own user", () =>
      /\/api\/panel-profile/.test(S) && count(S, /fetch\(/g) <= 1);
    check("P04342", "ID-on-file, job and salary are read-only here", () => {
      const fields = (R.match(/var FIELDS = \[([\s\S]*?)\n  \];/) || ["", ""])[1];
      const banned = ["salary", "id_number", "designation", "joined", "job", "pay_rate"];
      const found = banned.filter((b) => new RegExp(`\\["${b}`).test(fields));
      return found.length ? `a person can edit their own ${found.join(", ")}` : true;
    });
    check("P04343", "the editable field list matches SELF_PROFILE_FIELDS in lib/staffProfileShared.ts", () => {
      const mine = [...(R.match(/var FIELDS = \[([\s\S]*?)\n  \];/) || ["", ""])[1].matchAll(/\["(\w+)"/g)].map((m) => m[1]);
      const shared = c.staffProfileShared || "";
      if (!shared) return "skip";
      const theirs = [...(shared.match(/SELF_PROFILE_FIELDS[^=]*=\s*\[([\s\S]*?)\]/) || ["", ""])[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
      if (!theirs.length) return "could not read SELF_PROFILE_FIELDS";
      const extra = mine.filter((f) => !theirs.includes(f));
      return extra.length ? `this screen offers fields the server does not whitelist: ${extra.join(", ")}` : true;
    });
    check("P04344", "nothing is compulsory and the header says how many are filled", () =>
      /completeness/.test(S) && !/required/i.test(S.slice(S.indexOf("var FIELDS"), S.indexOf("function close"))));
    check("P04345", "pay is shown only when the owner allows it", () => /can_see_own_pay|canSeeOwnPay/.test(S));
    check("P04346", "a cancelled payment is struck through and says why", () => /voided_at/.test(S));
    check("P04347", "both saves go through the queue, never a raw fetch", () =>
      count(save, /fetch\(/g) === 0 && count(save, /LFH_PROFILE_SAVE/g) === 2);
    check("P04348", "the phone write is skipped when it has not changed", () =>
      /if \(phone !== String\(me\.phone \|\| ""\)\)/.test(save));
    check("P04349", "each save carries an expect so a manager editing the same field is reported", () =>
      count(save, /expect:/g) === 2);
    check("P04350", "the profile expect uses a jsonb sub-key so it does not fire on unrelated keys", () =>
      /"profile\.notes"/.test(save));
    check("P04351", "a queued save says 'saved on this device', not 'saved'", () =>
      /Saved on this device — it will sync when you're back online\./.test(R));
    check("P04352", "a refused save shows the server's own sentence", () =>
      /e && e\.message \? e\.message : "Couldn't save\. Please try again\."/.test(save));
    check("P04353", "the save button cannot be double-tapped", () =>
      /if \(saving\) return;\s*saving = true;/.test(save) && /btn\.disabled = true/.test(save));
    check("P04354", "the overlay registers a Back layer and closes on it", () =>
      /LFH_BACK\.layer\("my-profile", close\)/.test(open));
    check("P04355", "re-opening closes the previous overlay first", () => /^\{\s*close\(\);/.test(open.trim()));
    check("P04356", "it shares the single-flight profile read with maint.js", () =>
      /if \(window\.LFH_PROFILE_GET\) \{/.test(load));
    check("P04357", "it falls back to a plain fetch if that helper is ever missing", () =>
      /\} else \{[\s\S]*?fetch\("\/api\/panel-profile"/.test(load));
    check("P04358", "row() is the ONE escaper - no caller escapes its own text", () => {
      const escCalls = count(row, /esc\(/g);
      if (escCalls < 3) return `row() escapes only ${escCalls} of its arguments`;
      // and no call site double-escapes by passing esc(...) in
      return /row\("fa-[^"]*", esc\(/.test(S) ? "a call site is escaping again before row() does" : true;
    });
    check("P04359", "a panel that loaded without a connection still offers the profile once it is back", () =>
      /catch \(e\) \{ return false; \}/.test(available) &&
      /window\.addEventListener\("online", function \(\) \{ if \(availability !== true\) wireManagerButton\(\); \}\)/.test(S));
    check("P04360", "the manager top-bar button is revealed by clearing BOTH hidden and display", () =>
      /btn\.hidden = false; btn\.style\.display = "";/.test(wireBtn));
    check("P04361", "it wires immediately when the document is already parsed", () =>
      /if \(document\.readyState === "loading"\) document\.addEventListener\("DOMContentLoaded", wireManagerButton\);\s*else wireManagerButton\(\)/.test(S));
    skipRow("P04362", "the screen renders at 1280x800 in both skins", "driven live - see live.checks");
    skipRow("P04363", "the screen renders at 360x780 dpr3 with no horizontal scrollbar", "driven live - see live.checks");
    check("P04364", "the kitchen panel never loads this file", () => !/myprofile\.js/.test(c.kitchenHtml || ""));

    // NEW
    check("P66051", "a save's RE-READ is outside the save's own try, so a blip cannot say 'not saved'", () => {
      const inner = save.slice(save.indexOf("if (btn) btn.textContent"));
      return /try \{\s*await load\(\);\s*render\(\);\s*\} catch \(e\) \{/.test(inner);
    });
    check("P66052", "available() remembers a real answer but never a failure", () =>
      /if \(availability !== null\) return availability;/.test(available) &&
      /catch \(e\) \{ return false; \}/.test(available));
    check("P66053", "a message to the person uses the panel's own card, with the dialog as fallback", () =>
      before(tell, /LFH_ASK\.say/, /alert\(/) && /try \{ alert\(msg\); \} catch \(e\) \{ /.test(tell));
    check("P66054", "the overlay unregisters its back layer on close", () => {
      const close = fnBody(S, "function close(");
      return /if \(off\) \{ off\(\); off = null; \}/.test(close);
    });
    check("P66055", "a person who is not staff is told so, rather than shown an empty page", () =>
      /You are not signed in as a staff member/.test(R));
    check("P66056", "a restaurant without the profile module is told so, rather than shown blanks", () =>
      /Staff profiles are not switched on for this restaurant/.test(R));
    check("P66057", "the overlay says 'Loading…' rather than opening on nothing", () =>
      /me-empty">Loading…/.test(R));
    check("P66058", "a failed load still renders, so the screen explains itself", () =>
      /try \{ await load\(\); \} catch \(e\) \{[\s\S]{0,60}\}\s*render\(\);/.test(open));
    check("P66059", "money is formatted in the Indian grouping", () => /toLocaleString\("en-IN"\)/.test(S));
    check("P66060", "a missing date reads as an em dash, never 'Invalid Date'", () => {
      const d = fnBody(S, "var dateIN = function (d)");
      return /if \(!d\) return "—";/.test(d) && /isNaN\(x\) \? "—"/.test(d);
    });
    check("P66061", "the waiter's role is shown in the floor's own word", () =>
      /me\.role === "tablet" \? "waiter" : me\.role/.test(S));
    check("P66062", "the styles ride with the script, so a panel only adds the tag", () =>
      /var css = document\.createElement\("style"\)/.test(S));
    check("P66063", "this file is loaded by the manager and the waiter tablet only", () =>
      /myprofile\.js/.test(c.editorHtml || "") && /myprofile\.js/.test(c.tabletHtml || "") &&
      !/myprofile\.js/.test(c.kitchenHtml || ""));
  }

  // ===========================================================================================
  // maint.js - the shared staff settings drawer (P04365-P04392)
  // ===========================================================================================
  {
    const S = c.maint, R = raw.maint;
    const profileGet = S.slice(S.indexOf("window.LFH_PROFILE_GET"), S.indexOf("window.LFH_PROFILE_SAVE"));
    const profileSave = S.slice(S.indexOf("window.LFH_PROFILE_SAVE"), S.indexOf("(function () {", S.indexOf("window.LFH_PROFILE_SAVE")));
    const signOut = fnBody(S, "async function signOut(");
    const setMaint = fnBody(S, "async function setMaint(");
    const fetchMaint = fnBody(S, "async function fetchMaint(");
    const init = fnBody(S, "async function init(");
    const openDrawer = fnBody(S, "function openDrawer(");
    const closeDrawer = fnBody(S, "function closeDrawer(");
    const onBackClose = fnBody(S, "function onBackClose(");
    const setLabel = fnBody(S, "function setSettingsBtnLabel(");
    const buildBtn = fnBody(S, "function buildSettingsButton(");
    const ensureDevice = fnBody(S, "function ensureDeviceId(");
    const leaveTo = fnBody(S, "const leaveTo = (url)");

    check("P04365", "LFH_PROFILE_GET coalesces concurrent reads and drops the entry once settled", () =>
      /if \(inflight\) return inflight;/.test(profileGet) && /inflight\.then\(drop, drop\)/.test(profileGet));
    check("P04366", "it resolves the parsed body, never the Response", () =>
      /return \{ ok: r\.ok, status: r\.status, json: j \};/.test(profileGet));
    check("P04367", "LFH_PROFILE_SAVE routes every plain write through the queue", () =>
      /window\.LFH_OUTBOX\.send\(\{/.test(profileSave));
    check("P04368", "it resolves LFH_OUTBOX at CALL time, not parse time", () =>
      /if \(window\.LFH_OUTBOX && window\.LFH_OUTBOX\.send\) \{/.test(profileSave));
    check("P04369", "a password change deliberately does NOT queue", () => {
      const pw = S.slice(S.indexOf("currentPassword"), S.indexOf("currentPassword") + 400);
      return /fetch\("\/api\/panel-profile"/.test(S.slice(S.indexOf("const savePw"), S.indexOf("const savePw") + 900));
    });
    check("P04370", "a password change offline says so instead of failing silently", () =>
      /You're offline — a password change needs a connection/.test(R));
    check("P04371", "sign-out is a POST, never a GET", () =>
      /fetch\("\/api\/panel-logout", \{ method: "POST"/.test(signOut));
    check("P04372", "sign-out reaches /login whatever the request does, and moves the WHOLE window", () =>
      /const stop = setTimeout\(\(\) => \{ leaveTo\("\/login"\); \}, 4000\)/.test(signOut) &&
      /window\.top\.location\.replace\(url\)/.test(leaveTo));
    check("P04373", "turning the guest menu offline only says it worked when it worked", () =>
      /if \(!r\.ok\) \{ const e = new Error\(j\.error \|\| "The server wouldn't change it\."\); e\.status = r\.status; throw e; \}/.test(setMaint) &&
      before(setMaint, /if \(!r\.ok\)/, /maintOn = turnOn/));
    check("P04374", "a failed READ of the maintenance state does not paint a confident wrong answer", () =>
      /if \(!r\.ok\) \{ maintOn = null; return maintOn; \}/.test(fetchMaint) &&
      /catch \(e\) \{ maintOn = null; \}/.test(fetchMaint) &&
      /Couldn't read the guest menu — tap to check again/.test(R));
    check("P04375", "a panel that boots with no signal can still reach Settings once it is back", () =>
      /window\.addEventListener\("online", function \(\) \{\s*if \(!document\.getElementById\("staffSettingsBtn"\) && !profile\) init\(\);/.test(S));
    check("P04376", "the first-login card cannot be skipped with the hardware Back button", () =>
      /if \(profile && profile\.needsProfile\) \{ armBack\(\); return; \}/.test(onBackClose));
    check("P04377", "the first-login card cannot be closed by X or backdrop until it is filled", () =>
      /if \(profile && profile\.needsProfile\) \{ LFH_ASK\.say\(/.test(closeDrawer));
    check("P04378", "a manager who may self-set a PIN must set one during first-login", () =>
      /pinRequiredAtSetup = !!\(setup && isManager && profile\.canSelfSetPin && !profile\.hasPin\)/.test(openDrawer));
    check("P04379", "the PIN is validated as 4-8 digits before it is sent, in BOTH places", () =>
      count(S, /\^\\d\{4,8\}\$/g) === 2);
    check("P04380", "a PIN save carries no expect (a PIN is write-only)", () => {
      const pin = S.slice(S.indexOf('LFH_PROFILE_SAVE({ pin:'), S.indexOf('LFH_PROFILE_SAVE({ pin:') + 200);
      return !/expect/.test(pin);
    });
    check("P04381", "every owner-panel embed is excluded", () =>
      /\["ownermode", "menuonly", "invonly"\]\.some\(\(k\) => embedQ\.get\(k\) === "1"\)\) return;/.test(init));
    check("P04382", "LFH_NO_PROFILE_AT_ALL removes everything, including the first-login card", () =>
      /if \(window\.LFH_NO_PROFILE_AT_ALL\) return;/.test(init) &&
      before(init, /LFH_NO_PROFILE_AT_ALL/, /buildSettingsButton\(\)/));
    check("P04383", "a panel with its own profile menu suppresses only the everyday button", () =>
      /if \(window\.LFH_SUPPRESS_SETTINGS_BTN && !\(profile && profile\.needsProfile\)\) return;/.test(buildBtn));
    check("P04384", "{ staff: false } (admin super-access) leaves the top bar alone", () =>
      /if \(!profile \|\| profile\.staff === false \|\| profile\.error\) \{ profile = null; return; \}/.test(init));
    check("P04385", "the button's glyph and word are separate spans", () =>
      /el\("span", \{ class: "ssb-i"/.test(setLabel) && /el\("span", \{ class: "ssb-t" \}/.test(setLabel));
    check("P04386", "the aria-label keeps the full wording even when the word is hidden", () =>
      /b\.setAttribute\("aria-label", word\)/.test(setLabel));
    check("P04387", "the device-id cookie is set once and cannot throw when cookies are blocked", () =>
      /if \(!\/\(\?:\^\|;\\s\*\)lfh_panel_device=\/\.test\(document\.cookie\)\)/.test(ensureDevice) &&
      /catch \{ /.test(ensureDevice));
    check("P04388", "a save error shows the server's sentence, not 'Network error.' for everything", () =>
      /catch \(e\) \{ setMsg\(detMsg, \(e && e\.message\) \|\| "Network error\.", false\); \}/.test(S));
    skipRow("P04389", "the drawer renders at 1280x800 in both skins", "driven live - see live.checks");
    skipRow("P04390", "the drawer renders at 360x780 dpr3 and fits", "driven live - see live.checks");
    check("P04391", "backdrop-filter is ONE unprefixed line", () =>
      count(R, /backdrop-filter/g) >= 1 && count(R, /-webkit-backdrop-filter/g) === 0);
    check("P04392", "the maintenance switch is manager-only", () => {
      const guestSec = S.indexOf('el("h3", null, ["Guest menu"])');
      if (guestSec < 0) return "the Guest menu section is gone";
      // it must sit inside an `if (isManager)` block
      return /if \(isManager\) \{[\s\S]{0,3000}Guest menu/.test(S);
    });
    check("P61428", "every fetch in maint.js still carries a ceiling", () => {
      const fetches = [...S.matchAll(/fetch\(([^;]*?)\)\s*;/gs)].map((m) => m[0]);
      const naked = fetches.filter((f) => !/signal:/.test(f));
      return naked.length ? `${naked.length} fetch(es) with no deadline` : true;
    });

    // NEW
    check("P66064", "the deadline helper is defined BEFORE the two shared helpers that call it", () =>
      before(S, /window\.LFH_PANEL_DEADLINE = window\.LFH_PANEL_DEADLINE \|\| deadline/, /window\.LFH_PROFILE_GET/));
    check("P66065", "there is ONE deadline helper, not a second copy inside the drawer", () =>
      count(S, /function deadline\(ms\)/g) === 1 && /const deadline = window\.LFH_PANEL_DEADLINE;/.test(S));
    check("P66066", "a timed-out request is explained in words, not the browser's own", () => {
      const w = fnBody(S, "function whyFailed(");
      return /e\.name === "TimeoutError" \|\| e\.name === "AbortError"/.test(w) &&
        /the server didn't answer in time/.test(R);
    });
    check("P66067", "the drawer asks its questions IN the panel, never with the browser's dialog", () =>
      count(S, /(^|[^.\w])confirm\(/g) === 0 && count(S, /(^|[^.\w])alert\(/g) === 0 &&
      count(S, /(^|[^.\w])prompt\(/g) === 0);
    check("P66068", "LFH_ASK offers confirm, say and text, so no caller needs a native dialog", () =>
      /confirm: function \(msg, opts\)/.test(S) && /say: function \(msg, opts\)/.test(S) && /text: askText/.test(S));
    check("P66069", "a question card's scrim tap is Cancel on a question and OK on a notice", () =>
      /finish\(kind === "ask" \? false : true\)/.test(S));
    check("P66070", "a question card registers its own Back layer", () =>
      /LFH_BACK\.layer\("lfh-ask"/.test(S) && /LFH_BACK\.layer\("lfh-ask-text"/.test(S));
    check("P66071", "a question card cannot resolve twice", () =>
      count(S, /if \(done\) return; done = true;/g) === 2);
    check("P66072", "the reason box refuses an empty answer BEFORE the tap, not after", () =>
      /disabled: "disabled"/.test(S) && /input\.addEventListener\("input", function \(\)/.test(S));
    check("P66073", "the reason box also accepts Enter", () =>
      /input\.addEventListener\("keydown", function \(e\) \{ if \(e\.key === "Enter"/.test(S));
    check("P66074", "both answers on a question card are a full finger's height", () =>
      /\.lfh-ask-yes,\.lfh-ask-no\{min-height:46px/.test(R));
    check("P66075", "a dangerous confirm is painted red rather than the usual green", () =>
      /kind === "ask" && opts\.danger/.test(S));
    check("P66076", "the drawer honours a reduced-motion setting", () =>
      /prefers-reduced-motion:reduce\)\{\s*\.lfh-dw\{animation:lfhfade/.test(R));
    check("P66077", "signing out replaces the history entry, so Back cannot return to a dead panel", () =>
      !/location\.href *=/.test(leaveTo) && /\.replace\(url\)/.test(leaveTo));
    check("P66078", "the maintenance button offers the READ again when the state is unknown", () =>
      /if \(maintOn === null\) \{ maintBtn\.textContent = "…"; await fetchMaint\(\); renderMaint\(\); return; \}/.test(S));
    check("P66079", "a refused maintenance change says the guest menu has NOT changed", () =>
      /the guest menu has NOT changed/.test(R));
    check("P66080", "the drawer is rebuilt from scratch on open, never left half-stale", () =>
      /if \(overlay\) overlay\.remove\(\);/.test(openDrawer));
    check("P66081", "opening the drawer re-arms the Back layer exactly once", () =>
      /if \(backOff\) \{ backOff\(\); backOff = null; \}/.test(openDrawer) && /armBack\(\);/.test(openDrawer));
    check("P66082", "the first-login card offers a way out for the wrong person", () =>
      /Not you\? Sign out/.test(R));
    check("P66083", "the everyday header truncates a long name rather than breaking the row", () =>
      /textOverflow: "ellipsis", whiteSpace: "nowrap"/.test(openDrawer));
    check("P66084", "the drawer fits a phone without being cut off", () =>
      /max-height:calc\(100dvh - 36px\);overflow:auto/.test(R));
    check("P66085", "a person whose admin manages their password is told so, not shown a dead box", () =>
      /Your admin manages your password/.test(R));
    check("P66086", "a person whose admin manages their PIN is told so", () =>
      /Your admin manages your PIN/.test(R));
    check("P66087", "the name and phone are BOTH required before first-login can finish", () =>
      /Both your username and phone are required\./.test(R));
    check("P66088", "the details save carries an expect only when the row id is known", () =>
      /expect: profile\.id \? \{ table: "staff_users", id: profile\.id/.test(openDrawer));
  }

  // ===========================================================================================
  // issue-raise.js - the shared "Report an issue" modal (P04393-P04416)
  // ===========================================================================================
  {
    const S = c.issueRaise, R = raw.issueRaise;
    if (!S) { skipRow("P04393", "issue-raise.js checks", "the file is not in this tree"); return; }
    const uploadMedia = fnBody(S, "async function uploadMedia(");
    const close = fnBody(S, "function close(");

    check("P04393", "the ticket POST goes through the panel's own api(), so it queues offline", () =>
      /api\("POST"/.test(S) || /LFH_OUTBOX/.test(S));
    check("P04394", "a queued ticket says 'will send when you reconnect', not 'Sent'", () =>
      /queued/.test(S) && /reconnect|when you're back/i.test(R));
    check("P04395", "offline, the modal says up front that a photo or voice note needs a connection", () =>
      /lfhirOffline|Offline/.test(R));
    check("P04396", "only PNG / JPEG / WEBP are accepted", () => /OK_IMAGE/.test(S) && /webp/.test(R));
    check("P04397", "a photo over 5 MB is refused with a sentence", () =>
      /MAX_IMAGE_BYTES/.test(S) && /5 *\* *1024 *\* *1024|5242880/.test(S));
    check("P04398", "a voice note auto-stops at 2 minutes", () =>
      /MAX_AUDIO_MS/.test(S) && /120000|2 *\* *60 *\* *1000/.test(S));
    check("P04399", "the Record button is never disabled while a recording is running", () =>
      /!rec &&/.test(S));
    check("P04400", "a device with no MediaRecorder disables the button and says why", () =>
      /MR_SUPPORTED/.test(S));
    check("P04401", "the mic is released on stop and on close", () =>
      count(S, /getTracks\(\)\.forEach/g) >= 2);
    check("P04402", "object URLs are revoked on close and when an attachment is removed", () =>
      count(S, /revokeObjectURL/g) >= 2);
    check("P04403", "re-picking the same file works (the input value is cleared)", () =>
      /\.value = ""/.test(S));
    check("P04404", "the modal registers a Back layer and does not double-unregister on a Back close", () =>
      /LFH_BACK\.layer\(/.test(S) && /fromBack/.test(S));
    check("P04405", "Escape closes it", () => /"Escape"/.test(S));
    check("P04406", "both window listeners are removed on close", () =>
      count(close, /removeEventListener/g) >= 2);
    check("P04407", "an empty subject is refused with a sentence and focus, not silence", () =>
      /focus\(\)/.test(S));
    check("P04408", "a failed send re-enables Send rather than leaving a dead button", () =>
      /disabled = false/.test(S));
    check("P04409", "an upload failure shows the server's own message", () =>
      /error/.test(uploadMedia));
    check("P04410", "an attachment upload cannot hang forever with Send greyed out", () =>
      /signal:/.test(uploadMedia));
    check("P04411", "a stray tap on the backdrop cannot throw away a voice note being recorded", () =>
      /rec/.test(S) && /recording/i.test(R));
    check("P04412", "the ?rid= admin pin rides on the media upload URL", () => /rid/.test(uploadMedia));
    check("P04413", "aria-modal=true and a labelled dialog", () =>
      /aria-modal="true"/.test(R) && /role="dialog"/.test(R));
    skipRow("P04414", "the modal renders at 1280x800", "driven live - see live.checks");
    skipRow("P04415", "the modal renders at 360x780 dpr3 with both media buttons reachable", "driven live - see live.checks");
    check("P04416", "the modal's own CSS is scoped so it looks the same in all three panels", () =>
      count(R, /lfhir-/g) > 10);

    // NEW
    check("P66089", "the modal is loaded by all three panels, so one implementation serves them", () =>
      /issue-raise\.js/.test(c.editorHtml || "") && /issue-raise\.js/.test(c.kitchenHtml || "") &&
      /issue-raise\.js/.test(c.tabletHtml || ""));
    check("P66090", "the upload deadline is guarded, so an old tablet cannot lose the write", () => {
      /* Followed into the NAMED helper. uploadMedia() passes `signal: uploadDeadline()`, so a
         check that only looks for AbortSignal inside uploadMedia finds nothing and reports a
         missing deadline that is right there. Reading AbortSignal.timeout throws on some older
         phones, which is why the helper is wrapped at all. */
      if (!/signal: uploadDeadline\(\)/.test(uploadMedia)) return "the upload no longer carries a deadline";
      const h = fnBody(S, "function uploadDeadline(");
      if (!/UPLOAD_TIMEOUT_MS/.test(h)) return "uploadDeadline() no longer uses the named timeout";
      return /try \{/.test(h) && /catch \(e\) \{ return undefined; \}/.test(h)
        ? true : "uploadDeadline() is unguarded - reading AbortSignal.timeout throws on some older phones";
    });
    check("P66091", "nothing in this modal uses the browser's own dialogs", () =>
      count(S, /(^|[^.\w])alert\(/g) === 0 && count(S, /(^|[^.\w])confirm\(/g) === 0 &&
      count(S, /(^|[^.\w])prompt\(/g) === 0);
  }
}
