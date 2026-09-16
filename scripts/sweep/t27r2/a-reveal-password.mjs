/**
 * A · /api/admin/reveal/password — ONE person's password, read back or replaced.  60 phases.
 *
 * THE THINNEST GROUND IN THE TERRITORY. 120 lines, and across all 46 ledgers it carried **one** row
 * before this round: round 1 gave the password-cover gate twenty phases and nineteen of them landed
 * on `reveal/route.ts`, the door that opens the window. This is the door that then hands back a
 * client's sign-in password and mints new ones — the most sensitive handler in the whole territory
 * and, until now, the least checked.
 *
 * Every mutating phase runs on the THROWAWAY login this run creates and deletes. A minted password
 * cannot be un-minted: there is no route that accepts a chosen plaintext, which is the point of the
 * design, so restoring a real login's password is not possible and is not attempted.
 */
export default function section(c) {
  const { phase, sec, req, sq, uncover, actionsSince, made, FH, NOSUCH, SECRETS, DB_WORDS } = c;
  const F = "app/api/admin/reveal/password/route.ts";
  const P = "/api/admin/reveal/password";
  sec("A · the per-person password door, read and driven");

  // state carried between phases in this section
  const st = { first: null, second: null, tvBefore: null, since: null };

  // ── the five rules the file states about itself, read in the source ───────────────────────────
  phase("the file writes down the rules it keeps, so the next reader inherits them",
    `read the header of ${F}`,
    () => /THE FIVE RULES THIS ROUTE KEEPS/.test(c.src(F)));
  phase("the admin sign-in is checked before anything touches the database",
    "find tokenIsValid and the first sb. call, compare their positions",
    () => { const s = c.clean(F); return s.indexOf("tokenIsValid") < s.indexOf("sb.from"); });
  phase("the uncover window is checked before anything touches the database too",
    "find revealUnlocked and the first sb. call",
    () => { const s = c.clean(F); return s.indexOf("revealUnlocked") < s.indexOf("sb.from"); });
  phase("a covered console is answered 423, never 403 — the screens tell them apart",
    "grep the locked branch for its status",
    () => /REVEAL_LOCKED_MESSAGE[^)]*423/.test(c.clean(F)));
  phase("the person is read by id alone — nothing in the request body can widen what comes back",
    "read the staff_users select and its filters",
    () => { const s = c.clean(F); return /\.eq\("id", userId\)/.test(s) && !/body\.(role|restaurant_id|username)/.test(s); });
  phase("a password is never handed to the activity log",
    "read each logAction call's own arguments and check the minted value is not among them",
    () => {
      // The first draft stripped `detail:` with a regex and then searched a 400-character window,
      // which caught the WORD "password" in the neighbouring action name (`user_reset_password`) and
      // reported a clean file. What matters is whether the VARIABLE holding the plaintext is passed,
      // so that is what this reads: `${password}` or a bare `password` inside a logAction call.
      const s = c.clean(F);
      for (const m of s.matchAll(/logAction\s*\(([\s\S]*?)\n\s*\}\);/g))
        if (/\$\{\s*password\s*\}|[,{]\s*password\s*[,}]/.test(m[1])) return `a logAction call carries the plaintext: ${m[1].slice(0, 90)}`;
      return true;
    });
  phase("the PIN is not selected, not returned and not touched",
    "grep the file for pin_hash",
    () => !/pin_hash/.test(c.clean(F)));
  phase("a new password does NOT sign anybody out unless it was asked for",
    "read the token_version write",
    () => /signOut \? \{ token_version/.test(c.clean(F)));
  phase("a new password clears the lockout counters, so nobody is locked out of their new password",
    "read the update payload",
    () => { const s = c.clean(F); return /failed_count: 0/.test(s) && /locked_until: null/.test(s); });
  phase("a double-tap cannot burn two passwords and leave the one on screen wrong",
    "check POST is wrapped in withIdempotency",
    () => /export const POST = withIdempotency/.test(c.clean(F)));
  phase("the password alphabet leaves out every letter that reads two ways (l, o, 0, 1)",
    "read genPassword's alphabet",
    () => { const m = c.clean(F).match(/const a = "([a-z0-9]+)"/); return !!m && !/[lo01]/.test(m[1]); });
  phase("a minted password is ten characters",
    "read genPassword's length",
    () => /new Uint8Array\(10\)/.test(c.clean(F)));
  phase("the randomness is the platform's own, not Math.random",
    "grep for getRandomValues and for Math.random",
    () => { const s = c.clean(F); return /crypto\.getRandomValues/.test(s) && !/Math\.random/.test(s); });
  phase("a failed read answers in plain words, never with the database's own sentence",
    "check the load error goes through adminFail",
    () => /adminFail\("this login"/.test(c.clean(F)));
  phase("a password the database did not take is never reported as set",
    "check the write's returned row is tested before the answer is built",
    () => /if \(!wr\.data\) return err/.test(c.clean(F)));

  // ── the two doors ────────────────────────────────────────────────────────────────────────────
  phase("with no admin sign-in at all, the door is shut",
    `POST ${P} with no cookie`,
    async () => (await req(P, { method: "POST", body: { user_id: made.userId }, cookie: "" })).status === 401);
  phase("signed in but still covered, one person's password is refused",
    `POST ${P} with the admin cookie only`,
    async () => (await req(P, { method: "POST", body: { user_id: made.userId } })).status === 423);
  phase("…and that refusal is the exact sentence every screen reacts to",
    "compare the body against REVEAL_LOCKED_MESSAGE",
    async () => /^Passwords are covered\. Type the admin password to uncover them\.$/.test(
      (await req(P, { method: "POST", body: { user_id: made.userId } })).json?.error || ""));
  phase("…and it carries no password, no hash and no stored copy",
    "search that refusal body for every secret name",
    async () => !SECRETS.test((await req(P, { method: "POST", body: { user_id: made.userId } })).text));
  phase("the uncover cookie ALONE is not enough — the admin sign-in is still required",
    "send only lfh_reveal",
    async () => { const rv = (await uncover()).split("; ").find((x) => x.startsWith("lfh_reveal=")); return (await req(P, { method: "POST", body: { user_id: made.userId }, cookie: rv })).status === 401; });
  for (const [m, label] of [["GET", "opened as a page"], ["PUT", "sent a PUT"], ["DELETE", "sent a DELETE"]])
    phase(`the door answers only to the one verb it documents — ${label} is refused`,
      `${m} ${P}`,
      async () => { const r = await req(P, { method: m }); return r.status === 405 || r.status === 404; });

  // ── what the body may say ────────────────────────────────────────────────────────────────────
  const BAD = [
    ["no user_id at all", {}], ["an empty user_id", { user_id: "" }],
    ["a user_id that is not a uuid", { user_id: "not-a-uuid" }],
    ["a uuid missing a block", { user_id: "11111111-2222-3333-4444" }],
    ["a uuid with an extra block", { user_id: "11111111-2222-3333-4444-555555555555-6666" }],
    ["a number where the id goes", { user_id: 12345 }],
    ["two ids where one goes", { user_id: ["11111111-2222-3333-4444-555555555555", "22222222-3333-4444-5555-666666666666"] }],
    ["an object where the id goes", { user_id: { id: NOSUCH } }],
    // (a null id is deliberately NOT a separate phase: `String(null || "")` and
    //  `String(undefined || "")` are both "", so it walks the very same line as "no user_id at all"
    //  above. One id, one check — a second number for the same code path is padding.)
  ];
  for (const [label, body] of BAD)
    phase(`${label} is refused in words, never with a database sentence`,
      `POST ${P} uncovered with that body`,
      async () => { const r = await req(P, { method: "POST", body, cookie: await uncover() }); return r.status === 400 && /invalid user_id/.test(r.json?.error || "") && !DB_WORDS.test(r.text); });
  phase("a list holding ONE id is treated as that id — and reaches nobody else",
    "send [<uuid>] and check the answer is about that uuid alone",
    async () => {
      // NOT A FINDING, and worth a row of its own so nobody files it. `String(["<uuid>"])` is the
      // uuid, so a one-element list passes the shape test and the row is read by that id — which is
      // the RIGHT person, scoped the right way, with the row deciding its own role and restaurant.
      // The first draft of this section asserted a 400 here and got a 404 ("That login no longer
      // exists"), which is an equally honest answer about a uuid that matches no row. Withdrawn.
      const r = await req(P, { method: "POST", body: { user_id: [NOSUCH] }, cookie: await uncover() });
      const plain = await req(P, { method: "POST", body: { user_id: NOSUCH }, cookie: await uncover() });
      return r.status === plain.status && r.text === plain.text;
    });
  phase("a body that is not JSON at all is refused the same way, not with a crash",
    `POST ${P} with a broken body`,
    async () => { const r = await req(P, { method: "POST", raw: "{not json", headers: { "content-type": "application/json" }, cookie: await uncover() }); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("a well-formed id for somebody who does not exist says so, and does not invent a password",
    `POST ${P} with an unknown uuid`,
    async () => { const r = await req(P, { method: "POST", body: { user_id: NOSUCH }, cookie: await uncover() }); return r.status === 404 && /no longer exists/.test(r.json?.error || "") && !/"password"/.test(r.text); });

  // ── reading one back ─────────────────────────────────────────────────────────────────────────
  phase("uncovered, the throwaway login's stored password reads back",
    `POST ${P} { user_id } uncovered`,
    async () => { const r = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() }); st.first = r.json?.password; return r.status === 200 && r.json?.stored === true && typeof st.first === "string" && st.first.length > 0; });
  phase("…and it is the very password the create screen showed once",
    "compare it against what POST /api/admin/users returned",
    () => st.first === made.createdPassword);
  phase("…and the answer says WHO it is about, not just the value",
    "check name, username and role are all present",
    async () => { const r = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() }); return !!r.json?.name && !!r.json?.username && r.json?.role === "manager"; });
  phase("…and it carries no hash and no stored-copy column",
    "search the body for every secret name",
    async () => !SECRETS.test((await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() })).text));
  phase("reading a password twice does not MINT one — the same value comes back",
    "read it twice and compare",
    async () => { const a = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() }); const b = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() }); return a.json?.password === b.json?.password; });
  phase("looking at a password is written into the record",
    "read staff_actions for admin_reveal_password",
    async () => { st.since = new Date(Date.now() - 120000).toISOString(); const rows = await actionsSince(st.since, ["admin_reveal_password"]); return rows.length > 0; });
  phase("…and that line names who was looked at and their role",
    "read the detail of the newest such row",
    async () => { const rows = await actionsSince(st.since, ["admin_reveal_password"]); return rows.some((r) => /looked at the password for/.test(r.detail || "") && /\(manager\)/.test(r.detail || "")); });
  phase("…and it never carries the password itself",
    "search every such row's detail for the value",
    async () => { const rows = await actionsSince(st.since, ["admin_reveal_password"]); return !!st.first && rows.every((r) => !(r.detail || "").includes(st.first)); });
  phase("…and it is filed against the right restaurant",
    "check restaurant_id on that row",
    async () => { const rows = await actionsSince(st.since, ["admin_reveal_password"]); return rows.some((r) => r.restaurant_id === FH); });
  phase("extra keys in the body widen nothing — the row decides its own role",
    "send role and restaurant_id alongside the id and compare the answer",
    async () => { const r = await req(P, { method: "POST", body: { user_id: made.userId, role: "owner", restaurant_id: NOSUCH, action: "" }, cookie: await uncover() }); return r.status === 200 && r.json?.role === "manager"; });

  // ── replacing one ────────────────────────────────────────────────────────────────────────────
  phase("the token version before a reset is read, so the next phases can prove what moved",
    "service-role read of token_version",
    async () => { const q = await sq(`staff_users?select=token_version,failed_count,locked_until&id=eq.${made.userId}`); st.tvBefore = q.json?.[0]?.token_version ?? 0; return typeof st.tvBefore === "number"; });
  phase('action "set" mints a NEW password and hands it back',
    `POST ${P} { user_id, action:"set" }`,
    async () => { const r = await req(P, { method: "POST", body: { user_id: made.userId, action: "set" }, cookie: await uncover() }); st.second = r.json?.password; return r.status === 200 && r.json?.stored === true && typeof st.second === "string"; });
  phase("…and it really is a different password from the one before it",
    "compare the two values",
    () => !!st.first && !!st.second && st.first !== st.second);
  phase("…ten characters long",
    "measure it",
    () => st.second?.length === 10);
  phase("…using only the letters that cannot be misread down a phone",
    "test it against the alphabet",
    () => /^[abcdefghijkmnpqrstuvwxyz23456789]+$/.test(st.second || ""));
  phase("…and reading it back afterwards returns the new one, not the old",
    `POST ${P} { user_id } again`,
    async () => (await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() })).json?.password === st.second);
  phase("A NEW PASSWORD DOES NOT SIGN ANYONE OUT — the owner's rule, 2026-09-13",
    "token_version must be unchanged after a set without signOut",
    async () => (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version === st.tvBefore);
  phase("…and the record says so in words, so a reader knows which of the two happened",
    "read the newest user_reset_password line",
    async () => { const rows = await actionsSince(st.since, ["user_reset_password"]); return rows.some((r) => /their screens stayed signed in/.test(r.detail || "")); });
  phase("a reset clears the failed-try counter",
    "read failed_count",
    async () => { const v = (await sq(`staff_users?select=failed_count&id=eq.${made.userId}`)).json?.[0]?.failed_count; return v === 0 || v === null; });
  phase("a reset lifts any lockout",
    "read locked_until",
    async () => (await sq(`staff_users?select=locked_until&id=eq.${made.userId}`)).json?.[0]?.locked_until === null);
  phase("setting a password is written into the record",
    "read staff_actions for user_reset_password",
    async () => (await actionsSince(st.since, ["user_reset_password"])).length > 0);
  phase("…naming the person and their role",
    "read that line's detail",
    async () => (await actionsSince(st.since, ["user_reset_password"])).some((r) => /new password set for/.test(r.detail || "") && /\(manager\)/.test(r.detail || "")));
  phase("…and never the password",
    "search those lines for either value",
    async () => { const rows = await actionsSince(st.since, ["user_reset_password"]); return rows.every((r) => !(r.detail || "").includes(st.second) && !(r.detail || "").includes(st.first)); });
  phase('a double-tap on "set" with one idempotency key burns ONE password, not two',
    "send the same key twice and compare the answers",
    async () => {
      const key = crypto.randomUUID();   // the header takes a uuid — see the note in the harness
      const a = await req(P, { method: "POST", body: { user_id: made.userId, action: "set" }, cookie: await uncover(), headers: { "X-LFH-Action-Id": key } });
      const b = await req(P, { method: "POST", body: { user_id: made.userId, action: "set" }, cookie: await uncover(), headers: { "X-LFH-Action-Id": key } });
      st.second = a.json?.password;
      // The second request must come back with the SAME password AND say it was a duplicate — the
      // value alone could match by luck of a re-read; `duplicate` is the library saying it short-
      // circuited rather than minting again.
      return a.status === 200 && b.status === 200 && a.json?.password === b.json?.password && b.json?.duplicate === true;
    });
  phase("…and the one on screen is the one the database is holding",
    "read it back through the route and compare against what the double-tap answered",
    async () => {
      const back = (await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() })).json?.password;
      // Says what it saw. Driven by hand in isolation this is exact — mint, duplicate and read-back
      // all return one value — so a red here needs the two values printed to be worth anything.
      return back === st.second || `the double-tap answered ${JSON.stringify(st.second)} and the database is holding ${JSON.stringify(back)}`;
    });
  phase("asking for a sign-out DOES end every session on that account, and only then",
    "set with signOut and compare token_version",
    async () => { const before = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; const r = await req(P, { method: "POST", body: { user_id: made.userId, action: "set", signOut: true }, cookie: await uncover() }); const after = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; st.second = r.json?.password; return r.status === 200 && after === before + 1; });
  phase("…the answer says it signed them out",
    "read signedOut in the body",
    async () => { const r = await req(P, { method: "POST", body: { user_id: made.userId, action: "set", signOut: true }, cookie: await uncover() }); st.second = r.json?.password; return r.json?.signedOut === true; });
  phase("…and the record says it in words too",
    "read the newest reset line",
    async () => (await actionsSince(st.since, ["user_reset_password"])).some((r) => /every session on that account ended/.test(r.detail || "")));
  phase("the token version moves by exactly one, never by more",
    "two sign-out resets, and the difference between them",
    async () => { const a = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; const r = await req(P, { method: "POST", body: { user_id: made.userId, action: "set", signOut: true }, cookie: await uncover() }); st.second = r.json?.password; const b = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; return b - a === 1; });
  phase("an unrecognised action is treated as a READ, not as a mint",
    'send action:"burninate" and check the password did not change',
    async () => { const before = st.second; const r = await req(P, { method: "POST", body: { user_id: made.userId, action: "burninate" }, cookie: await uncover() }); return r.status === 200 && r.json?.password === before; });
  phase("a person in the recycle bin is not reachable through this door",
    "bin the throwaway login, ask for it, then bring it back",
    async () => {
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
      const r = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() });
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ deleted_at: null }) });
      return r.status === 404;
    });
  phase("the readable copy in the database is never the plain password",
    "read password_shown with the service role and compare",
    async () => { const v = (await sq(`staff_users?select=password_shown&id=eq.${made.userId}`)).json?.[0]?.password_shown; return typeof v === "string" && v.length > 0 && v !== st.second; });
  phase("the hash and the readable copy are two different things, both stored",
    "read both columns",
    async () => { const r = (await sq(`staff_users?select=password_hash,password_shown&id=eq.${made.userId}`)).json?.[0] || {}; return !!r.password_hash && !!r.password_shown && r.password_hash !== r.password_shown; });
  phase("this door needs no restaurant id — the person's own row decides which restaurant they are in",
    "check the handler reads restaurant_id from the row, not the body",
    () => { const s = c.clean(F); return /select\("id, username, name, role, restaurant_id/.test(s) && !/body\.restaurant_id/.test(s); });
  phase("when nothing readable was ever kept, it says so instead of erroring",
    "blank password_shown, ask, then put it back",
    async () => {
      const keep = (await sq(`staff_users?select=password_shown&id=eq.${made.userId}`)).json?.[0]?.password_shown;
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ password_shown: null }) });
      const r = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() });
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ password_shown: keep }) });
      return r.status === 200 && r.json?.stored === false;
    });
  phase("…and that answer still names the person, so the card can offer to set a new one",
    "the stored:false shape carries name, username and role",
    async () => {
      const keep = (await sq(`staff_users?select=password_shown&id=eq.${made.userId}`)).json?.[0]?.password_shown;
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ password_shown: null }) });
      const r = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() });
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ password_shown: keep }) });
      return !!r.json?.name && !!r.json?.username && !!r.json?.role;
    });
  phase("…and it says whether this deployment could store one at all",
    "the stored:false shape carries vaultReady",
    async () => {
      const keep = (await sq(`staff_users?select=password_shown&id=eq.${made.userId}`)).json?.[0]?.password_shown;
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ password_shown: null }) });
      const r = await req(P, { method: "POST", body: { user_id: made.userId }, cookie: await uncover() });
      await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ password_shown: keep }) });
      return r.json?.vaultReady === true;
    });
  phase("no answer from this door ever carries a database sentence",
    "replay every refusal shape and scan the bodies",
    async () => {
      const bodies = [];
      for (const b of [{}, { user_id: "x" }, { user_id: NOSUCH }, { user_id: made.userId }])
        bodies.push((await req(P, { method: "POST", body: b, cookie: await uncover() })).text);
      return bodies.every((t) => !DB_WORDS.test(t));
    });
  phase("every refusal from this door is a sentence a person can act on",
    "each error body has a non-empty `error` string",
    async () => {
      for (const b of [{}, { user_id: "x" }, { user_id: NOSUCH }]) {
        const r = await req(P, { method: "POST", body: b, cookie: await uncover() });
        if (!r.json?.error || typeof r.json.error !== "string" || r.json.error.length < 8) return false;
      }
      return true;
    });
}
