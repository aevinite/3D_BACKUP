// "Sales & reports" is no longer a Coming-soon teaser — it shipped as /owner/reports.
import { redirect } from "next/navigation";
export default function Page() { redirect("/owner/reports"); }
