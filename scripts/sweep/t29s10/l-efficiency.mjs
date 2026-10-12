// Section L (round 2) — UNOPTIMIZED CODE, one row per route file: no database call made once per item
// of a loop (where it could be one call or run together), no read that names every column of a table
// when it uses a few, and no request that reads the same row the same way twice.
export default function section(c) {
  const short = (rel) => rel.replace("app/api/admin/", "").replace("/route.ts", "");
  // Loops that call the database on purpose, each with its reason (the list can only shrink).
  const LOOP_OK = {
    "app/api/admin/restaurants/route.ts": "create_restaurant makes ONE starter login per enabled panel (at most four), and the owner login's link must follow its insert",
    "app/api/admin/restaurants/settings/route.ts": "the QR-code mint retries a code collision up to three times — a retry, not a per-item call",
    "app/api/admin/restaurants/export/route.ts": "the recovery backup pages a table 1,000 rows at a time — each page needs the last row of the one before",
  };
  const STAR_OK = {
    "app/api/admin/restaurants/bill-preview/route.ts": "the preview renders from the WHOLE settings row (header, tax, footer, paper, sign-off)",
    "app/api/admin/restaurants/export/route.ts": "a recovery backup IS every column of every table; credentials are stripped explicitly",
  };
  const loopsWithDb = (src) => {
    const out = [];
    for (const m of src.matchAll(/\bfor \((?:const|let)[^)]*\)\s*\{/g)) {
      let i = src.indexOf("{", m.index), d = 0, j = i;
      for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; }
      if (/await\s+(?:\(?\s*)?sb\s*\.|await\s+supabaseAdmin\s*\./.test(src.slice(i, j))) out.push(src.slice(m.index, m.index + 60));
    }
    return out;
  };

  c.sec("L · unoptimized — no database call is made once per item of a loop (unless declared)");
  for (const rel of c.FILED) c.phase(`${short(rel)} — no per-item database call inside a loop, or a written reason`,
    "find every for-loop whose body awaits the database", () => {
      if (c.isGone(rel)) return c.GONE;
      const hits = loopsWithDb(c.clean(rel));
      return hits.length === 0 || !!LOOP_OK[rel] || `loop(s) calling the database: ${hits.join(" | ")}`;
    });

  c.sec("L · unoptimized — a read names the columns it uses (select(\"*\") only where it is the point)");
  for (const rel of c.FILED) c.phase(`${short(rel)} — no select("*") except the settings template or a declared whole-row read`,
    "grep select(\"*\") and check each is the template clone or a declared case", () => {
      if (c.isGone(rel)) return c.GONE;
      const src = c.clean(rel);
      const stars = [...src.matchAll(/\.from\("([a-z_]+)"\)\.select\("\*"\)([^;]{0,120})/g)].filter((m) => !/DEFAULT_\w+\)\.maybeSingle/.test(m[2]));
      return stars.length === 0 || !!STAR_OK[rel] || `select("*") on ${stars.map((m) => m[1]).join(", ")}`;
    });

  c.sec("L · unoptimized — no handler reads the same row the same way twice");
  for (const rel of c.FILED) c.phase(`${short(rel)} — no identical read repeated inside one handler`,
    "compare every sb.from(…).select(…) chain within each handler branch (one request runs one branch)", () => {
      if (c.isGone(rel)) return c.GONE;
      const hs = c.handlers(rel); const dup = [];
      // One request runs ONE `if (action === …)` / `if (op === …)` branch, so a read is compared only with
      // reads in the same branch (the bin and the purge each read the row once — that is not twice).
      for (const [verb, whole] of Object.entries(hs)) for (const [bi, body] of (whole || "").split(/\bif \((?:action|op) === "/).entries()) {
        const seen = new Map();
        for (const m of (body || "").matchAll(/sb\.from\("[a-z_]+"\)\.select\("[^"]*"[^)]*\)(?:\.(?:eq|is|in|neq|not)\([^)]*\))+/g)) {
          const k = m[0].replace(/\s+/g, "");
          seen.set(k, (seen.get(k) || 0) + 1);
        }
        for (const [k, n] of seen) if (n > 1) dup.push(`${verb}${bi ? ` branch ${bi}` : ""}: ${k.slice(0, 70)} ×${n}`);
      }
      return dup.length === 0 || dup.join(" | ");
    });
}
