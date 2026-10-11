// Section C — Repair → the problem board's Resolve / Wait / Resolve all, and Logs → Reopen
// (/api/admin/resolve-error). Before this run 2 of its 5 subject rows had ever driven the app.
// Driven only along paths that must refuse or answer "already" — no problem changes state.
export default function section(c) {
  const F = "app/api/admin/resolve-error/route.ts";
  const S = () => c.clean(F);
  c.sec("C · Repair → Resolve — read for every rule");
  c.phase("one problem is named by a real id, or refused", `read ${F}`, () => /const actionId = typeof body\.action_id === "string" && UUID\.test\(body\.action_id\) \? body\.action_id : null;/.test(S()));
  c.phase("a wait is bounded to a month (0..744 hours), so a typo can't park a problem for a year", "read the snooze clamp",
    () => /if \(snoozeHours < 0 \|\| snoozeHours > 24 \* 31\)/.test(S()));
  c.phase("Resolve all with a garbled restaurant is refused, never widened to every restaurant (T39 item 78)", "read the bulk branch",
    () => /That restaurant id isn't valid — nothing was cleared\./.test(S()));
  c.phase("Resolve all counts BEFORE it writes, so the record cannot say fewer than it cleared", "read the bulk branch",
    () => S().indexOf("const before = await cntQ") < S().indexOf("const bulk = await upd"));
  c.phase("…and the count runs on the SAME filter as the write", "compare the two filters",
    () => (S().match(/\.eq\("level", "error"\)\.is\("resolved_at", null\)/g) || []).length >= 1 && /if \(scope\) cntQ = cntQ\.eq\("restaurant_id", scope\)/.test(S()));
  c.phase("Resolve all writes NO 'already fixed' memory — clearing a board is not a fix", "read the bulk branch",
    () => { const s = S(); const a = s.indexOf("if (body.all === true)"); const b = s.indexOf("const actionId", a); return !/rememberErrorHandled/.test(s.slice(a, b)); });
  c.phase("Resolve all MEANS all — waiting problems included (R54, owner 2026-09-04)", "read the resolve filter: no snooze filter on a resolve",
    () => /if \(snoozeUntil\) upd = upd\.or\(/.test(S()) && !/upd = upd\.(is|or)\("snoozed_until/.test(S().replace(/if \(snoozeUntil\) upd = upd\.or\([^;]*;/, "")));
  c.phase("only a problem (an error-level row) can be resolved", "read the level check",
    () => /if \(row\.level !== "error"\) return NextResponse\.json\(\{ error: "only errors can be resolved" \}, \{ status: 400 \}\)/.test(S()));
  c.phase("Resolve acts on the whole ×N tile using the board's own signature function", "read the group match",
    () => /import \{ errorSig \} from "@\/lib\/errorSignature"/.test(c.raw(F)) && /errorSig\(c\.detail\) === wantSig/.test(S()));
  c.phase("…the candidate read is bounded (500) and scoped to the same restaurant (or to none)", "read the candidate chain",
    () => /\.limit\(500\)/.test(S()) && /row\.restaurant_id === null \? cand\.is\("restaurant_id", null\) : cand\.eq\("restaurant_id", row\.restaurant_id\)/.test(S()));
  c.phase("the tapped problem is added only while it is still in the state being acted on (item 9)", "read the push",
    () => /if \(!ids\.includes\(actionId\) && inSourceState\) ids\.push\(actionId\)/.test(S()));
  c.phase("a Wait writes snoozed_until and leaves the problem OPEN", "read the update",
    () => /snoozeUntil && !reopen \? \{ snoozed_until: snoozeUntil \} : \{ resolved_at:/.test(S()));
  c.phase("…and a Wait claims nothing — no 'already fixed' memory", "read the snooze return",
    () => { const s = S(); return s.indexOf('return NextResponse.json({ ok: true, snoozed: count') < s.indexOf("rememberErrorHandled({"); });
  c.phase("a Reopen forgets the 'already fixed' memory so Fix-now can act again", "read the memory branch",
    () => /if \(reopen\) \{\s*forgotten = await forgetErrorSignature\(key\)/.test(S()));
  c.phase("the memory write can never undo a resolve that already landed", "read the try/catch around it",
    () => /\} catch \{ \/\* the row-level resolve already succeeded/.test(c.raw(F)));
  c.phase("every outcome leaves an English line in the Activity log", "read the three logAction calls",
    () => ["errors_snoozed_all", "errors_resolved_all", "error_snoozed", "error_reopened", "error_resolved"].every((a) => S().includes(a)));

  c.sec("C · Repair → Resolve — driven, refusals and 'already' only");
  // A press acts on the WHOLE group (same panel + action + restaurant + signature). So a row is only
  // pressed when NO row of its panel/action/restaurant sits in the OTHER state — then the press can
  // only ever answer "already", and nothing on the board moves. (A superset of the group: safe.)
  const lonely = async (wantResolved) => {
    const rows = (await c.sq(`staff_actions?select=id,panel,action,restaurant_id,resolved_at,snoozed_until&level=eq.error&resolved_at=${wantResolved ? "not." : ""}is.null&order=created_at.desc&limit=40`)).json || [];
    for (const r of rows) {
      const scope = r.restaurant_id === null ? "restaurant_id=is.null" : `restaurant_id=eq.${r.restaurant_id}`;
      const other = await c.count("staff_actions", `level=eq.error&panel=eq.${encodeURIComponent(r.panel)}&action=eq.${encodeURIComponent(r.action)}&${scope}&resolved_at=${wantResolved ? "" : "not."}is.null`);
      if (other === 0) return r;
    }
    return null;
  };
  const open1 = () => lonely(false);
  const done1 = () => lonely(true);
  const logs = () => c.count("staff_actions", `action=in.(error_resolved,error_reopened,error_snoozed,errors_resolved_all,errors_snoozed_all)&created_at=gte.${c.T0}`);
  c.phase("a problem named by a malformed id is refused in words", "POST action_id=nope",
    async () => { const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { action_id: "nope" } }); return r.status === 400 || `${r.status}`; });
  c.phase("a wait of 9,999 hours is refused", "POST snooze_hours 9999",
    async () => { const d = await done1(); const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { action_id: d?.id, snooze_hours: 9999 } }); return r.status === 400 && /out of range/.test(r.json?.error) || `${r.status}`; });
  c.phase("…and a negative wait too", "POST snooze_hours -3",
    async () => { const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { all: true, snooze_hours: -3 } }); return r.status === 400 || `${r.status}`; });
  c.phase("Resolve all with a garbled restaurant is refused and the open count does not move", "count open problems, POST all:true restaurant_id:'nope', count again", async () => {
    const before = await c.count("staff_actions", "level=eq.error&resolved_at=is.null");
    const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { all: true, restaurant_id: "nope" } });
    const after = await c.count("staff_actions", "level=eq.error&resolved_at=is.null");
    return r.status === 400 && after >= before || `${r.status}, open ${before}→${after}`;
  });
  c.phase("…and with a restaurant given as a number rather than an id, the same", "POST all:true restaurant_id:42", async () => {
    const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { all: true, restaurant_id: 42 } });
    return r.status === 400 || `${r.status}`;
  });
  c.phase("resolving an ordinary diary line (not a problem) is refused", "POST an info-level row's id", async () => {
    const x = (await c.sq(`staff_actions?select=id&level=eq.info&restaurant_id=eq.${c.FH}&order=created_at.desc&limit=1`)).json[0];
    const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { action_id: x.id } });
    return r.status === 400 && /only errors can be resolved/.test(r.json?.error) || `${r.status}`;
  });
  c.phase("resolving a problem someone already resolved answers 'already' and keeps WHEN it was resolved (item 9)", "POST a resolved row", async () => {
    const d = await done1(); if (!d) return "skip:no resolved problem without an open twin";
    const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { action_id: d.id } });
    const a = (await c.sq(`staff_actions?select=resolved_at&id=eq.${d.id}`)).json[0];
    return r.status === 200 && r.json.already === true && a.resolved_at === d.resolved_at || `${r.status} ${JSON.stringify(r.json)}`;
  });
  c.phase("reopening a problem that is still open answers 'already open' and changes nothing", "POST reopen on an open row", async () => {
    const o = await open1(); if (!o) return "skip:every open problem among the newest 40 has a resolved twin, so pressing Reopen would really reopen it — not pressed";
    const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { action_id: o.id, reopen: true } });
    const a = (await c.sq(`staff_actions?select=resolved_at,snoozed_until&id=eq.${o.id}`)).json[0];
    return r.status === 200 && (r.json.already === true || r.json.reopened >= 0) && a.resolved_at === null || `${r.status} ${JSON.stringify(r.json)}`;
  });
  c.phase("asking a resolved problem to wait changes nothing either", "POST snooze_hours:2 on a resolved row", async () => {
    const d = await done1(); if (!d) return "skip:no resolved problem";
    const r = await c.req("/api/admin/resolve-error", { method: "POST", body: { action_id: d.id, snooze_hours: 2 } });
    const a = (await c.sq(`staff_actions?select=resolved_at,snoozed_until&id=eq.${d.id}`)).json[0];
    return r.status === 200 && a.snoozed_until === d.snoozed_until && a.resolved_at === d.resolved_at || `${r.status} ${JSON.stringify(r.json)}`;
  });
  c.phase("none of the refusals and 'already' answers above wrote a single Activity line", "count resolve/snooze lines since the run began",
    async () => { const n = await logs(); return n === 0 || `${n} line(s)`; });
}
