// The old standalone "Earnings report" grew into the full Reports section —
// keep the URL working for muscle memory / old bookmarks.
import { redirect } from "next/navigation";
export default function Page() { redirect("/owner/reports"); }
