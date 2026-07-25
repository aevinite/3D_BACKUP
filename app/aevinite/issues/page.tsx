// The Tickets page was folded into the merged "Repair & support" hub (2026-07-25).
// Keep the old URL alive so bookmarks, the dashboard's "Open issues" card and the
// notification-bell links all land on the complaints section instead of 404-ing.
import { redirect } from "next/navigation";

export default function IssuesRedirect() {
  redirect("/aevinite/repair#complaints");
}
