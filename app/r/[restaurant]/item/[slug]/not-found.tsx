// Guest-facing not-found for this route. Scoped deliberately NARROW (per guest route,
// not at app/r/[restaurant]/) so a STAFF 404 — e.g. app/r/<slug>/login — still falls
// through to the platform 404, which is the right page for staff. See GuestNotFound.
import GuestNotFound from "@/components/GuestNotFound";

export default function NotFound() {
  return <GuestNotFound />;
}
