"use client";
// Owner · Reports Studio — SearchTable (2026-07-25).
//
// A scale-safe detail table for LONG lists (item sales can be 200+ dishes): a search
// box that filters by name, sortable column headers (click to flip asc/desc, with a
// visible caret + aria-sort for screen readers), and ALL matching rows shown inside a
// scrollable body — never a 200-bar chart. Presentational only; it takes already-fetched
// rows, so it adds zero egress. Styling reuses the studio's `.rs-table` look; the search
// bar + scroll shell live in this file's scoped CSS so no shared file is touched.
import { useMemo, useState } from "react";

export type Col<T> = {
  key: string;
  label: string;
  num?: boolean;                          // right-align + tabular numerals
  render: (r: T) => React.ReactNode;      // cell content
  sortBy?: (r: T) => number | string;     // sort key (defaults to no sort if omitted)
  width?: string;                         // optional column hint
};

export function SearchTable<T>({
  rows, columns, searchKey, initialSort, placeholder = "Search…",
  maxHeight = 460, footer, emptyText = "Nothing matches your search.",
}: {
  rows: T[];
  columns: Col<T>[];
  searchKey: (r: T) => string;
  initialSort: { key: string; dir: "asc" | "desc" };
  placeholder?: string;
  maxHeight?: number;
  footer?: React.ReactNode;               // e.g. a totals row (rendered in <tfoot>)
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState(initialSort.key);
  const [dir, setDir] = useState<"asc" | "desc">(initialSort.dir);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = needle ? rows.filter((r) => searchKey(r).toLowerCase().includes(needle)) : rows.slice();
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sortBy) {
      const s = col.sortBy;
      out.sort((a, b) => {
        const av = s(a), bv = s(b);
        const cmp = typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, columns, searchKey, q, sortKey, dir]);

  const onSort = (col: Col<T>) => {
    if (!col.sortBy) return;
    if (col.key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col.key); setDir(col.num ? "desc" : "asc"); }   // numbers open high→low, names A→Z
  };

  return (
    <div className="rs-st">
      <div className="rs-st-bar">
        <div className="rs-st-search">
          <i className="fas fa-magnifying-glass" aria-hidden />
          <input
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder} aria-label={placeholder} enterKeyHint="search"
          />
          {q && <button className="rs-st-clear" onClick={() => setQ("")} aria-label="Clear search"><i className="fas fa-xmark" aria-hidden /></button>}
        </div>
        <span className="rs-st-count">{view.length === rows.length ? `${rows.length}` : `${view.length} of ${rows.length}`}</span>
      </div>
      <div className="rs-st-scroll" style={{ maxHeight }}>
        <table className="rs-table">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = c.key === sortKey;
                const sortable = !!c.sortBy;
                return (
                  <th
                    key={c.key} className={`${c.num ? "num" : ""}${sortable ? " sortable" : ""}${active ? " active" : ""}`}
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                    onClick={() => onSort(c)} role={sortable ? "button" : undefined} tabIndex={sortable ? 0 : undefined}
                    onKeyDown={(e) => { if (sortable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSort(c); } }}
                  >
                    <span className="rs-th-in">{c.label}{sortable && <i className={`fas ${active ? (dir === "asc" ? "fa-caret-up" : "fa-caret-down") : "fa-sort"} rs-th-caret`} aria-hidden />}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.length === 0
              ? <tr><td colSpan={columns.length} className="rs-st-empty">{emptyText}</td></tr>
              : view.map((r, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render(r)}</td>)}</tr>
              ))}
          </tbody>
          {footer && !q && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      <style jsx global>{`
        .rs-st-bar { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-bottom: 1px solid var(--border-c); }
        .rs-st-search { position: relative; flex: 1; display: flex; align-items: center; }
        .rs-st-search > i { position: absolute; left: 11px; font-size: 12px; color: var(--muted); pointer-events: none; }
        .rs-st-search input { width: 100%; height: 36px; padding: 0 32px 0 32px; border-radius: 9px; border: 1px solid var(--border-c); background: var(--card); color: var(--text); font: inherit; font-size: 12.5px; }
        .rs-st-search input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
        .rs-st-clear { position: absolute; right: 6px; width: 24px; height: 24px; display: grid; place-items: center; border: none; background: none; color: var(--muted); cursor: pointer; border-radius: 6px; }
        .rs-st-clear:hover { color: var(--text); background: var(--muted2); }
        .rs-st-count { font-size: 11.5px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .rs-st-scroll { overflow: auto; }
        .rs-st .rs-table th.sortable { cursor: pointer; user-select: none; }
        .rs-st .rs-table th.sortable:hover { color: var(--text); }
        .rs-st .rs-table th.active { color: var(--accent); }
        .rs-th-in { display: inline-flex; align-items: center; gap: 5px; }
        .rs-st .rs-table th.num .rs-th-in { flex-direction: row-reverse; }
        .rs-th-caret { font-size: 10px; opacity: .8; }
        .rs-st .rs-table th.sortable:not(.active) .rs-th-caret { opacity: .35; }
        .rs-st .rs-table th.sortable:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
        .rs-st-empty { text-align: center; color: var(--muted); padding: 26px 16px; font-size: 12.5px; }
        .rs-st tfoot td { position: sticky; bottom: 0; background: var(--card); }
      `}</style>
    </div>
  );
}
