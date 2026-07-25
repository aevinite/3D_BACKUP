// The At-risk page was folded into the merged "Repair & support" hub (2026-07-25).
// Keep the old URL alive so any bookmarks land on the at-risk section, not a 404.
import { redirect } from "next/navigation";

export default function AttentionRedirect() {
  redirect("/aevinite/repair#at-risk");
}
