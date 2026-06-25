// app/menu/page.tsx — legacy entry point.
//
// The canonical guest menu now lives at /r/<restaurant>/menu. This redirects the
// old /menu URL to the DEFAULT restaurant, PRESERVING any ?table= / ?t= query so
// existing QR codes (which point at /menu?table=N) keep working unchanged.
import { redirect } from "next/navigation";
import { DEFAULT_RESTAURANT_SLUG } from "@/lib/tenant";

export default async function MenuRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.append(k, v);
  }
  const s = qs.toString();
  redirect(`/r/${DEFAULT_RESTAURANT_SLUG}/menu${s ? `?${s}` : ""}`);
}
