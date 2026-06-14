// GET /api/rt-config — hands the static vanilla panels the PUBLIC Supabase url +
// anon key so they can open a Realtime WebSocket. These two values are already
// public (the guest React app ships them in its bundle); the powerful
// service-role key is NEVER exposed here. No auth needed — it's public config.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  });
}
