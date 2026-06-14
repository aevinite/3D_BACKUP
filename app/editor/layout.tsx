// Gate for /editor (the MANAGER panel — folder rename to /manager is a later
// task). Admin super-user or a logged-in manager may enter; anyone else → /login.
import { requirePanel } from "@/lib/panelGate";

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  await requirePanel("manager", "/editor");
  return <>{children}</>;
}
