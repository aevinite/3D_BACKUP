// scripts/sweep/t15s10/stmts.mjs — every database statement in a file, cut out whole.
// A statement starts at `.from("<table>")` and ends at the `;` that closes it at its own nesting
// level, so a builder written over five lines is ONE statement and a `;` inside a string or a nested
// callback does not cut it short.
import { src, codeOnly } from "./lib.mjs";

export function statements(rel) {
  const raw = src(rel), c = codeOnly(raw);
  const out = [];
  const re = /\.from\(\s*(["'`])([^"'`]*)\1\s*\)/g;
  let m;
  while ((m = re.exec(c))) {
    let i = m.index, depth = 0, quote = null;
    // walk forward to the end of the statement
    for (; i < c.length; i++) {
      const ch = c[i];
      if (quote) { if (ch === "\\") { i++; continue; } if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") { if (depth === 0) break; depth--; }
      else if (ch === ";" && depth === 0) break;
    }
    let text = c.slice(m.index, i);
    // THE BUILDER PATTERN: `let q = sb.from(…)…; if (x) q = q.eq(…); await q.order(…).limit(…)`.
    // The scope or the ceiling can live on a later line, so the variable's later uses belong to it.
    const pre = c.slice(Math.max(0, m.index - 60), m.index).match(/(?:let|const)\s+(\w+)\s*=\s*(?:await\s+)?\w*\s*$/);
    if (pre) {
      const v = pre[1], tail = c.slice(i, i + 900);
      const later = [...tail.matchAll(new RegExp(`\\b${v}\\s*=\\s*${v}\\.[^;]*;|\\(?await\\s+${v}\\.[^;]*;|\\b${v}\\.select\\([^;]*;`, "g"))].map((x) => x[0]);
      text += " " + later.join(" ");
    }
    const verb = /\.(insert|upsert)\(/.test(text) ? "insert" : /\.update\(/.test(text) ? "update" : /\.delete\(/.test(text) ? "delete" : "select";
    // the line number in the ORIGINAL file, found by the first 40 characters of the statement
    const head = text.slice(0, 40);
    const at = raw.indexOf(head);
    const line = at < 0 ? null : raw.slice(0, at).split("\n").length;
    out.push({ table: m[2], text, verb, line });
  }
  return out;
}
/** Is this statement fenced to one restaurant, or keyed by a value that can only name one row? */
export const scoped = (s) => /restaurant_id/.test(s.text)
  || /\.eq\("token_hash"/.test(s.text) || /\.eq\("code_hash"/.test(s.text)       // a credential's own hash: one row, by design
  || /\.eq\("id", (row\.id|agent\.id|made\.id|g\.id|seg\[1\]|job\.id|id)\)/.test(s.text);
export const bounded = (s) => s.verb !== "select" || /\.(maybeSingle|single|limit|range)\(|head: true/.test(s.text);
export const noStar = (s) => !/\.select\(\s*["'`]\*["'`]/.test(s.text) && !(s.verb === "select" && /\.select\(\s*\)/.test(s.text));
export const noPasted = (s) => {
  for (const m of s.text.matchAll(/\.(or|filter)\(\s*`([^`]*)`/g)) {
    const vars = [...m[2].matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]);
    if (vars.some((v) => !/new Date\(|toISOString|STALE_CLAIM_MS/.test(v))) return false;
  }
  return !/\.or\(\s*[a-zA-Z_]+\s*\+/.test(s.text);
};
