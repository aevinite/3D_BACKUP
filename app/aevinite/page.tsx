"use client";
// Admin · Overview — the calm landing: key numbers + recent activity. Everything
// else (floor, users, logs, features, settings) lives on its own page now.
import Link from "next/link";
import { useState } from "react";
import { StatCards, ActivityFeed, useLivePoll, type Overview, type Action } from "@/components/admin/shared";

export default function AdminOverview() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<Action[]>([]);

  // Live push instead of per-second polling: both fetches run on mount and the
  // instant anything operational (ops) or content (menu) changes.
  useLivePoll(() => {
    fetch("/api/admin/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setOv(j); }).catch(() => {});
    fetch("/api/admin/oplog?limit=20", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setActivity(j.actions || []); }).catch(() => {});
  });

  return (
    <>
      <h1 className="adm-page-h">Overview</h1>
      <p className="adm-page-sub">A calm snapshot of the restaurant right now.</p>

      {ov?.maintenance && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger)", fontSize: 18 }} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <b>The guest menu is in maintenance.</b>
            <div className="adm-muted" style={{ fontSize: 12.5 }}>Guests can&apos;t browse or order until you bring it back online.</div>
          </div>
          <Link href="/aevinite/settings" className="adm-btn">Fix in Settings</Link>
        </div>
      )}

      <StatCards ov={ov} />

      <div className="adm-card">
        <h2>Recent activity <span className="adm-muted" style={{ fontWeight: 400 }}>· across all panels</span></h2>
        <p className="hint">Every staff action — kitchen, tablet, manager and your own admin actions.</p>
        <ActivityFeed rows={activity} />
      </div>
    </>
  );
}
