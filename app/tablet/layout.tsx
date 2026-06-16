// Gate for /tablet (waiter app). Admin super-user or a logged-in tablet user may
// enter; anyone else is bounced to /login.
import { requirePanel } from "@/lib/panelGate";

export default async function TabletLayout({ children }: { children: React.ReactNode }) {
  await requirePanel("tablet", "/tablet");
  return <>{children}</>;
}
