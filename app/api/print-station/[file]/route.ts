// The print-station starter files, generated with the URL of the site they were downloaded from
// (owner, 2026-08-19). See lib/printStation.ts for why they are not static files any more: the Mac
// one was blocked by Gatekeeper AND its URL line pointed at the wrong stack, and to the person
// standing at the printer those two failures look identical — "nothing happens".
//
// PUBLIC ON PURPOSE, and it holds nothing: a Chrome command line and this site's own address. It is
// linked from the admin console, the manager panel, the owner panel and the setup guide — the last of
// which is public too, because a restaurant setting up a printer is not logged in to anything yet.
import { NextRequest, NextResponse } from "next/server";
import { stationScript, STATION_FILES, type StationKind, type StationPanel } from "@/lib/printStation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const kind = String(file || "").toLowerCase().replace(/\.(command|bat|sh)$/, "") as StationKind;
  if (!(kind in STATION_FILES)) {
    return NextResponse.json({ error: "Unknown starter. Ask for mac, windows or linux." }, { status: 404 });
  }
  const url = new URL(req.url);
  // `?panel=manager` for a counter screen. Anything else is the kitchen, which is the common case.
  const panel: StationPanel = url.searchParams.get("panel") === "manager" ? "manager" : "kitchen";
  // The site the person is actually on — so a backup-stack download opens the backup panels and a
  // client-site download opens theirs. x-forwarded-host is what Vercel sets behind its proxy.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const body = stationScript(kind, `${proto}://${host}`, panel);
  const name = panel === "manager"
    ? STATION_FILES[kind].replace("print-station", "print-station-counter")
    : STATION_FILES[kind];
  return new NextResponse(body, {
    status: 200,
    headers: {
      // text/plain, not a script mime type: nothing here should ever be handed to an interpreter by a
      // browser, and `attachment` means it lands in Downloads rather than opening in a tab.
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
