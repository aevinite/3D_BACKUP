"use client";
// Admin · Live floor — the full table grid, updating every second. Moved off the
// Overview screen so each section has its own place.
import { useState } from "react";
import { FloorGrid, StatCards, usePoll, type Tile, type Overview } from "@/components/admin/shared";

export default function AdminFloor() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  usePoll(() => {
    fetch("/api/admin/floor", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.error) setErr(j.error); else { setErr(null); setTiles(j.tables as Tile[]); }
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    fetch("/api/admin/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setOv(j); }).catch(() => {});
  }, 1000);

  return (
    <>
      <h1 className="adm-page-h">Live floor</h1>
      <p className="adm-page-sub">Every table, updating in real time.</p>
      <StatCards ov={ov} />
      <FloorGrid tiles={tiles} err={err} />
    </>
  );
}
