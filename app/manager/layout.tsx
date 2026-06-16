// Gate for /manager (the manager panel — the role formerly called "editor").
// Admin super-user or a logged-in manager may enter; anyone else → /login.
import { requirePanel } from "@/lib/panelGate";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  await requirePanel("manager", "/manager");
  return <>{children}</>;
}
