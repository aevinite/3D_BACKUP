// /editor — kept only for BACK-COMPAT. The panel is now /manager; anyone hitting
// the old URL is redirected there (which then runs the manager auth gate).
import { redirect } from "next/navigation";

export default function EditorRedirect() {
  redirect("/manager");
}
