/**
 * I · the whole territory as ONE family — 26 files, the same question asked of each.
 *
 * The sections above go deep on the thin files. This one goes WIDE: every rule that must hold for
 * all 26 routes, asked of each by name, so a route added tomorrow is covered the day it lands
 * instead of at the next sweep. Generated from the file list, which is itself re-derived from the
 * filesystem — a positional range is what LEDGER/INDEX.md records leaving a file watched by nobody.
 */
export default function section(c) {
  const { phase, sec, req, FILES, SECRETS } = c;
  sec("I · every route in the territory, asked the same questions");


  // One phase per file: the gate comes first, read in the source rather than guessed from a status.
  for (const f of FILES)
    phase(`${f.replace("app/api/admin/", "")} — the sign-in check runs before the first database call`,
      "slice each exported handler's own body (following withIdempotency and wrapper delegation) and compare the gate against the first database call INSIDE it",
      () => c.gateFirst(f));

  // The four family rules, each asked once over all 26 files, with the offenders named.
  phase("no route in the territory reads a table with select(*) where a secret lives",
    "grep every file for select(\"*\") and check the table it reads",
    () => {
      const bad = [];
      for (const f of FILES) {
        const s = c.clean(f);
        for (const m of s.matchAll(/from\("([a-z_]+)"\)\s*\.\s*select\("\*"\)/g))
          if (/staff_users|restaurant_payments/.test(m[1])) bad.push(`${f} → ${m[1]}`);
      }
      return bad.length === 0 || `reads everything from a table holding a secret: ${bad.join(", ")}`;
    });
  phase("no route in the territory decides anything from a read whose error is unreachable",
    "grep every file for the (await sb…).data shape",
    () => {
      const bad = FILES.filter((f) => /\(\s*await\s+(?:sb|supabaseAdmin|supabase)\s*\.\s*(?:from|rpc)\s*\([\s\S]{0,700}?\)\s*\.\s*(?:data|error)\b/.test(c.clean(f)));
      return bad.length === 0 || `still has it: ${bad.join(", ")}`;
    });
  phase("no route in the territory hands the console a raw database sentence",
    "every file that can fail a read or write reaches for adminFail or a plain sentence",
    () => {
      const bad = FILES.filter((f) => {
        const s = c.clean(f);
        if (!/\.error/.test(s)) return false;
        return /error\.message/.test(s) && !/adminFail/.test(s);
      });
      return bad.length === 0 || `answers with the database's words: ${bad.join(", ")}`;
    });
  phase("every list read in the territory states its own ceiling",
    "for each .select() that is not a head count or a single-row read, follow the STATEMENT and the builder it was assigned to, and look for a limit, a range or pageAll",
    () => {
      const bad = [];
      for (const f of FILES) {
        const src = c.clean(f);
        // The whole statement, not one line: these handlers write a query over three or four lines,
        // and the first draft of this rule looked at a 300-character window and reported seventeen
        // routes that all state a ceiling perfectly well a line or two further down. A rule that
        // cries wolf seventeen times teaches everyone to skip its output.
        for (const m of src.matchAll(/\.from\("([a-z_]+)"\)[\s\S]*?(?=\n\s*(?:const|let|var|if|for|while|return|await|\}|\/\/)|;)/g)) {
          const stmt = m[0];
          if (!/\.select\(/.test(stmt)) continue;
          if (/maybeSingle|\.single\(|head:\s*true|count:\s*"exact"/.test(stmt)) continue;
          if (/\.(limit|range)\(/.test(stmt)) continue;
          if (/\.(insert|update|upsert|delete)\(/.test(stmt)) continue;   // a write's returning clause — rule 5's business, not this one
          if (/\.eq\("id",|\.in\(/.test(stmt)) continue;                 // a finite id list built in code
          // Assigned to a builder that is limited later? Follow the variable.
          // `let cand = sb.from("staff_actions")…` — the variable name is followed by `= sb`, so an
          // anchor of `=\s*$` never matched and the one route that DOES bound its read on a later
          // line (resolve-error's `await cand.limit(500)`) was the last false red this rule gave.
          const v = (src.slice(Math.max(0, m.index - 80), m.index)
            .match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:sb|supabaseAdmin|supabase)?\s*$/) || [])[1];
          if (v && new RegExp(`\\b${v}\\b[\\s\\S]{0,400}?\\.(limit|range)\\(`).test(src)) continue;
          if (/pageAll/.test(src.slice(Math.max(0, m.index - 200), m.index + 40))) continue;
          bad.push(`${f.replace("app/api/admin/", "")} → ${m[1]}`);
        }
      }
      return bad.length === 0 || `unbounded: ${[...new Set(bad)].join(", ")}`;
    });

  // Driven, as a family: every GET answers 401 signed out, and no answer leaks a secret.
  const GETS = [
    "/api/admin/rate-limits", "/api/admin/restaurants/health", "/api/admin/restaurants",
    "/api/admin/restaurants?deleted=1", "/api/admin/reveal", "/api/admin/revenue",
    "/api/admin/settings", "/api/admin/staff-online", "/api/admin/usage", "/api/admin/users",
    "/api/admin/restaurants/create-defaults",
  ];
  phase("every route in the territory that answers a GET requires being signed in",
    "call each with no cookie and check every one is 401",
    async () => {
      const bad = [];
      for (const p of GETS) { const r = await req(p, { cookie: "" }); if (r.status !== 401) bad.push(`${p} → ${r.status}`); }
      return bad.length === 0 || `answered without a sign-in: ${bad.join(", ")}`;
    });
  phase("no answer in the territory carries a password hash, a PIN or a stored password copy",
    "call each signed in and scan every body",
    async () => {
      const bad = [];
      for (const p of GETS) { const r = await req(p); if (SECRETS.test(r.text)) bad.push(p); }
      return bad.length === 0 || `leaks a secret name: ${bad.join(", ")}`;
    });
  phase("no answer in the territory carries a delivery-app credential value",
    "scan every body for a key-shaped value",
    async () => {
      const bad = [];
      // `key` is not only a credential in this tree: the rate-limit board answers a RULE key
      // ("guest_order") and a THROTTLE key ("admin:1.2.3.4"), and the unblock list answers the same.
      // The first draft of this rule matched those and reported the board as handing back a channel
      // key, which it never does — the finding was withdrawn rather than filed. A credential here
      // only ever lives under a channel name, so that is what this looks at.
      const CHANNELS = ["zomato", "swiggy", "website"];
      for (const p of GETS) {
        const r = await req(p);
        let j = null; try { j = JSON.parse(r.text); } catch { /* html */ }
        const hit = (o) => {
          if (!o || typeof o !== "object") return false;
          for (const [k, v] of Object.entries(o)) {
            if (CHANNELS.includes(k) && v && typeof v === "object" && ((typeof v.key === "string" && v.key) || (typeof v.api_key === "string" && v.api_key))) return true;
            if (v && typeof v === "object" && hit(v)) return true;
          }
          return false;
        };
        if (j && hit(j)) bad.push(p);
      }
      return bad.length === 0 || `hands back a channel key: ${bad.join(", ")}`;
    });
  phase("no answer in the territory carries leaked code text a person would see",
    "scan every body for [object Object], NaN, undefined-as-a-value and an unclosed template",
    async () => {
      const bad = [];
      for (const p of GETS) { const r = await req(p); if (/\[object Object\]|:\s*NaN|"\$\{/.test(r.text)) bad.push(p); }
      return bad.length === 0 || `prints code text: ${bad.join(", ")}`;
    });
  phase("the admin console shows no restaurant's food money, anywhere in this territory",
    "scan every body for a money-shaped key",
    async () => {
      const MONEY = /"(revenue|earnings|takings|food_total|sales_total)"\s*:/i;
      const bad = [];
      for (const p of GETS) { const r = await req(p); if (MONEY.test(r.text)) bad.push(p); }
      return bad.length === 0 || `shows food money: ${bad.join(", ")}`;
    });
  phase("the platform's OWN income is the one money this console may show, and it is labelled",
    "the revenue route says what it is in its own header",
    () => /PLATFORM income \(what restaurants pay US/.test(c.src("app/api/admin/revenue/route.ts")));
  phase("the counted invariant in CLAUDE.md still holds — every admin route checks the cookie",
    "count the route files and the ones that grep tokenIsValid",
    async () => {
      const { execSync } = await import("node:child_process");
      const all = Number(execSync(`find ${c.ROOT}app/api/admin -name route.ts | wc -l`).toString().trim());
      const gated = Number(execSync(`grep -rl tokenIsValid ${c.ROOT}app/api/admin --include=route.ts | wc -l`).toString().trim());
      return all === gated || `${all} routes but ${gated} check the cookie`;
    });
  phase("this territory is still the 26 files it says it is",
    "re-derive the list from the filesystem and compare",
    async () => {
      const { execSync } = await import("node:child_process");
      const derived = execSync(`cd ${c.ROOT} && find app/api/admin -name route.ts | sort | sed -n '26,99p'`).toString().trim().split("\n");
      return derived.length === FILES.length && derived.every((f, i) => f === FILES[i]) || `the filesystem now says: ${derived.join(", ")}`;
    });
}
