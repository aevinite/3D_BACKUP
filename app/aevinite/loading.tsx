// app/aevinite/loading.tsx — what fills the admin content area while a page is on its way.
//
// Next renders this INSTANTLY on every navigation inside /aevinite (the sidebar and header
// stay put, only this swaps in), and again while a page's own server work is pending. It is
// a Server Component with no state and no imports beyond the skeleton primitives, so it
// costs nothing and can never be the thing that is slow.
//
// It leans only on classes from app/globals.css — which the root layout ships as a real
// <link> in <head>. That is the whole point: a placeholder defined in page-injected CSS
// would itself paint unstyled for a moment, which is the fault this file exists to remove.
// Do not add a component-level <style> here.
import { SkelLine, SkelToolbar, SkelList } from "@/components/admin/Skeleton";

export default function AdminLoading() {
  return (
    <div>
      {/* Page title + subtitle, at the real sizes so nothing shifts when the page lands. */}
      <SkelLine w="min(320px, 55%)" size="lg" style={{ height: 26, borderRadius: 8, marginBottom: 10 }} />
      <SkelLine w="min(560px, 82%)" size="sm" style={{ marginBottom: 20 }} />
      <SkelToolbar />
      <SkelList rows={6} label="Loading this page" />
    </div>
  );
}
