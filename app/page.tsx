// Next's helper that bounces a visitor straight to another address.
import { redirect } from "next/navigation";

// This is the home page (the website root, "/"). We don't actually show
// anything here — the moment someone lands on it, we send them to "/menu".
// So visiting the site always opens the menu.
export default function HomePage() {
  // Immediately forward the visitor to the menu page.
  redirect("/menu");
}
