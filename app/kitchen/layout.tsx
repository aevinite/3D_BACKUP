// Gate for /kitchen. Admin super-user or a logged-in kitchen user may enter;
// anyone else is bounced to /login.
import { requirePanel } from "@/lib/panelGate";

export default async function KitchenLayout({ children }: { children: React.ReactNode }) {
  await requirePanel("kitchen", "/kitchen");
  return <>{children}</>;
}
